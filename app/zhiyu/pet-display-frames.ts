// Visible pose bounds keep differently padded source images at the same optical scale.
// Original PNG bytes and stored pet image URLs remain unchanged.
export type PetDisplayFrame = {
  source: string;
  imageWidth: number;
  imageHeight: number;
  bodyBounds: readonly [number, number, number, number];
  clipBounds: readonly [number, number, number, number];
  viewBox: string;
};

export const petDisplayFrames: Readonly<Record<string, PetDisplayFrame>> = {
  "/pets/regular/african-lion-display.png": {
    "source": "/pets/regular/african-lion-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      128,
      256,
      1280,
      1120
    ],
    "clipBounds": [
      126,
      254,
      1284,
      1124
    ],
    "viewBox": "56 184 1424 1264"
  },
  "/pets/regular/spotted-hyena-display.png": {
    "source": "/pets/regular/spotted-hyena-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      128,
      224,
      1248,
      1152
    ],
    "clipBounds": [
      126,
      222,
      1252,
      1156
    ],
    "viewBox": "58 154 1388 1292"
  },
  "/pets/regular/three-toed-sloth-display.png": {
    "source": "/pets/regular/three-toed-sloth-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      192,
      224,
      1152,
      1152
    ],
    "clipBounds": [
      190,
      222,
      1156,
      1156
    ],
    "viewBox": "128 160 1280 1280"
  },
  "/pets/regular/tibetan-fox-display.png": {
    "source": "/pets/regular/tibetan-fox-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      128,
      288,
      1280,
      1088
    ],
    "clipBounds": [
      126,
      286,
      1284,
      1092
    ],
    "viewBox": "56 216 1424 1232"
  },
  "/pets/regular/bengal-cat-display.png": {
    "source": "/pets/regular/bengal-cat-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      160,
      224,
      1184,
      1152
    ],
    "clipBounds": [
      158,
      222,
      1188,
      1156
    ],
    "viewBox": "94 158 1316 1284"
  },
  "/pets/regular/devon-rex-display.png": {
    "source": "/pets/regular/devon-rex-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      52,
      119,
      373,
      385
    ],
    "clipBounds": [
      50,
      117,
      377,
      389
    ],
    "viewBox": "30 97 417 429"
  },
  "/pets/regular/siberian-husky-display.png": {
    "source": "/pets/regular/siberian-husky-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      192,
      224,
      1120,
      1152
    ],
    "clipBounds": [
      190,
      222,
      1124,
      1156
    ],
    "viewBox": "128 160 1248 1280"
  },
  "/pets/regular/king-cobra-display.png": {
    "source": "/pets/regular/king-cobra-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      192,
      224,
      1120,
      1152
    ],
    "clipBounds": [
      190,
      222,
      1124,
      1156
    ],
    "viewBox": "128 160 1248 1280"
  },
  "/pets/regular/turkey-vulture-display.png": {
    "source": "/pets/regular/turkey-vulture-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      128,
      256,
      1280,
      1120
    ],
    "clipBounds": [
      126,
      254,
      1284,
      1124
    ],
    "viewBox": "56 184 1424 1264"
  },
  "/pets/regular/golden-retriever-display.png": {
    "source": "/pets/regular/golden-retriever-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      128,
      224,
      1248,
      1152
    ],
    "clipBounds": [
      126,
      222,
      1252,
      1156
    ],
    "viewBox": "58 154 1388 1292"
  },
  "/pets/regular/penguin-display.png": {
    "source": "/pets/regular/penguin-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      288,
      224,
      960,
      1152
    ],
    "clipBounds": [
      286,
      222,
      964,
      1156
    ],
    "viewBox": "224 160 1088 1280"
  },
  "/pets/regular/westie-display.png": {
    "source": "/pets/regular/westie-display.png",
    "imageWidth": 1536,
    "imageHeight": 1536,
    "bodyBounds": [
      192,
      224,
      1120,
      1152
    ],
    "clipBounds": [
      190,
      222,
      1124,
      1156
    ],
    "viewBox": "128 160 1248 1280"
  },
  "/pets/regular/tarantula.png": {
    "source": "/pets/regular/tarantula-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      26,
      190,
      382,
      301
    ],
    "clipBounds": [
      24,
      188,
      386,
      305
    ],
    "viewBox": "4 168 426 345"
  },
  "/pets/regular/snow-leopard.png": {
    "source": "/pets/regular/snow-leopard-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      27,
      113,
      382,
      341
    ],
    "clipBounds": [
      25,
      111,
      386,
      345
    ],
    "viewBox": "5 91 426 385"
  },
  "/pets/regular/chinese-crested.png": {
    "source": "/pets/regular/chinese-crested-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      34,
      53,
      382,
      441
    ],
    "clipBounds": [
      32,
      51,
      386,
      445
    ],
    "viewBox": "9 28 432 491"
  },
  "/pets/regular/crocodile.png": {
    "source": "/pets/regular/crocodile-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      45,
      223,
      387,
      233
    ],
    "clipBounds": [
      43,
      221,
      391,
      237
    ],
    "viewBox": "23 201 431 277"
  },
  "/pets/limited/revived-macaw-cutout.png": {
    "source": "/pets/limited/revived-macaw-cutout.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      106,
      79,
      1043,
      1148
    ],
    "clipBounds": [
      104,
      77,
      1047,
      1152
    ],
    "viewBox": "42 15 1171 1276"
  },
  "/pets/limited/dragonfruit-ballerina-display.png": {
    "source": "/pets/limited/dragonfruit-ballerina-display.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      256,
      58,
      742,
      1171
    ],
    "clipBounds": [
      254,
      56,
      746,
      1175
    ],
    "viewBox": "190 -8 874 1303"
  },
  "/pets/limited/briefcase-person.png": {
    "source": "/pets/limited/briefcase-person.png",
    "imageWidth": 1760,
    "imageHeight": 1760,
    "bodyBounds": [
      240,
      200,
      1420,
      1420
    ],
    "clipBounds": [
      238,
      198,
      1424,
      1424
    ],
    "viewBox": "161 121 1578 1578"
  },
  "/pets/limited/deepsea-tv-fish.png": {
    "source": "/pets/limited/deepsea-tv-fish.png",
    "imageWidth": 1024,
    "imageHeight": 1024,
    "bodyBounds": [
      96,
      208,
      880,
      720
    ],
    "clipBounds": [
      94,
      206,
      884,
      724
    ],
    "viewBox": "47 159 978 818"
  },
  "/pets/limited/banana-salmon-cutout.png": {
    "source": "/pets/limited/banana-salmon-cutout.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      83,
      113,
      1116,
      1064
    ],
    "clipBounds": [
      81,
      111,
      1120,
      1068
    ],
    "viewBox": "21 51 1240 1188"
  },
  "/pets/limited/mecha-toad-cutout.png": {
    "source": "/pets/limited/mecha-toad-cutout.png",
    "imageWidth": 1393,
    "imageHeight": 1129,
    "bodyBounds": [
      104,
      101,
      1151,
      969
    ],
    "clipBounds": [
      102,
      99,
      1155,
      973
    ],
    "viewBox": "40 37 1279 1097"
  },
  "/pets/shenzhen/banana-gorilla.png": {
    "source": "/pets/shenzhen/banana-gorilla.png",
    "imageWidth": 512,
    "imageHeight": 512,
    "bodyBounds": [
      70,
      60,
      403,
      410
    ],
    "clipBounds": [
      68,
      58,
      407,
      414
    ],
    "viewBox": "47 37 449 456"
  },
  "/pets/shenzhen/mecha-creature.png": {
    "source": "/pets/shenzhen/mecha-creature.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      60,
      172,
      1136,
      956
    ],
    "clipBounds": [
      58,
      170,
      1140,
      960
    ],
    "viewBox": "-4 108 1264 1084"
  },
  "/pets/shenzhen/capybara.png": {
    "source": "/pets/shenzhen/capybara.png",
    "imageWidth": 512,
    "imageHeight": 512,
    "bodyBounds": [
      64,
      85,
      408,
      353
    ],
    "clipBounds": [
      62,
      83,
      412,
      357
    ],
    "viewBox": "41 62 454 399"
  },
  "/pets/shenzhen/sneaker-shark.png": {
    "source": "/pets/shenzhen/sneaker-shark.png",
    "imageWidth": 512,
    "imageHeight": 512,
    "bodyBounds": [
      29,
      108,
      459,
      331
    ],
    "clipBounds": [
      27,
      106,
      463,
      335
    ],
    "viewBox": "3 82 511 383"
  },
  "/pets/regular/devon-rex.png": {
    "source": "/pets/regular/devon-rex-states.png",
    "imageWidth": 1254,
    "imageHeight": 1254,
    "bodyBounds": [
      52,
      119,
      373,
      385
    ],
    "clipBounds": [
      50,
      117,
      377,
      389
    ],
    "viewBox": "30 97 417 429"
  }
};
