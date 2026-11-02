import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('需要 Node.js 22.13 以上，建议安装 Node.js 24 LTS。'); process.exit(1);
}
if (process.platform === 'win32') {
  console.error('此分享包请在 Windows 的 WSL 环境中运行；原生 Windows 尚未验证。'); process.exit(1);
}
if (!existsSync('node_modules/vinext')) {
  console.log('首次运行，正在安装项目依赖，需要联网…');
  const result = spawnSync('npm', ['ci'], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) process.exit(result.status || 1);
}
const bin = process.env.NPC_CODEX_BIN || (existsSync('/Applications/ChatGPT.app/Contents/Resources/codex') ? '/Applications/ChatGPT.app/Contents/Resources/codex' : 'codex');
const login = spawnSync(bin, ['login', 'status'], { encoding: 'utf8', timeout: 10000 });
if (login.status !== 0) console.log('未检测到 Codex 登录。网页仍可打开，但 AI 回复不可用。请按说明安装并登录自己的 Codex 账号。');
else {
  const help = spawnSync(bin, ['exec', '--help'], { encoding: 'utf8', timeout: 10000 });
  if (!help.stdout?.includes('--ignore-user-config')) console.log('当前 Codex CLI 可能不支持本程序使用的参数，请更新 CLI；AI 回复可能失败。');
}
const port = process.env.PORT || '3100';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('PORT 必须是 1024–65535 的端口号');
console.log(`智域正在启动，看到 ready 后打开 http://localhost:${port}/ 。按 Ctrl+C 停止。`);
const child = spawn(resolve('node_modules/.bin/vinext'), ['dev', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: 'inherit', cwd: root });
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
