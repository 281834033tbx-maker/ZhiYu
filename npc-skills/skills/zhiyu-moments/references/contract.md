# 朋友圈与互动候选契约（1.2）

新增内容保持原 `post`、`cadence_assessment`、`publish_request` 结构；新增 `internal_context`、`interaction_plan`。1.1 历史输出可读取，不静默改写旧历史；新生成使用 1.2。校验器可读 1.1，不代表旧结果可按旧每日四条政策继续发布。

## 输入与可信来源

最少输入：`request_id`、`mode`、`now`、`timezone`、`npc`（稳定 ID、现行档案与 professional/companion 类型）、`recent_events`、`recent_posts`、`posting_profile` 和 `policy`。

```json
{
  "request_id": "demo_chef_001",
  "mode": "candidate",
  "now": "2026-10-14T12:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "npc": {
    "id": "zhou-chef",
    "display_name": "赵一帆",
    "fictional": true,
    "npc_type": "professional",
    "posting_profile": {
      "source": "derived_from_character_and_history",
      "average_posts_per_day": 0.4,
      "normal_daily_range": [0, 1],
      "share_motives": ["分享满意的菜品", "认可学员进步"],
      "format_bias": ["text_image"],
      "silence_conditions": ["没有想公开的内容", "事情太私人"]
    }
  },
  "recent_events": [{
    "id": "demo_evt_001",
    "at": "2026-10-14T12:10:00+08:00",
    "type": "work_result",
    "summary": "完成香菇肥牛饭试做",
    "privacy": "public_safe",
    "canon": true
  }],
  "recent_posts": [],
  "chat_context": {"had_chat_today": false},
  "policy": {
    "max_posts_per_day": 2,
    "min_interval_minutes": 120,
    "max_images_per_post": 9,
    "quiet_hours": ["00:00", "07:30"],
    "publish_mode": "review"
  }
}
```

这是合成演练输入。`recent_events` 是后台确认的独立生活来源；聊天是可选补充，未聊天不减分。发帖基线是人物习惯，不是配额。重大事实需要确认来源，不靠模型填 `canon=true` 自行获准。

生成互动时还需宿主提供：可见动态/媒体、当前七人名册及 ID 映射、关系和兴趣状态、真正看见动态的记录、已有点赞/公开评论；联动需共同活动记录，返图需分享许可，热量需份量依据。缺少参与者资料时不编身份或互动；缺少可见性时保留候选或不参与。

**宿主独立核验**：在 `scheduled_at` 所属时区的自然日统计已经发布及占用该时段的计划；重查间隔、素材去重、可见性与权限。模型输出 `pass` 或数量不能代替真实历史校验。策略可以更严格，不能放宽每日 2 条、间隔 120 分钟、每条 9 图。

## 无动态

```json
{
  "schema_version": "1.2",
  "request_id": "demo_chef_001",
  "npc_id": "zhou-chef",
  "decision": "no_post",
  "generated_at": "2026-10-14T12:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "reason_codes": ["DAILY_LIMIT"],
  "next_check_after": "2026-10-15T09:30:00+08:00",
  "questions": []
}
```

`no_post` 不安排本条互动。原因码可用 `LOW_SIGNAL`、`CHARACTER_WOULD_NOT_SHARE`、`RECENT_POST_TOO_CLOSE`、`QUIET_HOURS`、`DAILY_LIMIT`、`PRIVACY_RISK`、`CONTINUITY_CONFLICT`、`MISSING_CANON`、`DUPLICATE_CONTENT`、`ROUNDUP_TOO_CLOSE`。禁止 `NO_CHAT`、`USER_INACTIVE` 或同义原因。

## 有动态：主题、动机、图数与互动依据

