---
name: chen-nian-visual-style
description: "Preserve and apply the established visual canon for the fictional NPC 陈年: his locked face, adult athletic body, strong youthful impression, rugged low-fi selfie language, imperfect daily-life photos, and WeChat Moments image style. Use when generating, editing, selecting, reviewing, or integrating any image presented as 陈年 or as a post from his life, including selfies, avatars, full-body images, fitness photos, casual snapshots, and Moments sets. Do not apply to unrelated characters or generic scenery that is not being authored as 陈年的 content."
---

# 陈年的视觉风格

把陈年的视觉系统视为已经定稿的角色资产。继续扩展场景，不重新选脸，不因“更帅”“更年轻”或新参考图改写身份。

## 资料优先级

按以下顺序解决冲突：

1. `references/identity-and-body.md` 中的现行身份与身材规则。
2. `references/selfie-style.md` 或 `references/moments-style.md` 中与本次用途对应的规则。
3. `references/prompt-spec.md` 中的生成模板与验收清单。
4. `references/history.md` 和 `references/source-snapshots/` 只用于追溯，不覆盖现行规则。

历史图和旧文件即使更符合单次提示，也不能取代现行锁脸图。

## 固定资产

- `assets/identity/chen-nian-face-reference.png`：唯一身份参考，所有含陈年本人的图都必须使用。
- `assets/style/front-leaning-selfie-style.png`：自拍的构图、成像和气质参考，只约束视觉语言，不取代身份。
- `assets/examples/share-workdesk-v1.png`：现行朋友圈生活照样张，展示“半失败”而非精修的日常感。
- `assets/examples/share-rainy-selfie-v2.png`：现行雨夜直男自拍样张，展示硬骨相与强少年感如何同时成立。

`assets/history/` 里的文件仅供比较和复盘。不得把 `share-rainy-selfie-v1-superseded.png` 或字母头像当作生成参考。

## 按任务读取资料

- 含陈年本人：先读 `references/identity-and-body.md`。
- 自拍、头像、镜前照、健身照：再读 `references/selfie-style.md`。
- 朋友圈、生活随手拍、组图：再读 `references/moments-style.md`。
- 实际生成、修改或验收图片：读 `references/prompt-spec.md`。
- 需要解释版本变化、恢复素材或更新定稿：读 `references/history.md` 与 `references/asset-manifest.md`。

## 不可破坏的视觉身份

1. 陈年是28岁的中国成年男性，自拍应有约23—25岁的年轻观感；少年感来自清醒松弛、自然饱满和利落状态，不来自幼态化。
2. 保留略长脸型、硬眉骨、颧骨平面、直而有力度的鼻骨、扎实下颌、偏长眼型、真实毛孔、小痣和自然不对称。
3. 身高约183cm，长期运动，肩背舒展，有自然训练痕迹和均衡体脂；不做夸张健美体型，也不削成单薄偶像身材。
4. 禁止明显抬头纹、深眼窝、重眼袋、干涩风化肤质和中年式疲态。
5. 禁止奶油小白脸、V脸、大眼、瓷肌、磨皮、精致偶像妆、营业微笑和商业写真感。

## 工作流

1. 先判断图片类型：自拍、全身/健身、普通生活照、朋友圈组图或旧图修订。
2. 把固定资产按角色分工交给图像工具：锁脸图只负责身份；自拍风格图只负责构图、成像和气质；其他图片只能提供场景、动作或服装。
3. 以 `references/prompt-spec.md` 为基础写本次提示，并明确重复身份不变量、强少年感和禁止项。
4. 每张图单独生成。组图通过同一时间、衣服、发型、光线与环境细节保持连续，不把多张图一次拼成截图。
5. 用验收清单检查身份、年龄感、身材、低清程度、半失败感、手部、文字、品牌、界面残留和场景连续性。
6. 只针对失败项修订，保留原文件并使用版本化名称。新版本确认前不要覆盖现行资产。

## 输出约定

- 图片中不擅自加入文字、日期、定位、品牌标志、水印、社交软件界面、轮播点或截图边框。
- 对话或朋友圈文案与图片分开输出；文案保持短、具体、带一点陈年的自嘲和嘴欠，不解释摄影规则。
- 所有素材都属于虚构NPC陈年，不冒充现实真人照片。
- 接入产品时记录素材ID、用途、版本、是否现行和来源；现行文件与历史文件分开保存。

## 更新定稿

只有用户明确要求替换脸、身材设定或固定视觉模板时，才更新现行资产。更新时同时修改对应参考文件、`references/history.md` 和 `references/asset-manifest.md`，保留被替换版本与原因。
