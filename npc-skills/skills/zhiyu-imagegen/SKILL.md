---
name: zhiyu-imagegen
description: "Generate, edit, render, and review image assets for Zhiyu's fictional NPCs after another dialogue or Moments workflow has decided what to share. Use for daily phone photos, food, objects, selfies, character-consistent portraits, multi-image sets, targeted revisions, and native-rendered chat screenshots for Moments. Do not decide whether an NPC should post or initiate sharing."
metadata:
  short-description: "Generate and edit consistent Zhiyu NPC daily-life images"
---

# 生图 Skill

本 Skill 统一适用于全部 NPC，包括陈年。陈年的外貌、身材、手机感和已有照片是他的人物参考资料，不是一套独立生图流程；任务路由、原图精修、聊天截图和验收合同与其他 NPC 相同。

这是智域的统一图片制作入口。它把已经决定好的图片任务转成可信的图片资产，不参与“是否分享、分享什么、为什么分享”的决策。图片资产不一定由生成模型产生；聊天截图等界面资产必须走确定性渲染路线。

## 边界

- 对话、朋友圈或业务逻辑先做决策，再把明确的生图任务传入本 Skill。
- 本 Skill 不主动发布、不推断关系进度、不擅自增加剧情或改变分享动机。
- 人物身份、身材和固定特征来自对应 NPC 的资产包；不把一名 NPC 的规则套给其他人。
- 所有人物都是虚构 NPC，不冒充现实人物照片。

## 任务路由

1. 先读取 [任务合同](references/task-contract.md)，确认已知输入和缺失项。
2. 按 `asset_kind` 路由：`generated_photo` 使用生成模式；`edit_existing` 以原图编辑；`chat_screenshot` 读取 [聊天截图](references/chat-screenshot.md) 并使用宿主真实组件渲染截图，不调用图像生成模型伪造界面。
3. 已有照片再次分享时，必须沿用同一张原图。尤其是先发给用户、后来又发朋友圈的照片，记录版本关联，不生成一张相似的新照片冒充原图。
4. 日常手机照读取 [日常手机照](references/daily-phone-photo.md)。
5. 含饭菜、饮料、火锅、外卖或烹饪过程时，必须读取 [食物与饮品](references/food-and-drink.md)。
6. 含 NPC 本人、脸、头发或身体局部时，必须读取 [人物表现状态](references/character-presentation.md)。
7. 组图要在每张图里重复同一时间、服装、发型、光线和环境不变项，每张单独生成和保存。
8. 交付前按 [验收与修订](references/quality-control.md) 检查；只修败项。聊天截图还必须返回专用界面验收项。

## 工具和参考的分工

- `generated_photo` 和适合生成式编辑的 `edit_existing` 默认调用系统 `imagegen`。
- `chat_screenshot` 只能使用宿主应用真实聊天组件和截图工具；禁止用生成模型、HTML 近似仿制、文字字符或 emoji 冒充真实控件。
- `iphone-candid-photo` 只是手机随拍的可选参考。仅在新款 iPhone 风格符合任务时使用，不得覆盖 NPC 的设备时代、个人风格或低清需求。
- 引用图必须标注角色：身份、身材、发型、姿势、服装、场景、风格或编辑目标。
- 身份引用的优先级高于姿势、表情、发型和场景引用。

## 交付

- 返回 `media_result`：图片路径、资产类型、制作方式、最终提示规格或渲染来源、使用的引用图角色、验收结果及已知局限。
- 项目资产使用版本化文件名，不擅自覆盖旧图。
- 现行资产与失败样张分开保存；失败反馈只在多场景验证有效后才升级为通用规则。
