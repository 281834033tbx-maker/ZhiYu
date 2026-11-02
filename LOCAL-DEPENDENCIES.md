# 本机依赖与重建边界

核对日期：2026-11-02。根据本项目实际源码、锁文件、现有第三方 Git 提交和 Python 安装元数据整理；没有调用模型、复制认证或修改原运行环境。

## JavaScript 与入口

- 根目录 `package-lock.json` 固定前端与本机服务依赖，使用 `npm ci`。
- `package.json` 要求 Node.js ≥22.13.0，本机数据库代码使用 `node:sqlite`。该环境的最低版本声明不表示全部操作系统都已验收。
- `desktop/package-lock.json` 固定桌面开发依赖，使用 `cd desktop && npm ci`。手机版开发入口复用 `desktop/node_modules`。
- `vite.config.ts` 读取 `.openai/hosting.json`；源码副本使用空托管绑定占位，不包含原 Sites 项目或云资源认证。新增托管部署需单独配置和验证。
- `npm run dev` 以仓库根为工作目录。很多服务代码按此目录定位 `npc-skills/` 与 `.npc-runtime/`，不要直接从 `server/` 子目录启动。

## 文字与图片

默认文字路径调用本机 Codex CLI。需自行安装并登录兼容版本；源码使用的参数可在 `server/npc/codex.ts` 查看。程序不会带走原电脑的 CLI 认证。

`NPC_CODEX_BIN`、`NPC_IMAGE_CODEX_BIN` 等进程环境变量可在启动前用 `export` 设置。`vite.config.ts` 仅把白名单中的 `.env.local` 字段复制到服务进程环境；不是所有 `process.env.*` 字段都能只写 `.env.local` 就生效。

DeepSeek 路径使用 `NPC_TEXT_PROVIDER=deepseek`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`。已有后端将文本发送至配置的供应商，需使用自己的账户、权限、网络和额度。

## 本地语音

| 功能 | 源码入口 | 默认本地路径 | 重建内容 |
| --- | --- | --- | --- |
| 本地录音识别 | `server/npc/local-asr.py` | `.npc-runtime/asr-venv/`、`.npc-runtime/models/faster-whisper-base/` | Python、faster-whisper 与兼容模型 |
| Qwen3-TTS 合成 | `scripts/qwen3-tts-server.py` | `.npc-runtime/qwen3-tts-env/`、`.npc-runtime/models/Qwen3-TTS-12Hz-0.6B-CustomVoice/` | qwen-tts、PyTorch、soundfile 及完整模型 |
| VoxCPM2 独立试听 | `scripts/voxcpm2_official_zh.py` | `.npc-runtime/voxcpm-next/`、`.npc-runtime/voxcpm-venv/` 与 models 下的 VoxCPM2、SenseVoiceSmall、ZipEnhancer | 官方程序、Python 环境与三组模型 |
| MuseTalk 离线样片 | `scripts/musetalk-still-mps.py` | `.npc-runtime/MuseTalk/`、`.npc-runtime/musetalk-venv/` | MuseTalk 程序及 UNet、VAE、Whisper 等模型 |

代码默认从本地加载权重，部分路径显式设置离线模式。模型与环境未入库，须按来源与版本另行恢复。模型存放目录、历史估算体积、第三方 Git 提交和当前 Python 安装版本见 [local-dependency-inventory.json](local-dependency-inventory.json)。安装版本记录是环境观察快照，可能含同名包多版本残留，不能直接视为跨平台可安装的统一 lockfile。

本地 ASR 的可覆盖变量为 `NPC_LOCAL_ASR_PYTHON`、`NPC_LOCAL_ASR_MODEL`，请作为启动进程的环境变量设置；Qwen 路径可通过 `.env.local` 中 `QWEN_TTS_LOCAL_PYTHON`、`QWEN_TTS_LOCAL_MODEL`、`QWEN_TTS_LOCAL_URL` 调整。本地 Qwen 服务默认监听 `127.0.0.1:9873`，选择 `NPC_AUDIO_PROVIDER=qwen-local` 且依赖齐全时，现有插件会检查健康状态并尝试启动自己的服务。

VoxCPM2 是独立语音试听工作台，MuseTalk 是离线样片工具。GPT-SoVITS 与 HeyGem 等本机研究目录不等于已接入所有 NPC；它们的安装和效果不作为主应用已完成功能。

## 第三方源码

本机存在以下第三方项目；精确提交写在清单中。本次已将筛选后的源码、许可证和本地差异整理在 `vendor/optional-sources/`，来源及恢复步骤见该目录说明；没有将 `.npc-runtime/` 整个加入 Git。只为运行当前前端与文字聊天，无须先安装这些研究目录。

| 本机目录 | 上游 |
| --- | --- |
| `.npc-runtime/Qwen3-TTS` | [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) |
| `.npc-runtime/voxcpm-next` | [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM) |
| `.npc-runtime/voxcpm-official`（较早独立副本） | [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM) |
| `.npc-runtime/MuseTalk` | [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk) |
| `.npc-runtime/GPT-SoVITS` | [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) |
| `.npc-runtime/HeyGem.ai` | [GuijiAI/HeyGem.ai](https://github.com/GuijiAI/HeyGem.ai) |

## 桌面与开发工具路径

桌面壳可通过 `ZHIYU_PROJECT`、`NODE_BIN` 指定项目和 Node。上传副本的 `desktop/main.js` 已移除旧用户名路径，LaunchAgent 已模板化；AppleScript、视频制作及部分历史测试脚本仍含旧电脑路径。对应路径需要在目标机器配置或适配；不要把原账户身份、系统钥匙串、浏览器 Profile 或 CLI 配置目录复制进仓库。

部分浏览器测试使用原开发环境里的 Playwright/Chrome 路径，部分媒体脚本使用桌面原始图片、参考音频和 ffmpeg。需要另外提供测试工具或该次制作输入；`public/` 中已随程序提供的最终运行素材不依赖桌面原始素材才能展示。

手机版 `build/prepare-runtime.cjs` 不负责下载 Electron：它要求 `desktop/node_modules/electron/dist` 或系统 Electron 缓存中已有完整 33.4.11 arm64 运行时。现有源码没有经过本次全新机器上的 Electron 安装、打包、签名和发布验收。

## 账号与历史恢复

`.npc-runtime/state.sqlite` 及其 WAL、媒体、认证配置和客户端资料是独立私有数据。源码仓库没有这些内容；复制源码不会同步原聊天和登录。备份正在使用的 SQLite 时应采用一致性快照方法，并同时保留引用的媒体，不要只复制正在写入的一个文件。

迁移、依赖恢复与全新账号首次启动是不同流程。原目录、旧 Git 开发检查点、迁移交接和历史包继续保存，不因创建 GitHub 仓库而清理。

LaunchAgent 模板 `scripts/com.zhiyu.local-preview.plist` 中的 `__PROJECT_ROOT__` 和 `__NODE_BIN_DIRECTORY__` 必须先替换为本机绝对路径；不要直接安装未替换的模板。上传副本的桌面默认身份在首次启动时生成，持久保存于忽略的本机运行目录，不包含原账户固定身份。
