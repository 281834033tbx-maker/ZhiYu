"""打包给朋友的体验包｜2026-09-23 版

相对上一版的改动：
- 适配当前 app.tsx（置顶功能后渲染结构变了）与 data.ts（内置演示帖也清空）
- 浏览器存储键升级为 zhiyu-friends-clean-v2，避免与旧体验包共用 localStorage
- 排除对话证据类文件：references/dialogues.json（作者真实对话原文）、
  references/user-feedback.json（作者纠偏原话）、tests/（QA 用例）、
  scripts/validate_package.py（依赖上面两个文件）；并清理文档里对它们的引用，避免断链
- 保留运行必需的规则与人物档案：accepted-examples.json、lively-density-examples.json、
  corrections.md、common-rules.md、characters/*.md 等（后端每轮会读取）
- 保留小满的六条已批准历史动态（角色设定内容，非作者聊天数据）
- 排除全部运行数据：.npc-runtime、浏览器存储、账号凭证、API Key、日志
"""

from pathlib import Path
import shutil, json, hashlib, zipfile, re

root = Path(__file__).resolve().parents[1]
out = root / 'output' / 'share'
out.mkdir(parents=True, exist_ok=True)
stage = out / 'zhiyu-friends'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()

# ---------- 1) 拷贝源码 ----------
for name in ['app', 'components', 'hooks', 'lib', 'server', 'public', 'npc-skills']:
    shutil.copytree(root / name, stage / name,
                    ignore=shutil.ignore_patterns('.DS_Store', '__pycache__', '*.pyc', 'skill-traces'))
for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts',
             'components.json', 'UI-LAYOUT.md']:
    shutil.copy2(root / name, stage / name)

# ---------- 2) 全新开局：清空内置演示聊天与演示帖 ----------
data = stage / 'app/zhiyu/data.ts'
text = data.read_text()
text, count = re.subn(r'export const initialMessages: Record<string, Message\[\]> = \{.*?\n\};',
                      'export const initialMessages: Record<string, Message[]> = {};', text, count=1, flags=re.S)
assert count == 1, 'initialMessages 结构已变，重新检查'
text, count2 = re.subn(r'export const initialPosts: Post\[\] = \[.*?\n\];',
                       'export const initialPosts: Post[] = [];', text, count=1, flags=re.S)
assert count2 == 1, 'initialPosts 结构已变，重新检查'
data.write_text(text)

# ---------- 3) 全新开局：独立存储键、默认联系人、清空未读、去掉写死的演示时间 ----------
app = stage / 'app/zhiyu/app.tsx'
text = app.read_text()
for old, new, label in [
    ("const STORE = 'zhiyu-stitch-desktop-v2';", "const STORE = 'zhiyu-friends-clean-v2';", '存储键'),
    ("useState('liu');", "useState('molly');", '默认联系人'),
    ("useState<Record<string, number>>({\n    liu: 0,\n  })", "useState<Record<string, number>>({})", '未读数'),
]:
    assert text.count(old) == 1, f'锚点不存在或不唯一：{label}'
    text = text.replace(old, new)
start = text.index("{p.id === 'molly' || pinned.includes(p.id) ? <Pin size={13}")
end = text.index('</time>', start)
text = text[:start] + ("{p.id === 'molly' || pinned.includes(p.id) ? <Pin size={13} "
                       "aria-label={p.id === 'molly' ? '永久置顶' : '已置顶'} /> : "
                       "messages[p.id]?.at(-1)?.time || ''}\n                          ") + text[end:]
start = text.index("{p.id === 'molly' ? messages.molly?.at(-1)?.text")
end = text.index('</small>', start)
text = text[:start] + ("{messages[p.id]?.at(-1)?.text || (p.id === 'molly' ? '找人机器人，闲聊200。' : "
                       "'开始新的对话')}\n                        ") + text[end:]
assert 'chen-nian' in text, '陈年不在会话列表里'
app.write_text(text)

# ---------- 4) vite.config.ts：去掉仅作者环境需要的 Sites 插件 ----------
config = (root / 'vite.config.ts').read_text()
config = config.replace("import { sites } from '@openai/sites-vite-plugin';\n", '')
config = config.replace("import hostingConfig from './.openai/hosting.json';",
                        'const hostingConfig = { d1: null, r2: null };')
config = config.replace('      sites(),\n', '')
assert 'sites()' not in config and 'sites-vite-plugin' not in config
(stage / 'vite.config.ts').write_text(config)

