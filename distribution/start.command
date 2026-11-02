#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24 LTS：https://nodejs.org/'
  read -r -p '按回车退出'
  exit 1
fi
node start.mjs
read -r -p '程序已退出，按回车关闭窗口'
