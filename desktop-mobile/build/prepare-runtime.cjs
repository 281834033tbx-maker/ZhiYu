'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const target = path.join(__dirname, 'electron-runtime');
const installed = path.resolve(__dirname, '../../desktop/node_modules/electron/dist');
const ready = directory => fs.existsSync(path.join(directory, 'Electron.app/Contents/Info.plist')) &&
  fs.existsSync(path.join(directory, 'version')) && fs.readFileSync(path.join(directory, 'version'), 'utf8').trim() === '33.4.11';
if (ready(target)) process.exit(0);
fs.mkdirSync(target, {recursive:true});
if (ready(installed)) {
  fs.cpSync(installed, target, {recursive:true, dereference:false});
} else {
  const archive = path.join(os.homedir(), 'Library/Caches/electron/electron-v33.4.11-darwin-arm64.zip');
  if (!fs.existsSync(archive)) throw Error('找不到本机已有的 Electron 33.4.11 arm64 运行时或缓存；本脚本不会下载新依赖。');
  execFileSync('/usr/bin/ditto', ['-xk', archive, target], {stdio:'inherit'});
}
if (!ready(target)) throw Error('本机 Electron 缓存解包后不完整。');
