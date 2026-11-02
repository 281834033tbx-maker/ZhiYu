# 陈年自拍生成规格

只有实际生成、修改或验收陈年自拍时才读取本文件。

## 基础提示模板

```text
Use case: photorealistic-natural
Asset type: Chen Nian selfie or WeChat Moments photo
Primary request: <本次场景、动作和用途>
Input images:
- Image 1: sole identity reference; preserve 陈年的精确五官、骨相、比例、肤质、小痣与自然不对称。
- Image 2: canonical selfie-style reference; preserve its close, front-leaning, rugged, low-fi snapshot language without copying scene details that conflict with the request.
- Additional images: composition/wardrobe/location references only; never identity sources.
Subject: 23—25岁中国成年男性陈年，183cm，体脂均衡、有自然训练痕迹；略长脸型，眉骨、颧骨、鼻骨、下颌角硬朗；偏长眼型，神态克制松弛，带一点痞气。
Composition: vertical, chest-up close framing, slight forward lean, imperfect crop and angle, personal snapshot rather than a photographer-directed portrait.
Capture: iPhone 6 era image; slightly soft focus, limited dynamic range, mild noise, old denoising smearing, subtle JPEG artifacts, slight motion blur, imperfect white balance, no HDR.
Texture: real skin variation and asymmetry; no beautification. If a mirror is present, include light haze, dried water spots, fingerprints, dust and uneven wiping without hiding the eyes.
Context modifier: <运动后默认湿发与汗；其他场景按用户明确要求，不强行出汗>
Identity priority: identity accuracy and rugged bone structure outrank pose, styling and attractiveness.
Constraints: no text, logo, watermark, phone UI, carousel dots, screenshot border or extra people unless explicitly requested.
Avoid: pretty-boy styling, soft idol face, narrowed V jaw, enlarged eyes, porcelain skin, beauty filter, commercial fashion lighting, studio sharpness, cute pout, perfect symmetry, celebrity likeness.
```

## 默认运动后预设

- 普通老旧篮球馆更衣室或洗手间，灰白墙面、冷色荧光灯。
- 黑发完全汗湿，发束结在一起，几缕贴额头。
- 额头、太阳穴、鼻梁、上唇、脸颊、下颌和颈侧有真实透明汗迹；脸颊与耳朵轻微运动后泛红。
- 宽松白色纯棉运动短袖，领口与肩胸有自然汗湿痕迹，不透视、无文字和 logo。
- 镜面轻雾、水点、指印和擦拭印明显但不遮脸；手机可以在画面外。

## 朋友圈组图

- 未指定数量时可先产出 2 张：一张正面前倾直视镜中，一张更近、略抬眼、像刚缓过气。
- 同组必须保持同一张脸、同一分钟、同一衣服、相同湿发状态、相同光线和镜面痕迹。
- 不用多张高清棚拍冒充组图；动作差异应像连续随手拍，而不是换了一次人设。

## 验收清单

- 脸是否与身份资产一致，而不是被风格参考人物替换？
- 眉骨、颧骨、鼻骨和下颌是否仍硬朗？是否出现小白脸、幼态或精修偶像感？
- 是否足够像旧 iPhone 6，而非先高清再简单加颗粒？
- 镜面痕迹是否自然、有层次且不遮挡眼睛？
- 汗湿状态是否符合场景，头发与汗迹是否真实而非油亮塑料？
- 是否残留 LIVE、轮播点、箭头、文字、水印或截图边框？
- 同组人物、服装、光线和场景是否连续？

