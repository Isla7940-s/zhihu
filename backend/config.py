"""运行配置。API 凭据可由环境变量覆盖。"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
CONTENT_DIR = BACKEND_DIR / "content"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

# PRD 5.1 把 Agent 分成快/强两档。当前测试端点只提供一个模型，
# 两档指向同一模型，但调用参数（温度、超时、重试）仍按档位区分。
MODEL_FAST = os.getenv("LLM_MODEL_FAST", "")
MODEL_STRONG = os.getenv("LLM_MODEL_STRONG", "")

REQUEST_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "180"))
MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "5"))

# 这个端点后面是带推理的模型，max_tokens 把推理 token 也算在内。复杂的结构化
# 输出（比如决策 Agent 的 3×6 个字段）会在推理阶段就烧光预算，返回空 content。
# 关掉思考后 token 消耗降到三分之一、耗时降到四分之一，输出质量没有可见损失。
DISABLE_THINKING = os.getenv("LLM_DISABLE_THINKING", "1") != "0"

# ------------------------------------------------------------------ Agent 运行时
# opencode：走本进程拉起的私有 headless 实例（见 opencode_runtime.py）。
# direct：直接打上面的 OpenAI 兼容端点，作为 opencode 不可用时的退路。
AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "opencode").strip().lower()

# 私有实例的一切都落在这个目录里，与用户的 ~/.config/opencode 无交集。
OPENCODE_RUNTIME_DIR = Path(
    os.getenv("OPENCODE_RUNTIME_DIR", str(PROJECT_ROOT / ".opencode-runtime"))
)
OPENCODE_PORT = int(os.getenv("OPENCODE_PORT", "4519"))
OPENCODE_STARTUP_TIMEOUT = float(os.getenv("OPENCODE_STARTUP_TIMEOUT", "90"))

# provider id 只在私有实例内部有意义，起个专属名字避免和任何真实 provider 撞车。
PROVIDER_ID = os.getenv("OPENCODE_PROVIDER_ID", "zhihu-game")
