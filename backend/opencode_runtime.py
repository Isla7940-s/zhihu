"""私有 opencode headless 实例。

Agent 运行时不直接打 OpenAI 兼容端点，而是走一个由本进程拉起、生命周期由本进程
管理的 opencode server。

隔离是这个模块存在的唯一理由：opencode 的"全局配置"路径是
`$XDG_CONFIG_HOME/opencode/opencode.json`，鉴权落在 `$XDG_DATA_HOME/opencode/auth.json`，
会话落在 `$XDG_DATA_HOME/opencode/`。只设 OPENCODE_CONFIG 不够——它在优先级链里排在
全局配置之后，用户本地的 model/provider/plugin 仍会被读进来。所以把四个 XDG 目录、
DB 路径、工作目录全部重定向到项目内的 .opencode-runtime/，再关掉项目配置探测。
这样本实例与用户 ~/.config/opencode、~/.local/share/opencode 完全无交集，
双向都不污染。
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import httpx

from .config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    MODEL_FAST,
    MODEL_STRONG,
    OPENCODE_PORT,
    OPENCODE_RUNTIME_DIR,
    OPENCODE_STARTUP_TIMEOUT,
    PROVIDER_ID,
    REQUEST_TIMEOUT,
)


class OpencodeError(RuntimeError):
    pass


def _trace(message: str) -> None:
    print(f"  [opencode] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 私有配置生成


def _model_entry(model_id: str) -> dict[str, Any]:
    return {
        "name": model_id,
        # models.dev 不认识这个私有部署，limit 必须手写，否则 opencode 无法判断
        # 上下文余量，会在长 prompt 上做出错误的截断决策。
        "limit": {"context": 131072, "output": 16384},
        # 端点背后是带推理的模型，推理文本走 reasoning_content 字段。
        "reasoning": True,
        "interleaved": {"field": "reasoning_content"},
        # 模型级 options 由 openai-compatible provider 直接并进请求体。
        # 关掉思考：推理 token 也算在输出预算里，复杂结构化输出会在推理阶段
        # 就把预算烧光，只回一个空 content。
        "options": {"enable_thinking": False},
    }


# opencode 的温度是 agent 级配置，不能按请求传。而六个 Agent 是有意分层的：
# 决策 Agent 要收敛（0.8），困境和人生卡要发散（0.95）。所以按 0.05 步长预生成
# 一组只有温度不同的 agent，调用方按需要的温度选桶。
_TEMPERATURE_STEP = 0.05


def agent_for_temperature(temperature: float) -> str:
    bucket = round(min(max(temperature, 0.0), 1.0) / _TEMPERATURE_STEP)
    return f"w{bucket * 5:03d}"


def _temperature_buckets() -> list[tuple[str, float]]:
    count = int(round(1.0 / _TEMPERATURE_STEP)) + 1
    return [
        (agent_for_temperature(i * _TEMPERATURE_STEP), round(i * _TEMPERATURE_STEP, 2))
        for i in range(count)
    ]


# 六个 Agent 都只做"读事实底稿、写结构化 JSON"，一个工具都不需要。
# 留着工具反而会让模型试图读文件、跑命令，白烧 token 还可能挂起；
# 更关键的是 opencode 一旦决定调工具就会带上 tool_choice，而上游端点明确拒绝
# 强制 tool_choice，整个请求会直接 400。
_NO_TOOLS = {
    name: False
    for name in (
        "bash", "edit", "write", "read", "grep", "glob", "list", "patch",
        "todowrite", "todoread", "webfetch", "task", "question", "skill",
    )
}

_AGENT_PROMPT = (
    "你是一个内容生成器。你没有任何工具，也不需要任何工具。"
    "你要处理的全部信息都在用户消息里。"
    "永远只输出一个合法的 JSON 对象，不要解释、不要 markdown 围栏。"
)


def build_config() -> dict[str, Any]:
    """私有实例的完整配置。

    enabled_providers 收窄到只有我们这一个 provider，即使隔离目录里意外出现了
    其它鉴权信息也不会被加载。
    """
    models = {MODEL_FAST: _model_entry(MODEL_FAST)}
    if MODEL_STRONG != MODEL_FAST:
        models[MODEL_STRONG] = _model_entry(MODEL_STRONG)

    qualified_fast = f"{PROVIDER_ID}/{MODEL_FAST}"

    return {
        "$schema": "https://opencode.ai/config.json",
        "model": qualified_fast,
        "small_model": qualified_fast,
        "autoupdate": False,
        "share": "disabled",
        "enabled_providers": [PROVIDER_ID],
        "provider": {
            PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "知乎人生模拟器私有端点",
                "options": {
                    "baseURL": LLM_BASE_URL,
                    "apiKey": LLM_API_KEY,
                    "timeout": int(REQUEST_TIMEOUT * 1000),
                },
                "models": models,
            }
        },
        "agent": {
            name: {
                "description": f"人生模拟器内容 Agent（温度 {temperature}）",
                "mode": "primary",
                "model": qualified_fast,
                "temperature": temperature,
                "prompt": _AGENT_PROMPT,
                "tools": dict(_NO_TOOLS),
            }
            for name, temperature in _temperature_buckets()
        },
    }


# 这些环境变量会让 opencode 去读用户本地的东西，或者产生对外副作用。
# 启动私有实例前一律清掉，不能依赖"当前 shell 里恰好没设"。
_LEAKY_ENV = (
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_AUTH_CONTENT",
    "OPENCODE_DB",
    "OPENCODE_API_KEY",
    "OPENCODE_CLIENT",
    "OPENCODE_CONSOLE_TOKEN",
    "OPENCODE_AUTO_SHARE",
    "OPENCODE_PERMISSION",
)


class OpencodeServer:
    """一个隔离的 opencode server 进程。"""

    def __init__(self, root: Path | None = None, port: int | None = None) -> None:
        self.root = (root or OPENCODE_RUNTIME_DIR).resolve()
        self.port = port or OPENCODE_PORT
        self.process: Optional[subprocess.Popen[bytes]] = None
        self._log_handle = None
        self._owns_process = False

    # ------------------------------------------------------------ 目录与环境

    @property
    def config_home(self) -> Path:
        return self.root / "config"

    @property
    def config_file(self) -> Path:
        return self.config_home / "opencode" / "opencode.json"

    @property
    def workspace(self) -> Path:
        """server 的 cwd。

        必须是一个空目录：opencode 会把 cwd 当项目根，读 AGENTS.md、扫 .opencode/、
        建项目级会话目录。指到仓库根会让它把我们的源码和规则文件卷进 prompt。
        """
        return self.root / "workspace"

    @property
    def log_file(self) -> Path:
        return self.root / "server.log"

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def prepare(self) -> None:
        for path in (
            self.config_home / "opencode",
            self.root / "data",
            self.root / "cache",
            self.root / "state",
            self.workspace,
        ):
            path.mkdir(parents=True, exist_ok=True)

        self.config_file.write_text(
            json.dumps(build_config(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # 空的 auth.json，杜绝 opencode 去别处找鉴权。
        auth = self.root / "data" / "opencode" / "auth.json"
        auth.parent.mkdir(parents=True, exist_ok=True)
        if not auth.exists():
            auth.write_text("{}", encoding="utf-8")

    def env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k not in _LEAKY_ENV}
        env.update(
            {
                # 隔离的核心：全局配置/数据/缓存/状态四个根全部改指向。
                "XDG_CONFIG_HOME": str(self.config_home),
                "XDG_DATA_HOME": str(self.root / "data"),
                "XDG_CACHE_HOME": str(self.root / "cache"),
                "XDG_STATE_HOME": str(self.root / "state"),
                "OPENCODE_CONFIG": str(self.config_file),
                "OPENCODE_DB": str(self.root / "opencode.db"),
                "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
                "OPENCODE_DISABLE_DEFAULT_PLUGINS": "1",
                "OPENCODE_DISABLE_AUTOUPDATE": "1",
                "OPENCODE_DISABLE_SHARE": "1",
                "OPENCODE_DISABLE_MODELS_FETCH": "1",
                "OPENCODE_DISABLE_CLAUDE_CODE": "1",
                "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS": "1",
                "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1",
                "OPENCODE_DISABLE_LSP_DOWNLOAD": "1",
                "OPENCODE_DISABLE_EMBEDDED_WEB_UI": "1",
                "OPENCODE_DISABLE_AUTOCOMPACT": "1",
            }
        )
        return env

    # ---------------------------------------------------------------- 生命周期

    @staticmethod
    def _port_open(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def _binary(self) -> str:
        found = shutil.which("opencode") or str(Path.home() / ".opencode" / "bin" / "opencode")
        if not Path(found).exists():
            raise OpencodeError(
                "找不到 opencode 可执行文件。装一个：curl -fsSL https://opencode.ai/install | bash"
            )
        return found

    async def start(self) -> None:
        self.prepare()

        if self._port_open(self.port):
            # 上一次跑留下的实例，直接复用。它是同一份隔离配置起的，行为一致。
            _trace(f"复用已在 {self.port} 上的实例")
            await self._await_ready()
            return

        self._log_handle = self.log_file.open("ab")
        self.process = subprocess.Popen(
            [self._binary(), "serve", "--hostname", "127.0.0.1", "--port", str(self.port)],
            cwd=str(self.workspace),
            env=self.env(),
            stdout=self._log_handle,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        self._owns_process = True
        _trace(f"已拉起私有实例 pid={self.process.pid} port={self.port} root={self.root}")

        try:
            await self._await_ready()
        except OpencodeError:
            # 端口抢输了。上面那次 _port_open 到 Popen 之间有个窗口，两个进程
            # （API 服务和命令行跑批，或者两个 worker）可能同时穿过去，然后其中
            # 一个 bind 失败退出。赢家起的实例和我们要起的是同一份隔离配置，
            # 行为完全一致，直接用它，没必要让整个进程起不来。
            lost_race = self.process is not None and self.process.poll() is not None
            if lost_race and self._port_open(self.port):
                _trace("抢端口输了，改用已在端口上的实例")
                self._detach_process()
                await self._await_ready()
                return
            raise

    def _detach_process(self) -> None:
        """放弃对子进程的所有权（它已经死了，或者不该由我们管）。"""
        self.process = None
        self._owns_process = False
        if self._log_handle is not None:
            self._log_handle.close()
            self._log_handle = None

    async def _await_ready(self) -> None:
        deadline = asyncio.get_event_loop().time() + OPENCODE_STARTUP_TIMEOUT
        last: Optional[Exception] = None
        async with httpx.AsyncClient(base_url=self.base_url, timeout=5.0) as probe:
            while asyncio.get_event_loop().time() < deadline:
                if self.process is not None and self.process.poll() is not None:
                    raise OpencodeError(
                        f"opencode serve 启动即退出（code={self.process.returncode}），"
                        f"日志见 {self.log_file}"
                    )
                try:
                    response = await probe.get("/config")
                    if response.status_code == 200:
                        config = response.json()
                        _trace(f"就绪，model={config.get('model')}")
                        return
                    last = OpencodeError(f"/config 返回 {response.status_code}")
                except httpx.HTTPError as error:
                    last = error
                await asyncio.sleep(0.4)
        raise OpencodeError(f"等待 opencode 就绪超时（{OPENCODE_STARTUP_TIMEOUT}s）：{last}")

    async def verify_provider(self) -> None:
        """确认私有实例只认识我们注入的 provider。

        隔离一旦失效（比如 XDG 没生效、读到了用户的全局配置），这里会立刻暴露：
        provider 列表里会冒出 anthropic/openai 之类我们没配的东西。
        """
        async with httpx.AsyncClient(base_url=self.base_url, timeout=20.0) as probe:
            response = await probe.get("/config/providers")
            response.raise_for_status()
            body = response.json()
        providers = {item["id"] for item in body.get("providers", [])}
        if providers != {PROVIDER_ID}:
            raise OpencodeError(
                f"隔离校验失败：期望只有 {PROVIDER_ID}，实际 {sorted(providers)}。"
                "说明私有实例读到了本地配置。"
            )
        _trace(f"隔离校验通过，provider={sorted(providers)}")

    def stop(self) -> None:
        if self.process is not None and self._owns_process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
            _trace("私有实例已停止")
        self._detach_process()


_server: Optional[OpencodeServer] = None
_start_lock: Optional[asyncio.Lock] = None


async def ensure_server() -> OpencodeServer:
    """幂等地拿到就绪的私有实例。"""
    global _server, _start_lock
    if _start_lock is None:
        _start_lock = asyncio.Lock()
    async with _start_lock:
        if _server is None:
            server = OpencodeServer()
            await server.start()
            await server.verify_provider()
            _server = server
        return _server


async def restart() -> OpencodeServer:
    """丢掉当前实例，重新拉一个。

    实例有可能在半局中间消失——被系统回收、被用户手动 kill、或者自己崩了。
    尤其是"复用了别人起的实例"这种情况，我们对它的生命周期没有任何控制权。
    与其让一局游戏因此报废，不如认了：连接一断就地重建。
    """
    global _server
    if _server is not None:
        _server.stop()
        _server = None
    return await ensure_server()


def shutdown() -> None:
    global _server
    if _server is not None:
        _server.stop()
        _server = None
