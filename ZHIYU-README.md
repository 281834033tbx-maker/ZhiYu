# 智域桌面客户端 · Stitch 定稿交互版

运行 `npm install` 后执行 `npm run dev`，打开终端给出的本地地址（默认 http://localhost:3000）。首页是客户端，原有设计工作台保留在 `/studio`。

## 定稿来源

项目：6597599309887998733。

- 聊天：821efaff800d418a9dfdd24c5a5c841c
- 动态：86fac11c18194d758c80659218b19b83
- 联系人：c517d4df25ed479a806f454f10bd6a22

原始 HTML、截图及下载清单位于 `output/stitch-final`。图片已下载到 `public/stitch`，日常预览无需连接 Stitch。所有交互修改都发生在本地，不会回写设计稿。

## 可以体验

- 三个页面导航、联系人搜索、资料查看，以及从资料进入聊天或个人动态。
- 文字消息、Enter 发送、Shift+Enter 换行、表情、图片消息。文件附件显示演示卡片。
- 少图拼版、多图轮播、珊瑚渐变分页点、拖动切图、点击查看大图，键盘方向键切换与 Escape 关闭。
- 点赞、点击图标打开评论面板、添加评论、本地发布图文动态（最多 9 张）、隐藏好友动态与恢复。
- 语音/视频通话控制演示。未连接通话服务，不会拨打真实电话。
- 本地保存消息、动态、评论、点赞及部分偏好，设置中可以导出 JSON。

这是可运行的前端交互程序。尚未接入账号鉴权、真实消息传输、AI 回复、文件服务器或音视频服务。示例好友与计数沿用设计稿，部分轮播续图使用项目内现有素材补足。浏览器本地存储有容量限制；清除站点数据会删除本机记录。

## 文件与验证

`app/zhiyu/app.tsx` 为页面及交互，`zhiyu.css` 为独立样式，`data.ts` 为示例数据，`assets.json` 为本地素材映射。

- `npx tsc --noEmit`
- `npx oxlint app/zhiyu app/page.tsx app/layout.tsx`
- `npm run build`
- `node scripts/test-zhiyu.cjs`（需启动本地服务及可用 Playwright/Chrome；可用 PLAYWRIGHT_MODULE、CHROME_PATH 指定工具路径）

测试使用独立浏览器上下文，不会修改日常预览的本地记录。桌面最小宽度 960px；移动版暂未开发。
