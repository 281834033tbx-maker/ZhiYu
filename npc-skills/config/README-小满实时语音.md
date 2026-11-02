# 小满实时语音：开发者配置

2026-10-05 用户明确：音色由开发者本人决定，智域用户界面不提供音色选择；实时语音只在独立桌面人物窗口展示。

## 改声音

编辑同目录的 `xiaoman-realtime-voice.json`，用 `voice` 改音色、`speed` 改语速。此文件不含 API Key，每次开启新通话现场读取；正在进行的通话继续使用原设置，挂断再开生效。后续只修改此 JSON 无需重启。

```json
{
  "voice": "zh_female_meilinvyou_uranus_bigtts",
  "speed": -5
}
```

上面是用户于 2026-10-05 指定的新音色与语速，尚未由助手试听。原试通音色为 `zh_female_vv_jupiter_bigtts`。可从[官方全双工音色目录](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)选择当前账号可用的 ID，或填入已开通的复刻音色 ID。

## 改语速

`speed` 是数字，默认 `0`，范围 `-50` 到 `100`，值越大说得越快；`-50` 对应 0.5 倍速，`100` 对应 2 倍速。当前按用户要求设为 `-5`。未填写时使用 `0`；超出范围或填成字符串会显示明确配置错误。

此参数在每次创建实时会话时传入 `session.audio.output.speed`。来源：[Seeduplex 3.0 创建/更新会话](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)。它控制说话速度，和音频采样率 `rate:24000`、文字消息的展示等待时间分别独立。

## 音色参考

| 官方名称 | 音色 ID |
| --- | --- |
| 魅力女友 2.0（当前） | `zh_female_meilinvyou_uranus_bigtts` |
| Vivi 2.0 | `zh_female_vv_uranus_bigtts` |
| 小何 2.0 | `zh_female_xiaohe_uranus_bigtts` |
| 知性女声 2.0 | `zh_female_zhixingnv_uranus_bigtts` |
| 温柔小雅 2.0 | `zh_female_wenrouxiaoya_uranus_bigtts` |
| 邻家女孩 2.0 | `zh_female_linjianvhai_uranus_bigtts` |
| 清新女声 2.0 | `zh_female_qingxinnvsheng_uranus_bigtts` |
| 温柔淑女 2.0 | `zh_female_wenroushunv_uranus_bigtts` |
| 云舟 2.0 | `zh_male_m191_uranus_bigtts` |
| 小天 2.0 | `zh_male_taocheng_uranus_bigtts` |

这些 ID 于本日在官方“S2S-全双工”表逐行读取，尚未逐个用用户账号试听。音色配置不是对话规则，人物相处与语气仍按现行聊天 Skill 输入。

## Skill 范围

通话开始时复用现行聊天 Skill、人设、有效关系、全部同账号同小满分支且有用户原话依据的有效记忆与表达偏好；近期完整问答另限 1200 字符，由豆包实时模型直接回复。这不是剩余 token 计量，真实上下文容量由供应商判断，本地只限制请求传输字节。未经过文字模型的完整逐轮案例检索/成品复核，尚未把通话写入正式好感或长期记忆。通话期间修改 Skill 后需重新开启才读取新规则。配置加载不等于实际回复遵从规则已验收。
