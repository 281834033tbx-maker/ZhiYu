#!/bin/sh
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"
NODE_BIN=${NODE_BIN:-$(command -v node 2>/dev/null || true)}
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  printf '%s\n' '找不到 Node.js，无法启动智域本地服务。' >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec "$NODE_BIN" node_modules/vinext/dist/cli.js dev --host 127.0.0.1 --port 3100 --strictPort
