#!/bin/bash
# 智域一键更新：退出 App → 重新打包 → 重新打开（启动台里的软链接会自动指向新版）
set -e
cd "$(dirname "$0")"

echo "→ 退出正在运行的智域..."
osascript -e 'quit app "智域"' 2>/dev/null || pkill -f "智域.app/Contents/MacOS/智域" 2>/dev/null || true
sleep 2

echo "→ 重新打包..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir

echo "→ 重新打开（启动台里的还是最新版）..."
open "/Applications/智域.app"

echo "✅ 更新完成"
