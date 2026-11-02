# 陈年本地聊天接入

2026-09-22 在新 Mac 上接入。人物来源：`chen-nian-zhiyu` Skill（快照日 2026-09-19）与 `chen-nian-visual-style` Skill。角色完全虚构、成年，28岁男性，祖籍黑龙江、广州出生长大、现居深圳；“折返实验室”创始人，三人团队，事业保持 A 阶段，不因聊天或恋爱自动融资成功。

人物现行档案：npc-skills/references/characters/chen-nian.md（404行）。聊天习惯：短期初识先接住具体话，句子短而直接，前期即有明显东北口语、嘴欠幽默、轻微对抗路和抽象表情包偏好；不写长篇自我介绍、不解释笑话、不每轮提问。原则性问题、认真道歉、真实受伤和激烈争吵时收起调侃。恋爱前分享与追问保持分寸，确认恋爱后转粘人小狗式。

本机入口：http://localhost:3100/?npc=chen-nian#chat 。调试分支：`?npc=chen-nian&relationship=lovers#chat`、`&scenario=early-sharing&growth=30`（后者使用独立会话，不污染普通会话）。生产静态/云端构建不提供本机 NPC 接口，未部署公网。

## 接入内容

独立文件（可由 Skill 的 `install_core.py` 安全安装，只补缺失、不覆盖）：`lib/npc/chen-nian.ts`、`server/npc/{chen-plugin,chen-prompt,chen.test}.ts`、`public/npc/chen-nian/{avatar.svg,avatar-20260926.png,share-workdesk-v1.png,share-rainy-selfie-v1.png,share-rainy-selfie-v2.png}`、`npc-skills/references/characters/chen-nian.md`、`npc-skills/references/chen-nian-examples.json` 及两份原稿。

共享文件按各文件较新版本合并，未整文件覆盖：

- `vite.config.ts`：注册 `chenLocal()`。
- `lib/npc/contracts.ts`：新增 `chenWorkdesk`/`chenRainySelfie` 两个 `photo` 素材；`PublicSession` 补回 `relationship`/`sharingEligible`/`positiveGrowth` 三个可选字段（陈年插件返回它们）。
- `lib/npc/molly.ts`：`mollyCatalog` 加入陈年，当前头像 `/npc/chen-nian/avatar-20260926.png`。
- `app/zhiyu/data.ts`：`people` 加入陈年资料卡，签名更新为 `出发永远比向往有意义`，地区 深圳；**没有**向 `initialPosts` 伪造陈年朋友圈。
- `app/zhiyu/xia-xia.tsx`：`character` 联合类型、名称/短名/头像分支，`relationship`/`scenario`/`growth` 调试参数，标题下显示 `折返实验室 · 恋爱前/已确认恋爱`（分享门槛满足时追加 `· 分享欲已触发`）。
- `app/zhiyu/app.tsx`：会话列表默认包含陈年，URL 可直接打开，3 秒轮询陈年接口映射照片消息/在线状态/未读数，语音视频通话按现行范围提示未开放。
- `lib/npc/engine.ts`：`validatePart` 恢复接受 `photo` 类型素材。新版引擎只接受 `sticker`，导致所有 `kind:'photo'` 素材（陈年两张分享照片，以及更早已存在的夏夏 `cake`）永远无法通过校验；按 2026-09-19 快照的写法恢复为 `(p.type === 'photo' || p.type === 'sticker')`。跨角色素材仍由各角色自己的解析器拦截。

## 证据库合并（重要：ID 重编号）

陈年证据包原编号与总库既有同号条目内容不同，已整体重编号，并在每条新增 `merged_from` 字段保留原 ID；映射同时写入 `npc-skills/SKILL.md`。

| 原编号 | 新编号 | 内容 |
|---|---|---|
| C43—C49 | C50—C56 | 高吸引先拒后反转、恋人疲惫措辞（“不用跟我汇报”）、洗澡30分钟追问、恋爱前后碎碎念反差、激烈争吵立界、前期照片分享门槛、自拍少年感修订 |
| A12—A16 | A26—A30 | 对应的用户直接建议原文，状态保持 `user_suggested` |
| T97—T103 | T121—T127 | 对应回归用例 |

未决项并入 `npc-skills/references/open-questions.md` 的陈年小节。正式七项数值初值、单轮加减幅度、财富值与自动关系升级仍未定稿；程序拒绝模型擅自写入。所有未获用户明确认可的示例继续保留 `assistant_proposed` / `pending` 状态。

## 状态与程序事实

新增 `chen_sessions` SQLite 表，按 `zhiyu_npc` cookie（36位UUID）隔离。初值：`relationship=strangers`、`careerStage='A'`、七项积极值全 0、消息/记忆/提案/队列为空、分享未解锁。每轮最多4条、单条最多80字；只允许 `text`/`emoji` 与两张已授权照片。离开30分钟追问、争执暂停、前期照片分享（七项中至少四项相对开局 +30 且好感达标，每天一轮、最短36小时间隔、素材不重复、工作室照先于雨夜自拍）均由服务端状态实现。

## 验证

- `npc-skills/scripts/validate_package.py`：PASS（Corrections 56 / endorsed 30 / test cases 127，证据引用一致）。
- `npx tsc --noEmit -p tsconfig.json`：0 错误。
- `npx oxlint app lib server vite.config.ts`：无新增错误（陈年文件 lint 干净；app.tsx 与 chat-composer.tsx 的既有告警为改动前已存在）。
- `node --test server/npc/chen.test.ts`：**10/10 通过**（开局隔离、超长连发/跨角色素材/未配置数值拒绝、记忆证据、Molly 匹配、知识门控、提示词装载、离开追问与取消、争执暂停与恢复、前期分享顺序与不重复、接口校验/幂等/会话隔离/错误重试）。项目无 TS 测试运行器，测试用 node:test；本次以项目外的解析钩子运行，未为跑单文件改写生产 import 路径。
- 实际接口试聊（独立调试身份，不写入用户会话）：问“你好，刚刷到你的号，你是做啥的？”返回两条短气泡——“折返实验室，做城市微旅行、品牌快闪，还有些女性友好的活动和公共空间体验。”“说白了就是琢磨怎么让人出门以后，别只剩一堆打卡照。”符合短句、直接、不写长篇自我介绍的口径。该结果不是用户认可台词。

## 未迁移

未复制 `.npc-runtime/state.sqlite`；换设备后陈年分支为空历史，旧设备私聊不自动成为新设备记忆。未接入陈年专属语音、实时通话、看图输入与自动排程。

## 2026-09-26｜陈年头像与签名

用户指定的新头像作为当前产品头像，保存为 `public/npc/chen-nian/avatar-20260926.png`；旧占位图及陈年的唯一身份锁脸参考均保留，不覆盖。联系人目录、Molly 推荐目录和陈年生图参考统一使用新头像。个性签名更新为“出发永远比向往有意义”。
