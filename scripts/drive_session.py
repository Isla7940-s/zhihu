"""通过 HTTP 把一个会话推到指定幕的决策阶段，用于人工看 UI。

    python scripts/drive_session.py 3      # 推到第 3 幕决策阶段

跑完会打印会话 ID，把它塞进浏览器的 sessionStorage['life-session'] 就能看到界面。
"""

from __future__ import annotations

import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8011"


def call(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())


def main() -> None:
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 3

    state = call(
        "POST",
        "/api/session",
        {
            "motif_id": "big-city-or-hometown",
            "stance_id": "hometown",
            "identity_id": "985-only-child",
        },
    )
    sid = state["会话ID"]
    print(f"会话 {sid}")

    for turn in range(1, target + 1):
        state = call("POST", f"/api/session/{sid}/begin-turn")
        print(f"  第 {turn} 幕 决策阶段，牌 {len(state['事件卡'])} 张")
        if turn == target:
            break

        # 只为了攒出往期牌堆，行动阶段直接跳过。
        state = call("POST", f"/api/session/{sid}/decision", {"index": 0})
        state = call("POST", f"/api/session/{sid}/settle")
        node = state["事件树"][-1]
        print(f"    结算 {node['结算档位']}，本幕共 {len(state['事件卡'])} 张牌")

    print("\n归档情况：")
    for node in state["事件树"]:
        print(f"  第 {node['回合']} 幕 {node['年龄']} 岁 · 归档 {len(node['事件卡'])} 张")
    print(f"\nsessionStorage.setItem('life-session','{sid}')")


if __name__ == "__main__":
    main()
