# 任务合同

本 Skill 只接收已经由对话、朋友圈或其他业务逻辑确定的图片任务。

## 输入字段

- `asset_kind`：`generated_photo`、`edit_existing` 或 `chat_screenshot`。这是必填路由字段。
- `npc_id`：NPC 唯一标识；无人物物件照也要标记照片归属。
- `event`：已确定的当前事件。
- `location_time`：地点、时间、天气和环境。
- `share_reason`：上游已确定的分享动机；本 Skill 只把它转为镜头距离和可见内容。
- `delivery_context`：上游已确定的用途，例如私聊发送或朋友圈发布；本 Skill 据此控制修图程度，不决定发布渠道。
- `subject`：饭菜、物件、环境、脸、全身或身体局部。
- `capture_mode`：普通后置拍摄、直接自拍、镜面自拍、第一人称局部、他人拍摄或组图。
- `face_visibility`：不出现、部分出现或清楚出现。
- `emotion_cue`：若是想念或轻微委屈自拍，由上游提供已成立的情绪与强度；缺失时按自然中性表情，不把用户暂未回复推断成被冷落。
- `references`：每张引用图的路径和唯一角色。
- `source_image`：如果同一照片先前已经发给用户，提供原图路径或资产 ID；后续朋友圈版本必须从这张图编辑产生，并记录版本关联。
- `count`：图片数量。
- `must_include` / `must_avoid`：显式不变项和禁止项。
- `continuity_anchor`：组图的时间、服装、发型、光线和物件位置。
- `message_source`：仅 `chat_screenshot` 使用；包含当前有效分支 ID、连续且已送达的消息 ID、发送者角色、原文、时间和当前应用内用户头像引用。不得只传改写后的摘要。

## 缺失处理

- 如果脸必须清楚出现，却没有该 NPC 的正式身份引用，不要把临时生成的脸声称为定稿。
- 纯食物、物件或环境照不需要加载人脸引用。
- 已确定要精修并复用先前照片、但缺少 `source_image` 时，先向上游索取或查找原图；不能另生成一张不同照片冒充同一张的精修版。
- 缺少不影响用户意图的摄影细节时可合理推断；不得推断新人物、新关系或新剧情。
- 当前程序的 `generate_photo` 只接收 `prompt`、`caption` 与 `withCharacter` 等有限字段；上游已确定的镜头类型、情绪依据、时间地点与连续性应写进 `prompt`，本 Skill 不因缺少独立字段而自行决定分享动机。自拍或人物入镜用 `withCharacter=true`，纯环境／物件用 `false`。当前合同只交付静态图片，不将视频任务伪装为照片。
- `chat_screenshot` 缺少有效分支或原始消息 ID 时直接返回失败，不根据摘要补造聊天内容，也不降级为生成式图片。

## 输出字段

```json
{
  "media_result": {
    "status": "ready",
    "asset_kind": "generated_photo",
    "production_method": "system_imagegen",
    "files": ["/absolute/path/image.png"],
    "checks": {},
    "limitations": []
  }
}
```

`production_method` 可为 `system_imagegen`、`source_image_edit` 或 `native_chat_renderer`。失败时 `status=failed`、`files=[]`，并返回可执行的失败原因；不得声称图片已经生成。

## 朋友圈聊天截图任务示例

动态 Skill 每次决定分享某段聊天后，必须把具体图片要求和原始消息一起传入，不能只传“做一张聊天截图”这句话：

```json
{
  "asset_kind": "chat_screenshot",
  "npc_id": "yuan-xiaoman",
  "event": "与用户的聊天让小满特别开心，她决定分享其中一段",
  "share_reason": "记录这次明显的开心情绪，但不公开用户身份",
  "delivery_context": "wechat_moments",
  "subject": "当前有效分支中的连续聊天片段",
  "count": 1,
  "message_source": {
    "branch_id": "branch_runtime_id",
    "messages": [
      {
        "message_id": "msg_user_001",
        "sender": "user",
        "text": "<程序读取的用户原文>",
        "sent_at": "<原始发送时间>"
      },
      {
        "message_id": "msg_npc_002",
        "sender": "npc",
        "text": "<程序读取的小满原文>",
        "sent_at": "<原始发送时间>",
        "read": true
      }
    ],
    "user_avatar_ref": "<当前应用内用户头像资产>"
  },
  "must_include": [
    "NPC消息在右侧且不显示NPC头像",
    "用户消息在左侧且显示当前应用内用户头像",
    "只截取聊天内容区域",
    "已读双对号只出现在NPC已读的右侧消息上",
    "气泡、字体、间距、时间和回执使用宿主真实聊天组件"
  ],
  "must_avoid": [
    "顶部会话头像、昵称、状态或导航栏",
    "真实用户昵称、账号、通知和输入框",
    "润色、重排、删改或补造消息",
    "用生成模型、HTML近似界面、emoji或文字字符仿造控件"
  ]
}
```

占位符必须在实际任务中由程序的原始记录替换。没有真实 `branch_id`、消息 ID、原文或用户头像引用时，返回失败，不制作示意图冒充真实截图。
