import * as sqlite from 'node:sqlite';
import {chmodSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';

// Creates a consistent online SQLite snapshot, including committed WAL rows.
// Never copies only the live .sqlite file while other connections are writing.
process.umask(0o077);
const source=join(resolve(process.env.ZHIYU_DATA_ROOT||process.cwd()),'.npc-runtime/state.sqlite');
const target=process.argv[2]?resolve(process.argv[2]):null;
if(!target||existsSync(target)||!existsSync(source))throw Error('请指定一个尚不存在的备份文件路径，并确认服务数据库存在。');
mkdirSync(dirname(target),{recursive:true,mode:0o700});
const db=new sqlite.DatabaseSync(source,{readOnly:true});
try{
  db.exec('PRAGMA busy_timeout=10000');
  if(typeof sqlite.backup==='function')await sqlite.backup(db,target);
  else db.prepare('VACUUM INTO ?').run(target);
  const check=new sqlite.DatabaseSync(target,{readOnly:true});
  try{const row=check.prepare('PRAGMA quick_check').get();if(!row||Object.values(row)[0]!=='ok')throw Error('备份完整性检查失败');}finally{check.close();}
  chmodSync(target,0o600);console.log('SQLite 在线备份完成，完整性检查通过。请另行备份用户媒体与后台密码文件。');
}catch(reason){rmSync(target,{force:true});throw reason;}finally{db.close();}
