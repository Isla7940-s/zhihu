"""把一次 Agent 调用映射到私有 opencode 实例的 session API。

opencode 没有无状态的补全接口，只有会话。这里的做法是**一次调用一个会话，用完即删**。
看着浪费，但这正是 PRD 5.5 要的：上下文必须由代码构造的事实底稿完全决定，大小恒定。
如果复用会话，opencode 会把历史消息一起回放，上下文随回合线性增长，
Agent 会开始"记得"我们没打算让它记得的东西，一致性反而更差。
会话建删都是本地 SQLite 操作，相对一次模型调用可以忽略。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from ..config import MODEL_FAST, MODEL_STRONG, PROVIDER_ID, REQUEST_TIMEOUT
from ..opencode_runtime import agent_for_temperature, ensure_server, restart


@dataclass
class Completion:
    text: str
    finish: str
    tokens: dict[str, Any] = field(default_factory=dict)


class OpencodeCallError(RuntimeError):
    """一次调用失败。retryable 区分"重试有意义"和"重试也一样"。"""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


_api: Optional[httpx.AsyncClient] = None


async def api() -> httpx.AsyncClient:
    global _api
    server = await ensure_server()
    if _api is None or _api.is_closed:
        _api = httpx.AsyncClient(
            base_url=server.base_url,
            # 比上游超时留一截余量：opencode 自己会先按 provider.options.timeout
            # 掐掉请求，我们不该比它先超时，否则拿不到它的错误信息。
            timeout=httpx.Timeout(REQUEST_TIMEOUT + 60, connect=10.0),
        )
    return _api


async def aclose() -> None:
    global _api
    if _api is not None and not _api.is_closed:
        await _api.aclose()
    _api = None


def _extract(parts: list[dict[str, Any]]) -> str:
    """取出正文。

    优先 text part。全空时退回 reasoning part——关掉思考后这条路基本不会走到，
    但模型偶发把 JSON 写进推理段，直接判失败太浪费。
    """
    texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
    joined = "".join(texts).strip()
    if joined:
        return joined
    for part in parts:
        if part.get("type") == "reasoning" and "{" in part.get("text", ""):
            return part["text"].strip()
    return ""


#: 这些是"实例没了"，不是"模型答错了"。区别很重要：前者重建实例就能继续，
#: 后者重试同一个实例毫无意义。
_TRANSPORT_ERRORS = (
    httpx.ConnectError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.ConnectTimeout,
)


async def complete(
    *,
    system: str,
    user: str,
    strong: bool = False,
    temperature: float = 0.8,
    label: str = "agent",
) -> Completion:
    """跑一次 Agent 调用；实例中途消失就重建一次再试。

    一局游戏要串起六十多次调用、跨越几十分钟，期间私有实例被系统回收、
    被手动 kill、或者自己崩掉都完全可能。少了这层恢复，任何一次抖动都会
    让整局作废——而这一局已经烧掉几十分钟的模型调用了。
    """
    try:
        return await _attempt(
            system=system, user=user, strong=strong, temperature=temperature, label=label
        )
    except _TRANSPORT_ERRORS as error:
        await aclose()
        await restart()
        try:
            return await _attempt(
                system=system, user=user, strong=strong, temperature=temperature, label=label
            )
        except httpx.HTTPError as retry_error:
            raise OpencodeCallError(
                f"私有实例重建后仍不可用：{retry_error}（首次失败：{error}）"
            ) from retry_error


async def _attempt(
    *,
    system: str,
    user: str,
    strong: bool,
    temperature: float,
    label: str,
) -> Completion:
    http = await api()
    model_id = MODEL_STRONG if strong else MODEL_FAST

    created = await http.post("/session", json={"title": f"zhihu-game/{label}"})
    if created.status_code >= 400:
        raise OpencodeCallError(f"建会话失败 HTTP {created.status_code}: {created.text[:200]}")
    session_id = created.json()["id"]

    try:
        response = await http.post(
            f"/session/{session_id}/message",
            json={
                "agent": agent_for_temperature(temperature),
                "system": system,
                "model": {"providerID": PROVIDER_ID, "modelID": model_id},
                "parts": [{"type": "text", "text": user}],
            },
        )
        if response.status_code >= 400:
            raise OpencodeCallError(
                f"HTTP {response.status_code}: {response.text[:300]}", retryable=False
            )

        body = response.json()
        info = body.get("info") or {}

        error = info.get("error")
        if error:
            data = error.get("data") or {}
            message = data.get("message") or error.get("name") or "未知错误"
            raise OpencodeCallError(
                f"{error.get('name', 'Error')}: {message}",
                retryable=bool(data.get("isRetryable", True)),
            )

        text = _extract(body.get("parts") or [])
        if not text:
            kinds = [p.get("type") for p in body.get("parts") or []]
            raise OpencodeCallError(f"没有拿到文本输出（parts={kinds}）")

        return Completion(
            text=text,
            finish=info.get("finish") or "",
            tokens=info.get("tokens") or {},
        )
    finally:
        # 删会话失败不该让整次调用失败——最坏结果只是隔离目录里多一条记录。
        try:
            await http.delete(f"/session/{session_id}")
        except httpx.HTTPError:
            pass
