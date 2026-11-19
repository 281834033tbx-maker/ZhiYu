# Desktop phone preview Pinyin dictionary

Unmodified `pinyin_simp.dict.yaml` from the official Rime project:
https://github.com/rime/rime-pinyin-simp

Pinned commit: `0c6861ef7420ee780270ca6d993d18d4101049d0`.
Source: https://github.com/rime/rime-pinyin-simp/blob/0c6861ef7420ee780270ca6d993d18d4101049d0/pinyin_simp.dict.yaml
Retrieved 2026-11-16. 65,125 entries; 1,266,216 bytes.
Apache License 2.0; see LICENSE and AUTHORS in this directory.
The dictionary is derived from Android's open source Pinyin IME.

Zhiyu's separate TypeScript preview helper parses the unmodified data and ranks
local suggestions. It is a desktop phone-preview convenience, not Rime's engine
or a replacement for an iPhone's system IME. It supports toneless full Pinyin,
continuous word composition, explicit apostrophe boundaries and `v` for `ü`.
Rare/new names, slang, abbreviations, typo correction, contextual language models,
personal learning, cloud suggestions and system-wide input are not provided.
Loading and candidate selection use this app's static assets only; no typed text
is uploaded. The first keyboard opening downloads the bundled dictionary from
the app origin; an already loaded dictionary remains in memory for the session.
