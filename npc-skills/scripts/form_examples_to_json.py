#!/usr/bin/env python3
"""把《NPC完整人物填写表》第21节的正例反例，转成程序能读取的例子文件。

用法：
    python3 scripts/form_examples_to_json.py <填好的表.md> --character lin-xia
    python3 scripts/form_examples_to_json.py <填好的表.md> --character lin-xia --dry-run

产出 references/<角色ID>-examples.json，字段对齐 references/chen-nian-examples.json。
没有填的行（还是【填】）自动跳过；写文件前会先显示将要写入的内容摘要。
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
TABLE_HEADER_HINT = "用户会说什么"
PLACEHOLDERS = {"【填】", "【填写】", "待定", "不适用", "空", "-", ""}


def cells(line):
    """把一行 markdown 表格拆成单元格。"""
    line = line.strip()
    if not line.startswith("|"):
        return None
    parts = [c.strip() for c in line.strip("|").split("|")]
    return parts


def is_separator(parts):
    return all(re.fullmatch(r":?-{2,}:?", c or "-") for c in parts)


def is_blank(value):
    v = (value or "").strip()
    if v in PLACEHOLDERS:
        return True
    return all(ch in "【】填 　" for ch in v) if "【" in v else False


def strip_quotes(value):
    """去掉首尾引号。只用于用户原话、回复和"不希望"栏，不用于场景标题。"""
    return re.sub(r"^[“”\"'‘’]+|[“”\"'‘’]+$", "", (value or "").strip()).strip()


def clean(value):
    """场景标题：只去空白，保留引号和标点。"""
    return (value or "").strip()


def split_bubbles(value):
    """多条气泡用全角斜杠 ／ 分隔。"""
    parts = [strip_quotes(p) for p in re.split(r"／", value)]
    return [p for p in parts if p]


def split_negative(value):
    """把‘不希望怎么回（原因）’拆成 negative 和 reason。未填则两项都留空。"""
    if is_blank(value):
        return "", ""
    v = strip_quotes(value)
    m = re.search(r"[（(]([^（）()]*)[）)]\s*$", v)
    if m:
        return strip_quotes(v[: m.start()]), m.group(1).strip()
    return strip_quotes(v), ""


def make_prefix(character_id):
    letters = "".join(part[0] for part in re.split(r"[-_]", character_id) if part)
    return (letters or character_id[:2]).upper()


def parse_section21(text):
    """定位第21节的表格并抽出已填的行。"""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        parts = cells(line)
        if parts and TABLE_HEADER_HINT in " ".join(parts) and parts[0] == "场景":
            start = i
            break
    if start is None:
        return [], 0

    header = cells(lines[start])
    if len(header) < 4:
        return [], 0

    rows, skipped = [], 0
    for line in lines[start + 2 :]:
        parts = cells(line)
        if parts is None:
            break
        if is_separator(parts):
            continue
        parts += [""] * (4 - len(parts))
        title, user, reply, avoided = parts[:4]
        if is_blank(title) or is_blank(user) or is_blank(reply):
            skipped += 1
            continue
        negative, reason = split_negative(avoided)
        rows.append(
            {
                "title": clean(title),
                "user": strip_quotes(user),
                "messages": split_bubbles(reply),
                "negative": negative,
                "reason": reason,
            }
        )
    return rows, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("form", help="填好的《NPC完整人物填写表》.md")
    ap.add_argument("--character", required=True, help="角色ID，例如 lin-xia")
    ap.add_argument("--out", help="输出路径，默认 references/<角色ID>-examples.json")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    args = ap.parse_args()

    form = Path(args.form).expanduser()
    if not form.is_file():
        sys.exit(f"找不到文件：{form}")

    text = form.read_text(encoding="utf-8")
    rows, skipped = parse_section21(text)
    if not rows:
        sys.exit("第21节没有已填写的行。请至少填一行：场景／用户会说什么／你希望她怎么回。")

    prefix = make_prefix(args.character)
    digest = hashlib.sha256(form.read_bytes()).hexdigest()
    data = {
        "character_id": args.character,
        "source": str(form),
        "source_version": digest[:16],
        "status": "assistant_proposed",
        "usage": "填表第21节的正例反例；status 为助手拟定，未经用户逐条认可前不作为硬要求。",
        "examples": [
            {
                "id": f"{prefix}-F{i:02d}",
                "title": r["title"],
                "context": "",
                "user": r["user"],
                "messages": r["messages"],
                "negative": r["negative"],
                "reason": r["reason"],
                "status": "assistant_proposed",
            }
            for i, r in enumerate(rows, start=1)
        ],
    }

    out = Path(args.out).expanduser() if args.out else SKILL_ROOT / f"references/{args.character}-examples.json"
    print(f"解析到 {len(rows)} 条已填行，跳过 {skipped} 条未填行")
    for e in data["examples"]:
        print(f"  {e['id']}  {e['title']}  →  {'／'.join(e['messages'])}")
    print("\n提醒：context（当时关系／心情）留空，建议逐条补一句，它是每轮都会读到的。")

    if args.dry_run:
        print("\n--dry-run，未写文件。")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    if out.exists():
        backup = out.with_suffix(out.suffix + ".bak")
        backup.write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"\n原文件已备份到 {backup}")
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入 {out}")
    print("下一步：确认该角色的提示词构建器会读这个文件（参考 server/npc/chen-prompt.ts）。")


if __name__ == "__main__":
    main()
