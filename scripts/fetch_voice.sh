#!/usr/bin/env bash
# 下载 Piper 中文语音模型（约 63 MB，不入库）
set -euo pipefail
cd "$(dirname "$0")/../assets/voices"
base="https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium"
for f in zh_CN-huayan-medium.onnx zh_CN-huayan-medium.onnx.json; do
  [ -f "$f" ] || curl -sSL --fail -o "$f" "$base/$f"
done
ls -la
