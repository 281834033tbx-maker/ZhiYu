# 身份包与素材库（最终复核）

七人均绑定现行固定参考；六位人物已具有实际正面/半身资料及侧脸，Molly为像素助手，正面原图已含头像及上身，新补同一像素侧视，不虚构真人半身。新生成或代码绘制角度经过实际assistant目视比对，reviewed不等于用户重新定稿。小满/厨师侧姿复用既有同一身份全身图，原像素未变。每个清单保来源、审核方法与hash；不存在的角度不会复制正面伪充。

[
  {
    "id": "chen-nian",
    "references": [
      {
        "file": "reference.png",
        "view": "front-three-quarter-face",
        "reviewed": true,
        "userApproved": null,
        "source": "npc-skills/skills/chen-nian-visual-style/assets/identity/chen-nian-face-reference.png"
      },
      {
        "file": "side-reference-20261103.png",
        "view": "side",
        "reviewed": true,
        "userApproved": null,
        "source": "system_imagegen:20261103"
      },
      {
        "file": "half-body-reference-20261103.png",
        "view": "half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "system_imagegen:20261103"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "liu",
    "references": [
      {
        "file": "reference.jpg",
        "view": "front-three-quarter-face",
        "reviewed": true,
        "userApproved": null,
        "source": "public/stitch/6ee1d45916762d31.jpg"
      },
      {
        "file": "approved-scene.png",
        "view": "front-seated-half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/scenes/liu-zhimin-20260926.png"
      },
      {
        "file": "side-reference-20261103.png",
        "view": "left-profile-90-degree-face-upper-chest",
        "reviewed": true,
        "userApproved": null,
        "source": "output/frontend-redesign-20261103/identity-angles/liu/side-reference-20261103.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "zhou-chef",
    "references": [
      {
        "file": "reference.png",
        "view": "front-seated-half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/scenes/zhou-chef-night-sofa-20261005-v1.png"
      },
      {
        "file": "side-existing-v1.png",
        "view": "left-side-full-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/assets/20260927/zhao-yifan/03-body-left-v1.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "he-jiawei",
    "references": [
      {
        "file": "reference.png",
        "view": "front-seated-half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/scenes/he-jiawei-20260926.png"
      },
      {
        "file": "side-reference-20261103.png",
        "view": "left-profile-90-degree-face-upper-chest",
        "reviewed": true,
        "userApproved": null,
        "source": "output/frontend-redesign-20261103/identity-angles/he-jiawei/side-reference-20261103.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "xia-xia",
    "references": [
      {
        "file": "reference.png",
        "view": "front-seated-half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/scenes/xia-xia-anime-sofa-final-20261021.png"
      },
      {
        "file": "side-reference-20261103.png",
        "view": "left-profile-90-degree-face-upper-chest",
        "reviewed": true,
        "userApproved": null,
        "source": "output/frontend-redesign-20261103/identity-angles/xia-xia/side-reference-20261103.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "yuan-xiaoman",
    "references": [
      {
        "file": "reference.png",
        "view": "front-face-eyes-obscured",
        "reviewed": true,
        "userApproved": null,
        "source": "public/npc/yuan-xiaoman/avatar.png"
      },
      {
        "file": "approved-scene.png",
        "view": "front-seated-half-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/scenes/xu-xiaoman-20260926.png"
      },
      {
        "file": "side-existing-v1.png",
        "view": "left-side-full-body",
        "reviewed": true,
        "userApproved": null,
        "source": "public/desktop-npc/assets/20260927/xu-xiaoman/03-body-left-v1.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": []
  },
  {
    "id": "molly",
    "references": [
      {
        "file": "reference.png",
        "view": "front-pixel-avatar-with-upper-torso",
        "reviewed": true,
        "userApproved": null,
        "source": "public/stitch/molly-avatar-v2.png"
      },
      {
        "file": "side-pixel-v1.png",
        "view": "side-pixel-glyph-with-upper-torso",
        "reviewed": true,
        "userApproved": false,
        "source": "side-pixel-v1.svg; palette sampled from existing reference.png"
      }
    ],
    "missingViews": [],
    "notApplicableViews": [
      "photorealistic-human-half-body"
    ]
  }
]

公共library清单仅含有明确历史认可来源的角色素材；实时私聊图经真实视觉复核后进入账号隔离素材库，以免私聊场景混入公开源码。制作文件内部写AIGC属性、提供者与内容编号；此实现不是全部上架/导出法律认证。参考[网信办标识办法答问](https://www.cac.gov.cn/2025-03/14/c_1743654685896173.htm)及[GB45438-2025标准信息](https://std.samr.gov.cn/gb/search/gbDetailed?id=301E0388CB75788DE06397BE0A0AE1B4)。
