# 智域 ZhiYu

持续开发中的本机 AI 社交聊天应用。前端使用 React 19、TypeScript 与 Vinext，本机 Node 服务提供账户、NPC 聊天、群聊、任务、动态和媒体接口，Electron 提供 Mac 桌面窗口。

本仓库保存当前程序源码、人物 Skill 与知识库、必要图片视频、桌面壳及开发脚本。可选语音与离线视频研究工具的源码和许可证另存于 `vendor/optional-sources/`。人物和经历为虚构内容；Skill 内的训练例子、反例与用户纠偏是开发资料，不是新账户的真实聊天或个人档案。

## 从源码启动

需要 Node.js **22.13.0 或以上**、npm，以及可联网安装依赖的环境。在仓库根目录执行：

```sh
npm ci
cp .env.example .env.local
npm run dev
```

服务按 `vite.config.ts` 监听 `127.0.0.1:3100`。日常使用固定一种地址，避免 `localhost` 与 `127.0.0.1` 的 Cookie 和浏览器存储分开：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3100/` | 当前主应用 |
| `http://localhost:3100/mobile` | 手机版界面预览 |

首次克隆不带原账户、登录状态、聊天、关系进度或任务存档。服务会使用本项目自己的 `.npc-runtime/`；原来使用智域的电脑应继续保留原项目与完整数据备份。

`npm run build` 用于生成构建产物。当前本机 NPC 接口通过 Vinext 的开发服务插件接入；生产构建通过不代表这些接口已经部署到公网。`npm start` 是 Wrangler 构建产物入口，本机使用上面的 `npm run dev`。

## AI 与语音配置

`.env.example` 仅包含空值与示例选项。实际密钥只写本机 `.env.local`，配置后重新启动自己的服务。

- 文字默认通过本机 Codex CLI 调用，需安装兼容的 CLI 并登录自己的账户；可在启动服务前设置 `NPC_CODEX_BIN` 指定程序路径。另有 `NPC_TEXT_PROVIDER=deepseek` 的后端，需配置自己的 `DEEPSEEK_API_KEY`。当前图片轮使用已配置的 DeepSeek 图像理解接口；不支持图片的模型会明确报错，不再静默回退 Codex。
- 语音消息支持代码中已有的 `openai`、`doubao`、`local`、`qwen`、`qwen-local` 配置；不同方式依赖不同凭据或本地模型，不必全部配置。本地 ASR 与 Qwen3-TTS 的模型、Python 环境需要另外安装。
- 实时语音使用应用内配置入口，后端保存到忽略的 `.npc-runtime/realtime-speech-config.json`。它与录音消息的 `.env.local` 配置是独立链路；人物能力以实际程序入口和已配置服务为准。
- 图片生成需要兼容的本机模型服务入口、登录与额度，源码和人物素材的存在不代表已配置可用的生成服务。

模型、第三方源码、版本清单及路径见 [LOCAL-DEPENDENCIES.md](LOCAL-DEPENDENCIES.md)。本机语音未安装不会使仓库自动下载模型。可选工具源码恢复步骤见 [vendor/optional-sources/README.md](vendor/optional-sources/README.md)。`npm ci` 只安装 JavaScript 依赖。

## 桌面窗口

Mac 桌面源码在 `desktop/`，独立手机版预览壳在 `desktop-mobile/`。先启动本机服务，再在另一终端安装并启动桌面壳：

```sh
cd desktop
npm ci
ZHIYU_PROJECT="$(cd .. && pwd)" npm start
```

手机版预览沿用桌面目录内的 Electron 安装：

```sh
cd desktop-mobile
ZHIYU_PROJECT="$(cd .. && pwd)" npm start
```

手机版是 Mac 上的 iPhone 样式窗口，不是 iOS 安装包。它使用独立 Chromium 资料目录，通过同一本机服务登录账户。

可通过 `NODE_BIN` 显式指定 Node。桌面运行时从项目位置寻找服务，旧脚本仍有旧电脑路径或开发工具依赖，跨机器使用前应根据本机路径配置。现存 `desktop-mobile/build/prepare-runtime.cjs` 需要完整的 Electron **33.4.11 arm64** 安装或本机已有同版本缓存；桌面成品、签名和完整重新打包流程需在目标机器另外验证。

## 目录

