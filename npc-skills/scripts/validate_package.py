#!/usr/bin/env python3
"""Read-only validation of this evidence package; not an NPC/model evaluator."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []


def check(condition, message):
    if not condition:
        errors.append(message)


def read_json(relative):
    try:
        return json.loads((ROOT / relative).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        errors.append(f"{relative}: {exc}")
        return {}


skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
check(skill.startswith("---\nname: npc-skills\n"), "Skill name/frontmatter mismatch")
check("description:" in skill.split("---", 2)[1], "Missing description")
corrections = (ROOT / "references/corrections.md").read_text(encoding="utf-8")
questions = (ROOT / "references/open-questions.md").read_text(encoding="utf-8")
correction_ids = set(re.findall(r"^## (C\d+)", corrections, re.M))
question_ids = set(re.findall(r"\| (Q\d+) \|", questions))
dialogues = read_json("references/dialogues.json")
accepted = read_json("references/accepted-examples.json")
feedback = read_json("references/user-feedback.json")
tests = read_json("tests/cases.json")

turns = [t for s in dialogues.get("sessions", []) for t in s.get("turns", [])]
profiles = dialogues.get("profile_examples", [])
controls = dialogues.get("controls", [])
all_evidence = turns + profiles + controls
ids = [x["id"] for x in all_evidence]
check(len(ids) == len(set(ids)), "Duplicate evidence IDs")
turn_by_id = {x["id"]: x for x in turns + profiles}
valid_status = {"unreviewed", "superseded", "criticized", "review_required", "mixed", "rolled_back", "assistant_proposed"}
check(dialogues.get("default_reply_status") == "unreviewed", "Unsafe default approval")
for turn in turns + profiles:
    check(isinstance(turn.get("npc"), list), f"{turn['id']}: messages must be list")
    check(turn.get("status", "unreviewed") in valid_status, f"{turn['id']}: invalid status")
    for cid in turn.get("corrections", []):
        check(cid in correction_ids, f"{turn['id']}: unknown correction {cid}")

for control in controls:
    for key in ("before", "after"):
        if key in control:
            check(control[key] in turn_by_id, f"{control['id']}: invalid {key}")
    for cid in control.get("corrections", []):
        check(cid in correction_ids, f"{control['id']}: unknown correction")

approved = accepted.get("examples", [])
for item in feedback.get("items", []):
    check(bool(item.get("text")), f"{item['id']}: missing feedback text")
    for cid in item.get("corrections", []):
        check(cid in correction_ids, f"{item['id']}: unknown correction {cid}")
for example in approved:
    eid = example["id"]
    check(example.get("status") in {"user_suggested", "user_endorsed_fragment"}, f"{eid}: unsafe approval status")
    check(example.get("correction_id") in correction_ids, f"{eid}: missing correction provenance")
    check(bool(example.get("scope")) and bool(example.get("not_implied")), f"{eid}: missing scope guard")
    source_id = example.get("source_turn_id")
    if source_id:
        check(source_id in turn_by_id, f"{eid}: unknown source turn")
        if source_id in turn_by_id:
            check(turn_by_id[source_id].get("status") not in {"criticized", "rolled_back", "superseded"}, f"{eid}: rejected source promoted")
            source_text = "\n".join(turn_by_id[source_id]["npc"])
            for text in example.get("texts", []):
                check(text in source_text, f"{eid}: endorsed fragment not found in source")

source_ids = set(ids) | correction_ids | question_ids | {x["id"] for x in approved}
case_ids = [x["id"] for x in tests.get("cases", [])]
check(len(case_ids) == len(set(case_ids)), "Duplicate test IDs")
check(len(case_ids) >= 30, "Missing expected regression coverage")
check(tests.get("model_execution_status") == "not_run", "Do not claim model execution without results")
for case in tests.get("cases", []):
    for key in ("id", "type", "source_ids", "character", "context", "messages", "must", "must_not"):
        check(bool(case.get(key)), f"{case.get('id')}: missing {key}")
    for source_id in case.get("source_ids", []):
        check(source_id in source_ids, f"{case['id']}: unknown source {source_id}")

# Optional provenance metadata added by incremental task imports.
source_task_ids = [x["id"] for x in dialogues.get("source_tasks", [])]
check(len(source_task_ids) == len(set(source_task_ids)), "Duplicate source task IDs")
feedback_by_id = {x["id"]: x for x in feedback.get("items", [])}
check(len(feedback_by_id) == len(feedback.get("items", [])), "Duplicate feedback IDs")
check(len({x["id"] for x in approved}) == len(approved), "Duplicate example IDs")
for item in all_evidence + feedback.get("items", []) + approved + dialogues.get("sessions", []):
    task_id = item.get("source_task_id")
    if task_id:
        check(task_id in source_task_ids, f"{item['id']}: unknown source task {task_id}")
    for feedback_id in item.get("feedback_ids", []):
        check(feedback_id in feedback_by_id, f"{item['id']}: unknown feedback {feedback_id}")
        if feedback_id in feedback_by_id and item.get("correction_id"):
            check(item["correction_id"] in feedback_by_id[feedback_id].get("corrections", []),
                  f"{item['id']}: feedback/correction mismatch")

for path in ROOT.rglob("*.md"):
    text = path.read_text(encoding="utf-8")
    for link in re.findall(r"\]\(([^)]+)\)", text):
        if "://" in link or link.startswith("#"):
            continue
        target = (path.parent / link.split("#", 1)[0]).resolve()
        check(target.is_file(), f"{path.relative_to(ROOT)}: broken link {link}")
    for source_id in re.findall(r"(?<![A-Za-z0-9])S\d{2}-\d{2}(?![0-9])", text):
        check(source_id in turn_by_id, f"{path.relative_to(ROOT)}: unknown dialogue reference {source_id}")

liu = (ROOT / "references/characters/liu-zhimin.md").read_text(encoding="utf-8")
check("pending_identity_mapping" in liu, "Missing Liu identity uncertainty")
check(not list(ROOT.rglob("*.tsx")), "Unexpected application code in package")

if errors:
    print("FAIL")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print("PASS: package structure and evidence references")
print(f"Dialogue turns: {len(turns)}; profile/concept examples: {len(profiles)}; control events: {len(controls)}")
print(f"Corrections: {len(correction_ids)}; endorsed/suggested entries: {len(approved)}; test cases: {len(case_ids)}")
print("Not executed: live model behavior, UI integration, timers, database, fine-tuning")
