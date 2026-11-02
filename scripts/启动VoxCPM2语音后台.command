#!/bin/zsh
set -e
cd "${0:A:h}/.."
echo "正在启动 VoxCPM2 官方中文版本地后台。首次点击生成时，模型加载可能需要约两分钟。"
echo "打开地址：http://127.0.0.1:8808"
echo "关闭此终端窗口或按 Ctrl+C 可停止后台。"
if curl -fsS --max-time 2 "http://127.0.0.1:8808/" >/dev/null 2>&1; then
  open "http://127.0.0.1:8808"
  echo "后台已在运行。"
  exit 0
fi
(
  for i in {1..180}; do
    if curl -fsS --max-time 2 "http://127.0.0.1:8808/" >/dev/null 2>&1; then
      open "http://127.0.0.1:8808"
      exit 0
    fi
    sleep 1
  done
) &
exec .npc-runtime/voxcpm-venv/bin/python -u scripts/voxcpm2_official_zh.py --port 8808
