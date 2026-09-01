"""Agent 调用层：负责把模型输出压回结构化契约。

PRD 5.3：所有数值由 Agent 提议，由代码裁决和落库。这一层只保证"提议"
一定是合法 JSON 且符合 schema，越界与落库由 engine 负责。

底下有两条运行时（config.AGENT_RUNTIME）：
- opencode：走本进程拉起的私有 headless 实例，与用户本地配置完全隔离；
- direct：直接打 OpenAI 兼容端点，作为 opencode 不可用时的退路。
两条路共用同一套解析、重试、自纠逻辑，上面六个 Agent 感觉不到区别。
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from typing import Any, Optional, Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import (
    AGENT_RUNTIME,
    DISABLE_THINKING,
    LLM_API_KEY,
    LLM_BASE_URL,
    MAX_RETRIES,
    MODEL_FAST,
    MODEL_STRONG,
    REQUEST_TIMEOUT,
)
from . import opencode_client
from .opencode_client import Completion, OpencodeCallError

T = TypeVar("T", bound=BaseModel)


class AgentError(RuntimeError):
    pass


TRACE = os.getenv("LLM_TRACE", "1") != "0"


def _trace(message: str) -> None:
    if TRACE:
        print(f"    · {message}", file=sys.stderr, flush=True)


_client: Optional[httpx.AsyncClient] = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=LLM_BASE_URL,
            timeout=httpx.Timeout(REQUEST_TIMEOUT, connect=15.0),
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json",
            },
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    await opencode_client.aclose()


def using_opencode() -> bool:
    return AGENT_RUNTIME == "opencode"


def _extract_json(text: str) -> str:
    """从可能带围栏、带前后缀的输出里抠出 JSON 对象。

    先试整串——模型规规矩矩输出时这是最省事也最不会抠错的路径；
    只有整串不是合法 JSON 时才退回去做括号扫描。
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
    cleaned = cleaned.strip()

    try:
        json.loads(cleaned)
        return cleaned
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    if start == -1:
        raise AgentError(f"输出里没有 JSON 对象：{text[:200]}")

    depth, in_string, escaped = 0, False, False
    for index in range(start, len(cleaned)):
        char = cleaned[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return cleaned[start : index + 1]
    raise AgentError(f"JSON 对象没有闭合：{text[:200]}")


async def _direct_complete(
    *,
    system: str,
    user: str,
    strong: bool,
    temperature: float,
    budget: int,
) -> Completion:
    """直连 OpenAI 兼容端点。

    端点背后是带推理的模型，偶发只回 reasoning_content 而 content 为空。
    这种情况下退回去从推理文本里抠 JSON，比直接判失败划算。
    """
    payload: dict[str, Any] = {
        "model": MODEL_STRONG if strong else MODEL_FAST,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": budget,
    }
    if DISABLE_THINKING:
        payload["enable_thinking"] = False
        payload["response_format"] = {"type": "json_object"}

    response = await client().post("/chat/completions", json=payload)
    if response.status_code >= 400:
        raise AgentError(f"HTTP {response.status_code}: {response.text[:300]}")
    body = response.json()
    choices = body.get("choices") or []
    if not choices:
        raise AgentError(f"响应里没有 choices：{json.dumps(body)[:300]}")

    message = choices[0].get("message") or {}
    finish = choices[0].get("finish_reason") or ""
    content = (message.get("content") or "").strip()
    if not content:
        reasoning = (message.get("reasoning_content") or "").strip()
        if "{" in reasoning:
            content = reasoning
    if not content:
        raise AgentError(f"模型返回了空内容（finish_reason={finish}）")
    return Completion(text=content, finish=finish, tokens=body.get("usage") or {})


async def _complete(
    *,
    system: str,
    user: str,
    strong: bool,
    temperature: float,
    budget: int,
    label: str,
) -> Completion:
    if using_opencode():
        try:
            return await opencode_client.complete(
                system=system,
                user=user,
                strong=strong,
                temperature=temperature,
                label=label,
            )
        except OpencodeCallError as error:
            # 统一成 AgentError，上层重试逻辑不需要区分运行时。
            raise AgentError(str(error)) from error
    return await _direct_complete(
        system=system, user=user, strong=strong, temperature=temperature, budget=budget
    )


_CORRECTION = (
    "\n\n---\n"
    "上一次的输出无法解析成要求的结构。\n"
    "你上次输出的是：\n{raw}\n\n"
    "错误：{error}\n\n"
    "请重新输出，只输出一个合法的 JSON 对象，不要任何解释文字、不要 markdown 围栏，"
    "字段名必须与要求完全一致。"
)

_BE_CONCISE = (
    "\n\n---\n"
    "上一次输出超长被截断，JSON 不完整。这次请大幅压缩每个字段的文字量，"
    "在满足最小长度要求的前提下尽量简短，务必让 JSON 完整闭合。"
)


async def call_structured(
    *,
    schema: Type[T],
    system: str,
    user: str,
    strong: bool = False,
    temperature: float = 0.8,
    max_tokens: int = 3000,
    label: str = "agent",
) -> T:
    """调用 Agent 并把输出解析成给定的 pydantic 契约，失败则重试。

    自纠反馈折进 user prompt 而不是追加对话轮次：opencode 运行时下每次调用都是
    一个全新会话（见 opencode_client 模块注释），没有可追加的历史。折进 prompt
    让两条运行时的行为完全一致，出问题时不用怀疑是运行时差异。
    """
    last_error: Optional[Exception] = None
    correction = ""
    budget = max_tokens

    for attempt in range(MAX_RETRIES):
        raw = ""
        started = time.monotonic()
        try:
            completion = await _complete(
                system=system,
                user=user + correction,
                strong=strong,
                temperature=temperature,
                budget=budget,
                label=label,
            )
            raw = completion.text
            _trace(
                f"{label} 第{attempt + 1}次 {time.monotonic() - started:.1f}s "
                f"finish={completion.finish} {len(raw)}字"
            )
            try:
                data = json.loads(_extract_json(raw))
            except (AgentError, json.JSONDecodeError):
                if completion.finish == "length":
                    # 直连时能自己加预算；走 opencode 时输出上限由模型 limit.output
                    # 决定、无法按请求覆盖，只能反过来要求模型写短一点。
                    budget = min(int(budget * 1.8), 12000)
                    raise AgentError("输出被输出上限截断，JSON 不完整") from None
                raise
            return schema.model_validate(data)
        except (AgentError, json.JSONDecodeError, ValidationError) as error:
            last_error = error
            _trace(
                f"{label} 第{attempt + 1}次失败 {time.monotonic() - started:.1f}s "
                f"{type(error).__name__}: {str(error)[:120]}"
            )
            if attempt == MAX_RETRIES - 1:
                break
            if raw and "截断" in str(error):
                correction = _BE_CONCISE
            elif raw and not isinstance(error, AgentError):
                correction = _CORRECTION.format(raw=raw[:1500], error=error)
            else:
                # 空响应或网络错误：原样重试，别把噪音塞进 prompt。
                correction = ""
            await asyncio.sleep(min(8.0, 1.5 * (attempt + 1)))

    raise AgentError(f"[{label}] 结构化调用失败（重试 {MAX_RETRIES} 次）：{last_error}")
