-- 智域启动器（自定位版）
-- 外层启动器只负责启动桌面 App，并等待本地服务真正可用。

property fallbackRoot : "/Users/boxuantong/智域大文件"
property logPath : "/tmp/zhiyu-launch.log"
property scriptName : "启动恢复的智域.command"
property maxWaitRounds : 60
property existingProcessGraceRounds : 25

on run
	set rootDir to fallbackRoot
	try
		set myPosix to POSIX path of (path to me)
		set parentDir to «event sysoexec» ("/usr/bin/dirname " & quoted form of myPosix)
		set hasScript to «event sysoexec» ("test -f " & quoted form of (parentDir & "/" & scriptName) & " && echo yes || echo no")
		if hasScript is "yes" then set rootDir to parentDir
	end try

	set launcherPath to rootDir & "/" & scriptName
	set appPath to rootDir & "/home/Documents/ChatGPT/全民智敏/desktop/dist/mac-arm64/智域.app"
	set appBinary to appPath & "/Contents/MacOS/智域"

	try
		«event sysoexec» ("test -f " & quoted form of launcherPath)
	on error
		«event sysodlog» "找不到智域的启动脚本，文件夹可能又被移动了：" & return & return & launcherPath & return & return & "请把「智域.app」和「启动恢复的智域.command」放在同一个文件夹里。" given «class btns»:{"好"}, «class dflt»:1
		return
	end try
	try
		«event sysoexec» ("test -x " & quoted form of appBinary)
	on error
		«event sysodlog» "找不到智域的桌面程序：" & return & return & appPath & return & return & "可能被删掉或移动了，需要重新打包。" given «class btns»:{"好"}, «class dflt»:1
		return
	end try

	set okCode to "000"
	try
		set isUp to «event sysoexec» "/usr/sbin/lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1 && echo yes || echo no"
		if isUp is "yes" then
			«event sysoexec» ("/usr/bin/open " & quoted form of appPath)
			return
		end if

		-- 如果桌面 App 正在冷启动，先给它 50 秒完成；如果端口始终未恢复，
		-- 说明是只剩窗口进程、服务已经死亡的旧实例，结束它后再启动。
		set isDesktopRunning to «event sysoexec» ("/usr/bin/pgrep -f " & quoted form of appBinary & " >/dev/null 2>&1 && echo yes || echo no")
		if isDesktopRunning is "yes" then
			repeat existingProcessGraceRounds times
				delay 2
				set okCode to «event sysoexec» "/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3100/ 2>/dev/null || true"
				if okCode is "200" then return
			end repeat
			«event sysoexec» ("/usr/bin/pkill -TERM -f " & quoted form of appBinary & " >/dev/null 2>&1 || true")
			delay 2
		end if
		«event sysoexec» ("nohup " & quoted form of launcherPath & " > " & quoted form of logPath & " 2>&1 &")

		-- 冷启动通常约 30 秒；最长等 120 秒，避免刚好卡在旧上限时误报失败。
		repeat maxWaitRounds times
			delay 2
			set okCode to «event sysoexec» "/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3100/ 2>/dev/null || true"
			if okCode is "200" then exit repeat
		end repeat

		if okCode is not "200" then
			set logTail to «event sysoexec» ("{ tail -n 12 " & quoted form of logPath & " 2>/dev/null; tail -n 20 \"$HOME/.zhiyu/server.log\" 2>/dev/null; } | tail -n 24; true")
			«event sysodlog» "智域没有启动成功（本地服务返回 " & okCode & "）。日志尾部：" & return & return & logTail given «class btns»:{"好"}, «class dflt»:1
		end if
	on error errMsg
		«event sysodlog» "启动智域时出错：" & return & errMsg given «class btns»:{"好"}, «class dflt»:1
	end try
end run
