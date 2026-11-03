# 素材清单

校验算法：SHA-256。尺寸为像素。

| 文件 | 尺寸 | 状态 | 用途 | SHA-256 |
|---|---:|---|---|---|
| `assets/identity/chen-nian-face-reference.png` | 1080×1456 | 现行、唯一 | 陈年身份与五官 | `7b3e44b4d95e99b6064e10da3b220eeccea63238e3263007fc0f6f5dd8239680` |
| `assets/style/front-leaning-selfie-style.png` | 1103×1426 | 现行 | 自拍构图、成像、镜面与气质 | `e81a5378ca872e41f5aae84343acbbe8dffe7fbae4f50df5d14df7ddb66f3528` |
| `assets/examples/share-workdesk-v1.png` | 1086×1448 | 现行样张 | 工作室半失败生活照 | `7479052a4792155b60ad55af52325983ea9b71a020ca7108b3a210d712c0634c` |
| `assets/examples/share-rainy-selfie-v2.png` | 1086×1448 | 现行样张 | 强少年感雨夜直男自拍 | `2f5fab7448d9525e49e7980eb03bb8408769ea318b4ba48294e157ff47aca884` |
| `assets/history/share-rainy-selfie-v1-superseded.png` | 1086×1448 | 已停用 | 显沧桑问题的修订证据 | `813edcef4d8025caebde874acb6971b2852a408129dd382dbba151d6465c3c9d` |
| `assets/history/avatar-placeholder-not-reference.svg` | 矢量 | 已停用 | 程序早期字母头像占位 | `7da8a14aa1f0aaeb463e64e68f38bbbdbb063a50d6eae0f9183a10e25d28ea23` |

## 使用限制

- 只有第一项可以定义陈年的身份。
- 第二项只定义自拍视觉语言。
- `examples/` 可用于验收和场景参考，不得反向覆盖唯一身份。
- `history/` 永远不能作为生成参考，除非任务是比较修订前后差异。