```json
{
  "schema_version": "1.2",
  "request_id": "demo_chef_001",
  "npc_id": "zhou-chef",
  "decision": "post",
  "generated_at": "2026-10-14T12:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "scheduled_at": "2026-10-14T12:35:00+08:00",
  "cadence_assessment": {
    "posts_today": 0,
    "average_posts_per_day": 0.4,
    "within_character_baseline": true,
    "daily_limit": 2,
    "minutes_since_last_post": null
  },
  "internal_context": {
    "npc_type": "professional",
    "topic_kind": "work_result",
    "topic": "新菜：香菇肥牛饭",
    "event_summary": "完成当天的一份香菇肥牛饭",
    "share_reason": "成品满意，想展示今天做出的菜",
    "format_reason": "成品照片是主体，短文补一个拌饭细节",
    "image_count_reason": "一张成品照已经完整表达，不需要重复角度",
    "evidence_refs": ["demo_evt_001"],
    "professional_detail": "收汁保留一些汤汁，方便拌饭",
    "collaboration": null,
    "roundup": null
  },
  "post": {
    "format": "text_image",
    "text": "香菇肥牛饭。最后留点汁，拌饭正好。",
    "visibility": "default",
    "location_label": null,
    "media": [],
    "image_task": {
      "asset_kind": "generated_photo",
      "event": "刚做好的香菇肥牛饭",
      "share_reason": "分享满意的成品",
      "delivery_context": "wechat_moments",
      "subject": "一碗有香菇、肥牛和少量汤汁的米饭",
      "capture_mode": "普通手机后置拍摄",
      "face_visibility": "不出现",
      "count": 1,
      "image_briefs": ["厨房桌面上一碗香菇肥牛饭，突出完整成品与少量汤汁"],
      "must_include": ["自然生活感"],
      "must_avoid": ["广告布景"]
    },
    "media_result": null
  },
  "interaction_plan": {
    "likes": [{
      "actor_id": "xia-xia",
      "reason_code": "INTEREST_MATCH",
      "reason": "她喜欢美食分享，这碗饭的卖相吸引她",
      "evidence_refs": ["public:post.media[0]"],
      "scheduled_at": "2026-10-14T12:44:00+08:00"
    }],
    "comments": [{
      "id": "demo_comment_001",
      "actor_id": "xia-xia",
      "text": "这个汁拌饭肯定很香🥹",
      "reason_code": "SPECIFIC_APPRECIATION",
      "reason": "对配文里的拌饭细节有兴趣，愿意热情接话",
      "evidence_refs": ["public:post.text"],
      "scheduled_at": "2026-10-14T12:46:00+08:00"
    }],
    "author_replies": [{
      "id": "demo_reply_001",
      "actor_id": "zhou-chef",
      "reply_to": "demo_comment_001",
      "text": "留一点就够，别把饭泡了。",
      "reason_code": "PROFESSIONAL_ANSWER",
      "reason": "接住对汤汁的认可，补充一个简短的做法细节",
      "evidence_refs": ["public:demo_comment_001"],
      "scheduled_at": "2026-10-14T12:51:00+08:00"
    }],
    "comment_context": [],
    "silent_decisions": []
  },
  "source_event_ids": ["demo_evt_001"],
  "new_memory_candidates": [],
  "checks": {
    "voice_match": 0.91,
    "continuity": "pass",
    "privacy": "pass",
    "duplicate_risk": "low",
    "policy": "pass"
  },
  "publish_request": null,
  "questions": []
}
```

上例是文字候选，尚未生成图片或执行任何互动。演练日期、ID、人物共处不写入正式记忆。

### 内部字段说明

