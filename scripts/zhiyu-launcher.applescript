-- The outer Dock/Finder icon delegates lifecycle management to the native App.
-- It must not race the App's startup timer, kill it, or own a second server.
on run
	set homeDir to POSIX path of (path to home folder)
	set parentDir to ""
	try
		set parentDir to do shell script "/usr/bin/dirname " & quoted form of (POSIX path of (path to me))
	end try
	set candidates to {parentDir & "/home/Documents/ChatGPT/全民智敏/desktop/dist/mac-arm64/智域.app", homeDir & "智域大文件/home/Documents/ChatGPT/全民智敏/desktop/dist/mac-arm64/智域.app", homeDir & "Documents/ChatGPT/智域/desktop/dist/mac-arm64/智域.app"}
	repeat with candidate in candidates
		set targetApp to contents of candidate
		try
			do shell script "test -x " & quoted form of (targetApp & "/Contents/MacOS/智域")
			do shell script "/usr/bin/open -a " & quoted form of targetApp
			return
		end try
	end repeat
	display dialog "找不到智域程序。请恢复原来的文件夹后再打开。" buttons {"好"} default button 1
end run