# ---------- 5) 排除对话证据与作者 QA 资料，并清理文档引用 ----------
removals = [
    'npc-skills/references/dialogues.json',
    'npc-skills/references/user-feedback.json',
    'npc-skills/tests',
    'npc-skills/scripts/validate_package.py',
]
for rel in removals:
    target = stage / rel
    assert target.exists(), f'预期要排除的文件不存在：{rel}'
    shutil.rmtree(target) if target.is_dir() else target.unlink()

link_fixes = [
    ('npc-skills/SKILL.md',
     '需要原场景时按 ID 查 [对话证据集](references/dialogues.json) 和 [用户纠偏原文](references/user-feedback.json)。',
     '需要原场景时按 ID 查对话证据集与用户纠偏原文（属作者调试资料，本体验包未附）。'),
    ('npc-skills/SKILL.md',
     '读 [测试方法](tests/evaluation.md)，逐个运行 [测试用例](tests/cases.json)。运行 `python3 scripts/validate_package.py` 检查包结构和证据引用；它不验证模型的真实语感。',
     '读 [填表到档案的规则](references/character-compile.md)。本体验包未附作者的行为回归用例与校验脚本。'),
    ('npc-skills/references/characters/huang-zongze.md',
     '[对话证据集](../dialogues.json)', '对话证据集（本体验包未附）'),
    ('npc-skills/references/characters/huo-tingze.md',
     '[对话证据集](../dialogues.json)', '对话证据集（本体验包未附）'),
]
for rel, old, new in link_fixes:
    f = stage / rel
    t = f.read_text()
    assert old in t, f'{rel} 里找不到待替换文本'
    f.write_text(t.replace(old, new))

# ---------- 6) 启动文件与脚本 ----------
pkg = json.loads((stage / 'package.json').read_text())
pkg['scripts']['start'] = 'node start.mjs'
(stage / 'package.json').write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
for f in (root / 'distribution').iterdir():
    shutil.copy2(f, stage / f.name)
(stage / 'start.command').chmod(0o755)
(stage / '.gitignore').write_text('node_modules/\n.npc-runtime/\n.vinext/\n.wrangler/\n.next/\ndist/\n.env*\n*.log\n')

# ---------- 7) 清单与压缩 ----------
files = sorted(f for f in stage.rglob('*') if f.is_file())
manifest = '\n'.join(hashlib.sha256(f.read_bytes()).hexdigest() + '  ' + f.relative_to(stage).as_posix()
                     for f in files) + '\n'
(stage / 'MANIFEST.sha256').write_text(manifest)
archive = out / '智域-程序与Skill-全新开局版-20260923.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in sorted(stage.rglob('*')):
        if f.is_file():
            z.write(f, Path('zhiyu-friends') / f.relative_to(stage))

# ---------- 8) 校验 ----------
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names = z.namelist()
    forbidden = {'.npc-runtime', '.git', 'node_modules', '.openai', '.codex', '.vinext', '.wrangler', 'output'}
    assert not any(forbidden.intersection(Path(n).parts) or Path(n).name.startswith('.env')
                   or Path(n).suffix in {'.sqlite', '.db', '.log', '.sqlite-wal', '.sqlite-shm'} for n in names), \
        '压缩包里出现了不该有的运行数据'
    for banned in ['dialogues.json', 'user-feedback.json', 'tests/cases.json', 'validate_package.py']:
        assert not any(n.endswith(banned) for n in names), f'{banned} 还在包里'
    shipped = z.read('zhiyu-friends/app/zhiyu/data.ts').decode()
    assert 'initialMessages: Record<string, Message[]> = {};' in shipped and 'initialPosts: Post[] = [];' in shipped
    assert '记得带伞' not in shipped
    app_shipped = z.read('zhiyu-friends/app/zhiyu/app.tsx').decode()
    assert "zhiyu-friends-clean-v2" in app_shipped and "useState('molly')" in app_shipped
    assert 'chen-nian' in app_shipped, '陈年没进包'
    # 后端每轮必需的规则文件必须都在
    for required in ['npc-skills/references/characters/chen-nian.md',
                     'npc-skills/references/characters/yuan-xiaoman.md',
                     'npc-skills/references/characters/xia-xia.md',
                     'npc-skills/references/characters/liu-zhimin.md',
                     'npc-skills/references/characters/molly-system-secretary.md',
                     'npc-skills/references/common-rules.md',
                     'npc-skills/references/accepted-examples.json',
                     'npc-skills/references/lively-density-examples.json',
                     'npc-skills/references/corrections.md',
                     'npc-skills/references/chat-moments.md',
                     'npc-skills/data/moments-approved-20260919.json']:
        assert f'zhiyu-friends/{required}' in names, f'缺少运行必需文件：{required}'
print(f'ZIP 校验通过：{archive}（{archive.stat().st_size / 1024 / 1024:.1f} MiB，{len(files)} 个文件）')
