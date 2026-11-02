# 智域手机版（电脑预览 App）

本目录独立打包 `com.zhiyu.mobile-preview` / `智域手机版.app`，不修改 `desktop/` 的现用 App。窗口内容默认 426 × 900 点，适配较小可用屏幕；无原生标题栏，主 UI 提供手机框及状态栏。状态栏需提供 `-webkit-app-region: drag`，按钮和输入控件需使用 `no-drag`。可通过 macOS 菜单或 ⌘W 关闭窗口、⌘Q 退出。

入口固定为 `http://localhost:3100/mobile`。启动时只发送无 Cookie 的 `/api/auth/session` 健康检查；已有服务直接复用，不替换、不关闭。服务未运行时，使用原项目的 Vinext 入口与现有 Node 环境启动；退出时只停止本预览进程实际创建的子进程。若桌面 App 原本拥有服务，关闭桌面 App 后，预览窗口也可能暂时失去 API 连接。

手机版独立使用 `Application Support/智域手机版`，不复制现用 App 的 cookie、登录状态或 Chromium profile。本人使用原账号登录后，可读取同一个本机服务里的账户聊天、人物、群组和任务；独立 localStorage 中的备注、头像、置顶、已读等本机偏好不保证自动同步。这里没有新建业务数据库。

在本目录执行：

```sh
npm test
npm run pack
codesign --force --deep --sign - 'dist/mac-arm64/智域手机版.app'
codesign --verify --deep --strict --verbose=2 'dist/mac-arm64/智域手机版.app'
```

打包复用 `desktop/node_modules` 内已有 electron-builder；Electron 33.4.11 优先使用该目录的完整运行时，否则只解包本机 `Library/Caches/electron` 内已经存在的同版本 arm64 ZIP，不下载新依赖。本机迁移副本的原 Electron 目录缺少 `.app`，本次使用已核完整的现成缓存。App 需要保留在项目 `desktop-mobile/dist/mac-arm64` 下以便自动定位项目；移动 App 时可显式提供 `ZHIYU_PROJECT`。

`preload.js` 和 `image-viewer.js` 沿用现有桌面实现；人物、图片和任务日历仍使用同源页面与原权限边界。此 App 是 macOS 上的手机版界面预览，不是 iOS 原生安装包。
