#!/usr/bin/env python3
"""Validate zhiyu-moments output payloads without third-party dependencies."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ALLOWED_DECISIONS = {"post", "no_post"}
ALLOWED_CHECKS = {"pass", "warn", "block"}
ALLOWED_FORMATS = {"text_only", "image_only", "text_image"}


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def number(value: Any) -> bool:
    return type(value) in {int, float}


def parsed_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def action_time(value: Any, field: str, parent: datetime | None, errors: list[str]) -> datetime | None:
    if value is None:
        return None
    timestamp = parsed_time(value)
    if timestamp is None or timestamp.tzinfo is None:
        errors.append(f"{field}: expected timestamp with timezone")
        return None
    if parent is not None and parent.tzinfo is not None and timestamp < parent:
        errors.append(f"{field}: cannot precede source post/comment")
    return timestamp


def validate_context(payload: dict[str, Any], errors: list[str]) -> None:
    context = payload.get("internal_context")
    if not isinstance(context, dict):
        errors.append("internal_context: 1.2 post requires an object")
        return
    if context.get("npc_type") not in {"professional", "companion"}:
        errors.append("internal_context.npc_type: expected professional/companion")
    for key in ("topic_kind", "topic", "event_summary", "share_reason", "format_reason", "image_count_reason"):
        if not nonempty(context.get(key)):
            errors.append(f"internal_context.{key}: expected non-empty string")
    refs = context.get("evidence_refs")
    if not isinstance(refs, list) or not refs or not all(nonempty(ref) for ref in refs):
        errors.append("internal_context.evidence_refs: expected non-empty string array")
    collaboration = context.get("collaboration")
    if collaboration is not None:
        if not isinstance(collaboration, dict):
            errors.append("internal_context.collaboration: expected object or null")
        else:
            if not nonempty(collaboration.get("event_id")):
                errors.append("collaboration.event_id: expected non-empty string")
            participants = collaboration.get("participants")
            roles = collaboration.get("roles")
            if not isinstance(participants, list) or len(participants) < 2 or not all(nonempty(p) for p in participants):
                errors.append("collaboration.participants: expected at least two participant IDs")
            elif len(set(participants)) != len(participants) or payload.get("npc_id") not in participants:
                errors.append("collaboration.participants: unique IDs including author required")
            elif not isinstance(roles, dict) or not all(nonempty(roles.get(p)) for p in participants):
                errors.append("collaboration.roles: each participant requires a role")
            action_time(collaboration.get("occurred_at"), "collaboration.occurred_at", None, errors)
    roundup = context.get("roundup")
    if context.get("topic_kind") == "roundup" and not isinstance(roundup, dict):
        errors.append("internal_context.roundup: roundup topic requires coverage details")
    if isinstance(roundup, dict):
        start = action_time(roundup.get("covered_from"), "roundup.covered_from", None, errors)
        end = action_time(roundup.get("covered_to"), "roundup.covered_to", start, errors)
        post_time = parsed_time(payload.get("scheduled_at"))
        if start is None or end is None:
            errors.append("roundup: both coverage timestamps are required")
        if end is not None and post_time is not None and post_time.tzinfo is not None and end > post_time:
            errors.append("roundup.covered_to: cannot be later than scheduled_at")
        if not nonempty(roundup.get("new_content_reason")):
            errors.append("roundup.new_content_reason: expected non-empty string")
        refs = roundup.get("source_event_ids")
        if not isinstance(refs, list) or not refs or not all(nonempty(ref) for ref in refs):
            errors.append("roundup.source_event_ids: expected non-empty string array")


def validate_interactions(payload: dict[str, Any], errors: list[str]) -> None:
    plan = payload.get("interaction_plan")
    if not isinstance(plan, dict):
        errors.append("interaction_plan: 1.2 post requires an object")
        return
    author = payload.get("npc_id")
    post_time = parsed_time(payload.get("scheduled_at"))
    liked: set[str] = set()
    action_ids: set[str] = set()
    parents: dict[str, tuple[str, datetime | None]] = {}
    context = plan.get("comment_context", [])
    if not isinstance(context, list):
        errors.append("interaction_plan.comment_context: expected array")
        context = []
    for item in context:
        if not isinstance(item, dict) or not all(nonempty(item.get(k)) for k in ("id", "actor_id", "text")):
            errors.append("comment_context: id/actor_id/text required")
            continue
        item_id = item["id"]
        if item_id in action_ids:
            errors.append("comment_context: duplicate comment ID")
        action_ids.add(item_id)
        timestamp = action_time(item.get("published_at"), "comment_context.published_at", post_time, errors)
        if timestamp is None:
            errors.append("comment_context.published_at: verified publication timestamp required")
        parents[item_id] = (item["actor_id"], timestamp)
    for kind in ("likes", "comments", "author_replies"):
        items = plan.get(kind)
        if not isinstance(items, list):
            errors.append(f"interaction_plan.{kind}: expected array")
            continue
        for item in items:
            if not isinstance(item, dict):
                errors.append(f"interaction_plan.{kind}: each action must be an object")
                continue
            label = f"interaction_plan.{kind}"
            for key in ("actor_id", "reason_code", "reason"):
                if not nonempty(item.get(key)):
                    errors.append(f"{label}.{key}: expected non-empty string")
            refs = item.get("evidence_refs")
            if not isinstance(refs, list) or not refs or not all(nonempty(ref) for ref in refs):
                errors.append(f"{label}.evidence_refs: expected non-empty string array")
            actor = item.get("actor_id")
            if not nonempty(actor):
                continue
            parent_time = post_time
            if kind == "likes":
                if actor == author or actor in liked:
                    errors.append("interaction_plan.likes: no self-like or duplicate actor")
                liked.add(actor)
            else:
                item_id = item.get("id")
                if not nonempty(item_id) or item_id in action_ids:
                    errors.append(f"{label}.id: unique non-empty action ID required")
                else:
                    action_ids.add(item_id)
                if not nonempty(item.get("text")):
                    errors.append(f"{label}.text: expected non-empty public text")
                if kind == "comments" and actor == author:
                    errors.append("interaction_plan.comments: author uses author_replies")
                if kind == "author_replies":
                    if actor != author:
                        errors.append("interaction_plan.author_replies: actor must be author")
                    target = item.get("reply_to")
                    parent = parents.get(target) if isinstance(target, str) else None
                    if parent is None or parent[0] == author:
                        errors.append("interaction_plan.author_replies.reply_to: requires another actor's original comment")
                    else:
                        parent_time = parent[1] or post_time
            timestamp = action_time(item.get("scheduled_at"), f"{label}.scheduled_at", parent_time, errors)
            if kind == "comments" and nonempty(item.get("id")):
                parents[item["id"]] = (actor, timestamp)
    silent = plan.get("silent_decisions", [])
    if not isinstance(silent, list) or not all(isinstance(item, dict) and nonempty(item.get("actor_id")) and nonempty(item.get("reason")) for item in silent):
        errors.append("interaction_plan.silent_decisions: expected actor_id/reason objects")


def require(obj: dict[str, Any], key: str, expected: type, errors: list[str]) -> Any:
    value = obj.get(key)
    if not isinstance(value, expected):
        errors.append(f"{key}: expected {expected.__name__}")
    return value


def iso8601(value: Any, field: str, errors: list[str]) -> None:
    if not isinstance(value, str):
        errors.append(f"{field}: expected ISO-8601 string")
        return
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{field}: invalid ISO-8601 timestamp")


def validate(payload: dict[str, Any], max_chars: int) -> list[str]:
    errors: list[str] = []
    require(payload, "schema_version", str, errors)
    require(payload, "request_id", str, errors)
    require(payload, "npc_id", str, errors)
    decision = require(payload, "decision", str, errors)
    require(payload, "timezone", str, errors)
    iso8601(payload.get("generated_at"), "generated_at", errors)

    if decision not in ALLOWED_DECISIONS:
        errors.append(f"decision: expected one of {sorted(ALLOWED_DECISIONS)}")
        return errors

    if decision == "no_post":
        reasons = payload.get("reason_codes")
        if not isinstance(reasons, list) or not reasons:
            errors.append("reason_codes: no_post requires at least one reason")
        return errors

    version12 = payload.get("schema_version") == "1.2"
    cadence = payload.get("cadence_assessment")
    if version12 and not isinstance(cadence, dict):
        errors.append("cadence_assessment: 1.2 post requires an object")
    if isinstance(cadence, dict):
        limit = cadence.get("daily_limit")
        count = cadence.get("posts_today")
        minutes = cadence.get("minutes_since_last_post")
        if type(limit) is not int or not 1 <= limit <= 2:
            errors.append("cadence_assessment.daily_limit: must be 1 or 2")
        if type(count) is not int or count < 0 or (type(limit) is int and count >= limit):
            errors.append("cadence_assessment.posts_today: daily posting limit already reached/invalid count")
        if minutes is not None and (not number(minutes) or minutes < 120):
            errors.append("cadence_assessment.minutes_since_last_post: minimum 120 minutes")

    post = payload.get("post")
    if not isinstance(post, dict):
        errors.append("post: decision=post requires an object")
        return errors

    post_format = post.get("format")
    if post_format not in ALLOWED_FORMATS:
        errors.append(f"post.format: expected one of {sorted(ALLOWED_FORMATS)}")

    text_value = post.get("text")
    if not isinstance(text_value, str):
        errors.append("post.text: expected string")
    elif post_format == "image_only" and text_value.strip():
        errors.append("post.text: image_only requires an empty string")
    elif post_format in {"text_only", "text_image"} and not text_value.strip():
        errors.append(f"post.text: {post_format} requires non-empty text")
    elif len(text_value) > max_chars:
        errors.append(f"post.text: {len(text_value)} chars exceeds limit {max_chars}")

    image_task = post.get("image_task")
    media = post.get("media")
    if not isinstance(media, list):
        errors.append("post.media: expected array")
        media = []
    if len(media) > 9:
        errors.append("post.media: maximum 9 images")

    if post_format == "text_only":
        if image_task is not None:
            errors.append("post.image_task: text_only requires null")
        if media:
            errors.append("post.media: text_only cannot include media")
    elif post_format in {"image_only", "text_image"}:
        if not isinstance(image_task, dict):
            errors.append(f"post.image_task: {post_format} requires an object")
        else:
            asset_kind = image_task.get("asset_kind")
            if asset_kind not in {"generated_photo", "edit_existing", "chat_screenshot"}:
                errors.append("post.image_task.asset_kind: unsupported value")
            count = image_task.get("count")
            if version12 or count is not None:
                if type(count) is not int or not 1 <= count <= 9:
                    errors.append("post.image_task.count: integer between 1 and 9 required")
                elif media and len(media) != count:
                    errors.append("post.media: generated media count must match image_task.count")
            if version12:
                briefs = image_task.get("image_briefs")
                if not isinstance(briefs, list) or len(briefs) != count or not all(nonempty(item) for item in briefs):
                    errors.append("post.image_task.image_briefs: one non-empty description per image required")

    iso8601(payload.get("scheduled_at"), "scheduled_at", errors)
    if version12:
        action_time(payload.get("scheduled_at"), "scheduled_at", None, errors)
        validate_context(payload, errors)
        validate_interactions(payload, errors)

    checks = payload.get("checks")
    if not isinstance(checks, dict):
        errors.append("checks: expected object")
    else:
        for name in ("continuity", "privacy", "policy"):
            value = checks.get(name)
            if value not in ALLOWED_CHECKS:
                errors.append(f"checks.{name}: expected one of {sorted(ALLOWED_CHECKS)}")
        if any(checks.get(name) == "block" for name in ("continuity", "privacy", "policy")):
            errors.append("blocked continuity/privacy/policy check cannot produce decision=post")

    publish = payload.get("publish_request")
    if publish is not None:
        if not isinstance(publish, dict):
            errors.append("publish_request: expected object or null")
        else:
            if version12:
                allowed = {"adapter", "account_id", "idempotency_key", "scheduled_at", "text", "media_paths"}
                if set(publish) - allowed:
                    errors.append("publish_request: only public adapter fields allowed; internal reasons cannot be published")
            for key in ("adapter", "account_id", "idempotency_key"):
                value = publish.get(key)
                if not isinstance(value, str) or not value.strip():
                    errors.append(f"publish_request.{key}: expected non-empty string")
            media_paths = publish.get("media_paths", [])
            if not isinstance(media_paths, list) or not all(isinstance(item, str) for item in media_paths):
                errors.append("publish_request.media_paths: expected string array")
            elif post_format in {"image_only", "text_image"} and not media_paths:
                errors.append(f"publish_request.media_paths: {post_format} requires at least one file")
            elif post_format == "text_only" and media_paths:
                errors.append("publish_request.media_paths: text_only must be empty")
            if isinstance(media_paths, list):
                if len(media_paths) > 9:
                    errors.append("publish_request.media_paths: maximum 9 images")
                if post_format in {"image_only", "text_image"} and (not media or len(media_paths) != len(media)):
                    errors.append("publish_request.media_paths: require completed media with matching count")
            if version12 and publish.get("text") != text_value:
                errors.append("publish_request.text: must match visible post.text")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate zhiyu-moments output JSON")
    parser.add_argument("payload", type=Path)
    parser.add_argument("--max-chars", type=int, default=2000)
    args = parser.parse_args()

    try:
        data = json.loads(args.payload.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"valid": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 2

    if not isinstance(data, dict):
        print(json.dumps({"valid": False, "errors": ["root: expected object"]}, ensure_ascii=False))
        return 2

    errors = validate(data, args.max_chars)
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
