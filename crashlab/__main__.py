"""命令行入口：python -m crashlab <command> <case_dir>"""
from __future__ import annotations

import argparse
import sys

from .case import Case


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="crashlab", description="事故视频解析工具链")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, hlp in [("analyze", "取证 + 测量 + 蒙特卡洛，写 out/analysis.json"),
                      ("frames", "抽帧给 Studio 用（public/cases/<id>/frames）"),
                      ("tts", "按 story.json 生成配音与时间轴"),
                      ("review", "合规审查闸门：检查来源、措辞、数字是否带区间"),
                      ("all", "analyze → frames → review → tts")]:
        p = sub.add_parser(name, help=hlp)
        p.add_argument("case", help="案例目录或 case.yaml")
    args = ap.parse_args(argv)
    case = Case.load(args.case)
    if args.cmd in ("analyze", "all"):
        from .pipeline import analyze_dashcam
        analyze_dashcam(case)
    if args.cmd in ("frames", "all"):
        from .publish import export_frames
        export_frames(case)
    if args.cmd in ("review", "all"):
        from .review import review_case
        ok = review_case(case)
        if not ok:
            return 2
    if args.cmd in ("tts", "all"):
        from .publish import export_audio
        from .tts import synthesize_story
        synthesize_story(case)
        export_audio(case)
    return 0


if __name__ == "__main__":
    sys.exit(main())
