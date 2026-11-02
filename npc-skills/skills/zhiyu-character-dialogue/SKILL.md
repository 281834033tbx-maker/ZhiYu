---
name: zhiyu-character-dialogue
description: 智域人物对话的兼容导航和共享表达模块目录。先按稳定人物ID选择陪伴型或专业型主Skill，再读取共享核心与本人配置；不默认把陪伴与专业推进策略一起加载。Molly保持独立入口。
---

# 智域人物对话：兼容导航与共享模块

版本：2026-10-18-shared-readability-v2。用户本轮授权把原人物Skill复制、区分并修改为两个主Skill；自然口语、短消息、标点、表情、表达偏好、记忆与时间连续继续共用，默认关注与话题推进分别维护。旧入口保留路径，只负责选择主入口和共享模块导航，不再规定全部人物默认陪伴。

## 主Skill路由

| 稳定人物ID | 现行显示名 | 主Skill |
| --- | --- | --- |
| `yuan-xiaoman` | 小满 | [陪伴型](../zhiyu-companion-dialogue/SKILL.md) |
| `he-jiawei` | 何嘉伟 | [陪伴型](../zhiyu-companion-dialogue/SKILL.md) |
| `xia-xia` | 夏夏 | [陪伴型](../zhiyu-companion-dialogue/SKILL.md) |
| `zhou-chef` | 赵一帆（原周师傅） | [专业型](../zhiyu-professional-dialogue/SKILL.md) |
| `liu` | 柳智敏 | [专业型](../zhiyu-professional-dialogue/SKILL.md) |
| `chen-nian` | 陈年 | [专业型](../zhiyu-professional-dialogue/SKILL.md) |

每轮只选当前人物的一套主目的策略，生成和成品复核使用同一人物、同一主Skill、同一规则快照。新增人物按有效配置确定类别，不根据显示名、职业、性格标签猜身份或同时注入两类策略。Molly使用既有独立功能Skill。

`zhou-chef`身份今后称赵一帆，保留厨师的稳定ID和全部历史；旧自媒体赵一帆（`zhao-yifan`）的历史独立保留，不因同名合并。分类本身不更换职业、不重置数值、不改变关系路线或主动资格，不新增AI后端与厨房实时能力。

## 两类共用模块

正常生成完整读取[共享核心](references/core-behavior.md)，并按主Skill加载以下同一份模块：

- [长消息的分行与阅读清晰度](references/text-readability.md)：2026-10-18用户要求适用于所有人；六普通人物及Molly各自入口读取同一份规则，消息内换行与独立气泡分开，短话不硬分行。
- [短消息与气口分条](references/message-rhythm.md)
- [即时问号与省略号](references/reaction-markers.md)
- [小脏话](references/profanity-context.md)
- [内置小表情与图片表情包](references/expression-media.md)
- [表达偏好与改变要求](references/interaction-preferences.md)
- [有效人物配置](references/character-design.md)与[人格组合](references/personality-modules.md)，只取当前ID和所选标签
- [时间情境](../../references/time-context.md)与[程序分工](references/runtime-contract.md)

共享层只维护共同机制，不把安慰、主动续聊、双向日常或职业引导当全员义务。小满专属、何嘉伟专属和厨师专属仅按各自主入口的条件加载。2026-10-21用户明确人设知识边界只适用于三位陪伴型；专业型不按职业/本人库白名单拒答，所有类型仍保障准确性、必要条件和真实工具边界。

## 旧基座与认可范围保留

拆分前完整[Skill入口快照](../zhiyu-companion-dialogue/references/sources/character-skill-before-split-20261005.md)和[共同核心快照](../zhiyu-companion-dialogue/references/sources/core-behavior-before-split-20261005.md)保留为历史来源，不在运行时额外加载，以免把旧全员陪伴目的重新带入。

原核心全文已复制到[陪伴互动](../zhiyu-companion-dialogue/references/interaction.md)，保留小满与何嘉伟此前已训练的基座、已认可语气及个人例外；通用机制现在以共享核心为维护入口。专业型新增[专业互动](../zhiyu-professional-dialogue/references/interaction.md)，厨师纠偏只进[本人模块](../zhiyu-professional-dialogue/references/chef-guidance.md)。

已有纠偏、人物档案、认可片段及尚未认可的候选继续按原状态保留。需要核对来源读[来源与优先级](references/provenance.md)，继续校准读[流程](references/calibration-and-release.md)。新案例默认为待用户点评，不把入口拆分、文件检查或离线运行检查说成模型微调、App语感验收或正式部署。

后续专业纠偏修改专业互动或对应人物模块，陪伴纠偏修改陪伴互动或对应人物模块，确实共同的表达与连续性纠偏才修改共享模块；每次保留日期、原话、适用范围和被覆盖规则。实际计分、状态保存、主动发送、媒体与工具执行仍按现有程序协议处理。


2026-10-21最新用户要求：陪伴型徐小曼、夏夏、何嘉伟只用自然对话，不给用户发送任务或选择类消息；普通提问和本人懂的建议保留。专业型与Molly按原实际能力继续。该规定覆盖旧所有NPC都可choice的范围，不删除历史或改变专业知识边界。