| 目录 | 内容 |
| --- | --- |
| `app/zhiyu/`、`components/`、`hooks/` | 现有界面与交互 |
| `app/zhiyu/task-board/` | 安排导航与账号独立保存；全新账号默认为空，不自动插入旧展示任务 |
| `server/npc/`、`lib/npc/` | 本机服务、账户、消息、关系、任务、媒体及角色运行逻辑 |
| `npc-skills/` | 人物档案、分层表达规则、专业知识、来源与回归资料；运行必需 |
| `public/` | 程序随附图片、视频、图标及表情素材 |
| `desktop/`、`desktop-mobile/` | Electron 桌面与手机版预览源码 |
| `scripts/` | 校验、隔离测试、本机开发与媒体研究工具 |
| `distribution/` | 早期独立体验包模板；需重新打包适配，不能直接当仓库根启动器 |
| `docs/` | 需求与补充文档 |

## 文件与数据保存

凭据、真实 SQLite 数据、上传录音、生成媒体、模型、Python 环境、`node_modules`、构建成品和历史输出不随源码提交。原项目及其 Git 历史、开发交接与备份继续独立保留。恢复已有使用数据需要独立的一致性数据库和媒体备份，不能从本仓库的空白运行目录恢复原聊天。

`NPC-MOMENTS-INTEGRATION.md` 等集成文档保留各阶段实现记录；判断当前行为优先核对实际代码和文档日期。早期说明中的“只有原型”“无 AI”“手机未开发”等描述仅代表其成文时点。

## 验证

```sh
npm run build
npx tsc --noEmit
cd desktop-mobile && npm test
```

具体测试结果以本次仓库交付记录为准；这些命令不构成所有检查已通过的声明。`scripts/` 中部分带 `live` 的测试会调用模型或写运行数据，执行前应阅读脚本并使用隔离环境，不要批量在正式账户运行。

第三方依赖、模型与素材沿用各自许可证和来源说明；本次入库未为全部项目资产重新指定统一开源许可证。

<!-- frontend-experience-redesign-20261104 -->
## 前端与智友体验改版

导航为消息、智友、任务、动态及个人头像入口“我”；宠物、副本入口由 `features.extras=false` 隐藏，旧 `/studio` 不作为应用入口。现有主题配色、三栏几何及 13px 聊天气泡保留，弹窗材质与字号规范见 [设计规范](docs/design-spec.md)。

智友状态、中文添加来源、错误边界与重发、分段回复节奏、秘书早报/周报/月报和统一图片身份库已纳入源码。报表基于实际保存记录，页面展示样例不冒充真实完成记录。天气需自行填写 `WEATHER_API_KEY` 和账户专属 `WEATHER_API_HOST`，没有配置仍可发早报。

校验入口增加 `npm run lint:style`、`node scripts/test-user-facing-copy.mjs` 与 `npm run npc:exam`。真实模型考试仅使用隔离题目，可能消耗已有模型账户额度；夜间 03:00 调度模板默认关闭，启用说明见 [考试调度](docs/qa/npc-exam-schedule.md)。不得把未满分的角色输出或未执行的提案说成验收通过。

本轮前后截图与差异记录在 `docs/redesign/`，状态库供审阅见 [状态清单](docs/redesign/status-catalog.md)，真实模型考试原话与分数见 `docs/qa/`。仓库当前为公开源码；真实登录凭据、运行数据库、用户上传与账号媒体、依赖安装和构建成品不在此发布。
<!-- /frontend-experience-redesign-20261104 -->

## 2026-11-19 对话与新账号开场同步

桌面与手机版使用相同的现行人物对话 Skill、人物资料、范例、输出检查和固定开场。私聊、群聊与实时语音文字共享对应检查；复述与无执行回执却声称已办成会按现有流程处理。称呼支持全局和单人设置，默认叫老大，赵一帆使用您；明确同意后才按当前安排进行监督。

新注册账号不携带开发机聊天、记忆、任务、动态和私人资料，七位人物仍预置。服务运行时，Molly 注册后逐条发送开场；第三项是标明“团队海报（临时示意）”的图片，正式海报后续替换。小满约60秒、夏夏约90秒后发送；何嘉伟、陈年、柳智敏和赵一帆首次打开各自私聊时发送。开场只发一次，旧账号、已有聊天、退出再登录不补发；用户先发消息会取消该人物尚未送达的开场部分。退出服务或电脑休眠时不保证准点到达。

本次包含开场所依赖的安排接口、称呼偏好、读取与监督运行代码。正式海报设计、原账号内容、API Key、录音和运行数据库均不在源码内；文字与语音服务仍需使用者自行配置。

可运行 `npm run test:dialogue` 与 `npm run test:opening` 做不调用外部模型的隔离检查；`npm run npc:exam` 使用当前49题及现行规则，实际运行会调用模型并可能消耗额度，本次同步没有重新跑真实考试。
