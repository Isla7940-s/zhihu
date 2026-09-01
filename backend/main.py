"""FastAPI 接口层。

会话保存在进程内存里——这是一个演示用的单机服务，不做持久化。
"""

from __future__ import annotations

import functools
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agents.llm import AgentError, aclose, using_opencode
from .agents import llm as llm_module
from .config import FRONTEND_DIST
from .content_loader import load_motifs, load_zhihu_topic
from .engine import machine, probability
from .engine.machine import GameError
from .models import GameState, Phase
from .opencode_runtime import ensure_server, shutdown

SESSIONS: dict[str, GameState] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 私有实例在启动时就拉起来：冷启动要十几秒，摊到第一个玩家的第一次
    # Agent 调用上会变成一次莫名的长等待。
    if using_opencode():
        await ensure_server()
    yield
    await aclose()
    shutdown()


app = FastAPI(title="人生模拟互动内容", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartRequest(BaseModel):
    motif_id: str
    stance_id: str
    identity_id: str


class DecisionRequest(BaseModel):
    index: int


class ActionRequest(BaseModel):
    text: str


class RegretRequest(BaseModel):
    text: str

class LLMConfigRequest(BaseModel):
    api_key: str
    base_url: str
    model: str

@app.post("/api/config")
def configure_llm(request: LLMConfigRequest) -> dict[str, str]:
    llm_module.LLM_BASE_URL = request.base_url.rstrip("/")
    llm_module.LLM_API_KEY = request.api_key
    llm_module.MODEL_FAST = request.model
    llm_module.MODEL_STRONG = request.model
    return {"status": "ok"}


def _session(session_id: str) -> GameState:
    state = SESSIONS.get(session_id)
    if state is None:
        raise HTTPException(404, "会话不存在")
    return state


def _view(state: GameState) -> dict[str, Any]:
    """给前端的视图。概率只给模糊档位，不给数字（PRD 4.4）。"""
    payload = state.model_dump(by_alias=True, mode="json")
    goal = state.current.goal
    payload["达成希望"] = (
        probability.hope_label(probability.compute_p(state)) if goal else None
    )
    payload["可用行动点"] = state.action_points.available_this_turn
    payload["概率构成"] = probability.breakdown(state) if goal else {}
    return payload


def _guard(func):
    """把领域异常翻译成 HTTP 状态码。

    必须用 functools.wraps：FastAPI 靠 inspect.signature 推导参数，而
    inspect.signature 会跟随 __wrapped__。少了它，FastAPI 看到的就是
    (*args, **kwargs)，于是把请求体参数当成必填查询参数，所有 POST 接口 422。
    """

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except GameError as error:
            raise HTTPException(400, str(error)) from error
        except AgentError as error:
            raise HTTPException(502, f"Agent 调用失败：{error}") from error

    return wrapper


@app.get("/api/topic")
def topic() -> dict[str, Any]:
    """mock 的知乎话题页：问题、高赞回答、评论。"""
    return load_zhihu_topic()


@app.get("/api/motifs")
def motifs() -> list[dict[str, Any]]:
    return [card.wire() for card in load_motifs().values()]


@app.post("/api/session")
@_guard
async def start(request: StartRequest) -> dict[str, Any]:
    state = machine.create_session(
        request.motif_id, request.stance_id, request.identity_id
    )
    SESSIONS[state.session_id] = state
    return _view(state)


@app.get("/api/session/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    return _view(_session(session_id))


@app.post("/api/session/{session_id}/begin-turn")
@_guard
async def begin_turn(session_id: str) -> dict[str, Any]:
    state = _session(session_id)
    if state.phase is not Phase.CARRY_OVER:
        raise GameError(f"当前阶段是 {state.phase.value}，不能开启新回合")
    await machine.begin_turn(state)
    return _view(state)


@app.post("/api/session/{session_id}/decision")
@_guard
async def decide(session_id: str, request: DecisionRequest) -> dict[str, Any]:
    state = _session(session_id)
    await machine.choose_decision(state, request.index)
    return _view(state)


@app.post("/api/session/{session_id}/action")
@_guard
async def act(session_id: str, request: ActionRequest) -> dict[str, Any]:
    state = _session(session_id)
    await machine.take_action(state, request.text)
    return _view(state)


@app.post("/api/session/{session_id}/suggestions")
@_guard
async def suggestions(session_id: str) -> dict[str, Any]:
    state = _session(session_id)
    await machine.refresh_suggestions(state)
    return _view(state)


@app.post("/api/session/{session_id}/settle")
@_guard
async def settle(session_id: str) -> dict[str, Any]:
    state = _session(session_id)
    result = await machine.settle_turn(state)
    view = _view(state)
    view["结算"] = result
    return view


@app.post("/api/session/{session_id}/regret")
def regret(session_id: str, request: RegretRequest) -> dict[str, Any]:
    state = _session(session_id)
    try:
        machine.submit_regret(state, request.text)
    except GameError as error:
        raise HTTPException(400, str(error)) from error
    return _view(state)


if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="assets",
    )

    @app.get("/")
    def index() -> Any:
        # index.html 必须每次重新取：它引用的 JS/CSS 文件名带构建哈希，
        # 一旦这张入口页被缓存，前端重新构建了浏览器也还在加载旧资源。
        return FileResponse(
            str(FRONTEND_DIST / "index.html"),
            headers={"Cache-Control": "no-store, must-revalidate"},
        )
