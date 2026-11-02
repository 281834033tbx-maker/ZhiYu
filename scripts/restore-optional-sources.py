#!/usr/bin/env python3
"""Verify optional source snapshots; copy them only with explicit --apply."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys


NAMES = (
    "Qwen3-TTS", "voxcpm-next", "voxcpm-official", "MuseTalk",
    "GPT-SoVITS", "HeyGem.ai",
)


def verified_files(source, entry):
    """Validate the fixed manifest without executing third-party code."""
    expected = set()
    for item in entry["files"]:
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("清单含不安全路径")
        candidate = source / relative
        if any(parent.is_symlink() for parent in (candidate, *candidate.parents)):
            raise ValueError("可选源码中不允许符号链接")
        if not candidate.is_file():
            raise ValueError("源码文件缺失：" + str(relative))
        contents = candidate.read_bytes()
        if len(contents) != item["bytes"] or hashlib.sha256(contents).hexdigest() != item["sha256"]:
            raise ValueError("源码文件校验失败：" + str(relative))
        expected.add(relative.as_posix())
    actual = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
    if actual != expected:
        raise ValueError("工具源码目录包含清单外文件；请保留并人工检查")
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=NAMES, help="只恢复指定工具")
    parser.add_argument("--apply", action="store_true", help="显式复制到不存在的运行目录")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    vendor = root / "vendor" / "optional-sources"
    runtime = root / ".npc-runtime"
    if runtime.is_symlink():
        raise ValueError("拒绝写入符号链接形式的 .npc-runtime")
    if runtime.exists() and not runtime.is_dir():
        raise ValueError(".npc-runtime 已存在且不是目录")
    manifest = json.loads((vendor / "manifest.json").read_text(encoding="utf-8"))
    entries = {item["name"]: item for item in manifest["repositories"]}
    if set(entries) != set(NAMES):
        raise ValueError("可选工具清单不完整或包含未知名称")
    selected = (args.only,) if args.only else NAMES
    plans = []
    for name in selected:
        target = runtime / name
        source = vendor / name
        count = len(verified_files(source, entries[name]))
        if target.exists() or target.is_symlink():
            raise ValueError("目标已经存在，不会覆盖或合并：.npc-runtime/" + name)
        plans.append((name, source, target, count))
    print("将恢复以下源码：" if args.apply else "仅核对与展示计划（未写入运行目录）：")
    for name, source, target, count in plans:
        print("  {} → .npc-runtime/{}（{} 文件）".format(name, name, count))
    if args.apply:
        runtime.mkdir(exist_ok=True)
        for name, source, target, count in plans:
            # copytree creates its target with exist_ok=False, including if a
            # target appeared after the preflight. No existing files are merged.
            shutil.copytree(source, target, dirs_exist_ok=False)
        print("源码恢复完成；尚未安装环境、下载模型或启动服务。")
    else:
        print("需要实际恢复时加 --apply；已有工具目录始终保留。")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("未执行后续复制：" + str(error), file=sys.stderr)
        sys.exit(1)
