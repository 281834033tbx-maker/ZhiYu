#!/bin/sh
set -eu
# Packaging only: the supplied artwork is already approved; keep its pixels.
TASK_ICON_SOURCE=${1:?Usage: make-icons.sh /absolute/path/to/approved-icon.png}
TASK_ICON_BUILD=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TASK_ICON_SET="$TASK_ICON_BUILD/Icon.iconset"
mkdir -p "$TASK_ICON_SET"
for TASK_ICON_SIZE in 16 32 128 256 512; do
  /usr/bin/sips -s format png -z "$TASK_ICON_SIZE" "$TASK_ICON_SIZE" "$TASK_ICON_SOURCE" --out "$TASK_ICON_SET/icon_${TASK_ICON_SIZE}x${TASK_ICON_SIZE}.png" >/dev/null
  TASK_ICON_DOUBLE=$((TASK_ICON_SIZE * 2))
  /usr/bin/sips -s format png -z "$TASK_ICON_DOUBLE" "$TASK_ICON_DOUBLE" "$TASK_ICON_SOURCE" --out "$TASK_ICON_SET/icon_${TASK_ICON_SIZE}x${TASK_ICON_SIZE}@2x.png" >/dev/null
done
if ! /usr/bin/iconutil -c icns "$TASK_ICON_SET" -o "$TASK_ICON_BUILD/icon.icns"; then
  # Some sandboxed macOS sessions reject valid iconsets. Keep the same PNG
  # representations in the documented ICNS container as a deterministic fallback.
  node "$TASK_ICON_BUILD/pack-icns.cjs"
fi
