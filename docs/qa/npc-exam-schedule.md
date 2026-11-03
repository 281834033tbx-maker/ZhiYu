# 03:00 隔离考试（默认关闭）

手动执行 `npm run npc:exam` 会读取全部49题，使用当前配置的真实模型。语义阅卷另用10次真实调用，守卫不通过时每题最多再生成一次。不会调用正式消息API、发朋友圈或打开真实聊天库；只在临时副本与output/docs报告落文件。原始输入输出可复核，不能把模型阅卷分数当人类验收。

提供 `com.zhiyu.npc-exam.plist.disabled`，未安装也未加载，`Disabled=true`、`NPC_EXAM_SCHEDULE_ENABLED=0` 双重关闭。要打开时，先把WorkingDirectory和node路径改成自己的实际位置，将Disabled改false并将环境开关改1，再自行复制到 `~/Library/LaunchAgents/com.zhiyu.npc-exam.plist`，执行 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zhiyu.npc-exam.plist`。关闭用 `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.zhiyu.npc-exam.plist` 并把开关改0。Mac关机或睡眠时不保证03:00准时运行，实际运行以报告时间为准。

身份包素材缺口和待审核状态不在考试中编造通过；题中虚构计划也不写入正式任务。现有模型凭据只留本机环境，报告不包含密钥。
