# 生成、修改与验收规格

只有实际生成、修改或验收陈年图片时读取本文件。

## 含陈年本人时的基础模板

```text
Use case: photorealistic-natural fictional NPC asset
Asset type: <selfie / avatar / full body / fitness photo / Moments photo>
Primary request: <scene, action, wardrobe, time, intended use>

Input image roles:
- Identity image: assets/identity/chen-nian-face-reference.png. This is the sole identity reference. Preserve the exact facial structure, proportions, skin features, small moles, and natural asymmetry.
- Selfie-style image when relevant: assets/style/front-leaning-selfie-style.png. Use only for composition, capture quality, posture, mirror texture, and mood. Never let it replace the identity.
- Additional images: scene, pose, wardrobe, or lighting references only. Never identity sources.

Character: 陈年, 28-year-old adult Chinese man who reads visually as a youthful 23–25. Approximately 183 cm, long-term natural training, relaxed open shoulders and back, balanced body fat. Slightly long face; strong brow ridge, cheekbone plane, straight forceful nose bridge, solid jaw, long-shaped eyes. Alert relaxed expression, restrained ruggedness, slight roguish ease. Real skin, pores, small moles, and natural asymmetry.

Youth correction: no pronounced forehead lines, deep eye hollows, heavy eye bags, dry weathered skin, or middle-aged fatigue. Keep mature male bone structure; do not create a childlike or soft idol face.

Capture: iPhone 6 era ordinary photo; slightly soft focus, limited dynamic range, mild noise, old denoising smearing, subtle JPEG artifacts, occasional motion blur, imperfect white balance, no HDR.

Composition: imperfect personal snapshot. Use a slightly crooked angle, imperfect crop, foreground obstruction, mild blur, or local overexposure as appropriate. Preserve clear identity.

Constraints: no text, visible brand logo, watermark, phone UI, carousel dots, screenshot border, or extra people unless requested.

Avoid: pretty-boy styling, narrowed V jaw, enlarged eyes, porcelain skin, beauty filter, commercial portrait lighting, studio sharpness, cinematic poster look, cute pout, perfect symmetry, celebrity likeness, exaggerated bodybuilding proportions, aged or weathered face.
```

## 无人物生活照模板

```text
Create a fictional daily-life photo from 陈年的 point of view: <scene and objects>.
Make it look casually captured on an older phone, not professionally art-directed. Preserve at least one believable failure such as a crooked frame, foreground obstruction, slight defocus, motion blur, clipped highlight, noisy shadow, or partially cropped subject. Keep the scene readable and consistent with his Shenzhen startup, city-life, sport, or travel context. No text, readable private data, visible brand logo, watermark, social-media UI, or perfect catalog styling.
```

## 任务修饰项

### 自拍

加入：竖幅、胸口以上、身体略向镜头或镜子前倾、脸占比较大、单手随拍。按场景读取 `selfie-style.md`。

### 全身或身材照

加入：183cm比例、肩背舒展、自然训练痕迹、均衡体脂、普通成年人姿态。镜头不能通过超广角或低机位夸张肩宽、腿长和肌肉围度。

### 运动后更衣室

加入：湿发、真实透明汗迹、轻微运动后泛红、宽松白色运动短袖、冷色荧光灯、带薄雾和擦痕的镜面。

### 朋友圈组图

每张单独生成；重复同一时间、服装、发型、天气、光线和物件。第一张交代环境，第二张补人物或细节。

### 修订旧图

同时提供待修图、唯一身份参考和自拍风格参考。明确列出“只改什么”和“必须保留什么”。不要用“重做得更帅”这类开放要求。

## 雨夜v1到v2的修订写法

```text
Edit the rainy roadside-stall selfie. Replace the aged facial impression with 陈年的 canonical youthful adult identity using the sole face reference. Reduce forehead creases, deep under-eye hollows, heavy bags, and dry weathered texture while preserving the strong brow ridge, straight nose, cheekbone plane, solid jaw, real pores, small moles, and natural asymmetry. Keep the rainy stall, finger over the upper-left corner, crooked composition, old-phone softness, moving scooter blur, clipped lights, black clothing, table, cup, and food unchanged. Do not beautify, narrow the jaw, enlarge the eyes, smooth the skin, or turn it into a commercial portrait.
```

## 验收清单

- 是否使用唯一锁脸图，脸没有被风格图或场景参考替换？
- 眉骨、颧骨、鼻骨、下颌、长眼型和略长脸型是否仍然一致？
- 是否像年轻成年人，同时没有幼态化和显老纹理？
- 身材是否保持183cm、自然训练、肩背舒展与均衡体脂？
- 自拍是否像旧手机随拍，而非高清成片后叠颗粒？
- 朋友圈图是否至少有一种自然的半失败特征？
- 镜面、汗、天气、服装和光线是否符合场景？
- 手部、食物、车辆、屏幕和背景人物是否出现畸形或无关细节？
- 是否残留文字、logo、水印、LIVE标识、轮播点、箭头或截图边框？
- 组图是否保持同一时间、脸、服装、发型、光线和环境连续？

任何一项失败，只针对该项修改并再次验收，不无目的地重抽身份。