- `internal_context`：`npc_type` 为 professional/companion；`topic_kind` 可用 work_result、learner_feedback、professional_daily、collaboration、daily_life、travel、food、exhibition、friends、roundup 等清楚主题；`topic` 和 `event_summary` 写具体内容；`share_reason`、`format_reason`、`image_count_reason` 是一两句可核对的依据，不是长推理。纯文字的图数理由写“不需要图片”。
- `evidence_refs`：非空来源引用数组；不得直接存敏感原文。模拟来源用 demo 标记。正文、可见图片和已公开评论对观察者用 public 引用；自己的有效记忆可由宿主许可使用，不能把作者私聊或内部判断传给其他人物。
- `professional_detail`：可空；专业感可以由照片或成果体现，不硬塞科普。
- `collaboration`：可空；有联动时存 `{event_id, participants, roles, occurred_at, location}`，`participants` 是稳定 ID 数组，`roles` 对应每位参与者的实际分工，日期/地点来自同一个活动；不由互相评论推导共同经历。
- `roundup`：仅合集使用，存 `{covered_from, covered_to, source_event_ids, days_since_last_roundup, new_content_reason}`；时间含时区，不晚于发布时间。首次合集的间隔可空。4—5 天是通常节奏，语义复核重复内容与间隔，不作定时配额或拦截新的单次活动。
- `interaction_plan`：必有 `likes`、`comments`、`author_replies` 数组，可以全部为空。每个行为必有 `actor_id`、`reason_code`、`reason`、`evidence_refs`；评论/回复另有 `id`、`text`，回复有 `reply_to`。`scheduled_at` 可省略，给出时不得早于动态或原评论。
- `comment_context`：回复已经存在的评论时，带宿主确认的公开 `{id, actor_id, text, published_at}`；只用于定位，不编造已发布评论。回复目标必须来自本计划的 comments 或此上下文，不能指向回复本身。执行时将候选 ID 映射到真实回执 ID。
- `silent_decisions`：可选，针对需要解释的未参与者记录 `{actor_id, reason}`；无需给所有人凑“不赞理由”。演员同一动态不自赞、点赞不重复，作者回复只由作者产生，不循环回复自己。
- 理由码是分类索引，例 INTEREST_MATCH、RELATIONSHIP_SUPPORT、SPECIFIC_APPRECIATION、SHARED_EVENT、PROFESSIONAL_ANSWER、NATURAL_ACKNOWLEDGEMENT、LIGHT_TEASING；具体 `reason` 才回答为什么参与，不仅填码。

### 图片与可见内容

- `text_only`：正文非空，`image_task=null`，`media=[]`。
- `image_only`：正文空字符串，有 `image_task`，不能偷偷配隐藏文案。
- `text_image`：正文非空，有 `image_task`。
- 1.2 图片候选必有整数 `count`（实际需要张数）与等长 `image_briefs` 逐张描述。制作前 `media=[]`、`media_result=null` 正常；用户只要文字说明时止于此。
- 实际图片完成后 `media` 数量等于 `count`。进入 publish_ready/publish 必须有验收通过的媒体；失败不能静默换形式。独立表情包计一张，照片上的贴纸不另计。
- 聊天截图仍只用有效分支已送达的连续真实消息 ID，由 `$zhiyu-imagegen` 的真实界面路线制作，不润色原话。

## 发布请求与可见字段白名单

候选阶段 `publish_request=null`。只有 publish_ready/publish 且具备发布接口时生成：

```json
{
  "adapter": "wechat_moments",
  "account_id": "npc_zhou-chef",
  "idempotency_key": "npc_zhou-chef_demo_evt001",
  "scheduled_at": "2026-10-14T12:35:00+08:00",
  "text": "香菇肥牛饭。最后留点汁，拌饭正好。",
  "media_paths": ["/absolute/path/photo.png"]
}
```

动态发布适配器只取上面字段；互动适配器只取身份、动作 ID、动态 ID、评论/回复正文、回复目标和执行时间。**internal_context、reason、reason_code、evidence_refs、silent_decisions 都不进入可见文案、外部请求或观察者上下文**。现有接口若用 post.reason 当 theme，不能传入新私有依据；只传脱敏的公开内容。

实际执行需要本次或持续授权覆盖人物、账号、平台与时间，保存 external_post_id / published_at / account_id / status 及互动回执，使用幂等 ID 防重复。候选、校验成功、publish_ready 都不是已经发布或已经点赞。

`validate_payload.py` 检查结构、图数、声明的节奏、回复关联与给出的时间；人物合适度、合集节奏、热量正确性、隐私许可与宿主历史仍需语义/来源复核。本次升级契约不自动接入 App 的 TS 发布和互动接口。
