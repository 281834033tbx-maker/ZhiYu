import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {chmodSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';

// Run interactively on the server. Passwords are never command arguments or output.
if(!process.stdin.isTTY||!process.stdout.isTTY){throw Error('请在交互终端运行，密码不会回显。');}
const root=resolve(process.env.ZHIYU_DATA_ROOT||process.cwd()),folder=join(root,'.npc-runtime'),file=join(folder,'beta-admin-secrets.json');
let muted=false;
const output=new Writable({write(chunk,_encoding,done){if(!muted)process.stdout.write(chunk);done();}});
const rl=createInterface({input:process.stdin,output,terminal:true});
const ask=(text,secret=false)=>new Promise(resolveAnswer=>{process.stdout.write(text);muted=secret;rl.question('',answer=>{muted=false;if(secret)process.stdout.write('\n');resolveAnswer(answer);});});
try {
  let stored={version:1,roles:{}};try{const value=JSON.parse(readFileSync(file,'utf8'));if(value?.version===1&&value.roles)stored=value;}catch{}
  console.log('智域后台密码初始化；不会修改用户聊天、邀请码或使用统计。');
  const role=await ask('设置哪个账号？输入 founder（创始人）或 investor（投资人）：');
  if(!['founder','investor'].includes(role))throw Error('账号类型无效。');
  const password=await ask('请输入至少 12 位密码：',true),confirmation=await ask('再次输入密码：',true);
  if(password.length<12||Buffer.byteLength(password)>512)throw Error('密码需要至少 12 位，且不能超过 512 字节。');
  if(password!==confirmation)throw Error('两次密码不一致，没有保存。');
  const other=stored.roles[role==='founder'?'investor':'founder'];
  if(other&&typeof other.salt==='string'&&typeof other.digest==='string'){
    const candidate=scryptSync(password,Buffer.from(other.salt,'hex'),64),digest=Buffer.from(other.digest,'hex');
    if(candidate.length===digest.length&&timingSafeEqual(candidate,digest))throw Error('两个角色必须使用不同密码。');
  }
  const salt=randomBytes(16).toString('hex');stored.roles[role]={salt,digest:scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')};
  mkdirSync(folder,{recursive:true,mode:0o700});const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  writeFileSync(temporary,JSON.stringify(stored,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,file);chmodSync(file,0o600);
  console.log('后台密码已安全保存；该角色的旧登录会话将失效。');
}catch(error){console.error(error instanceof Error?error.message:'初始化未完成。');process.exitCode=1;}finally{muted=false;rl.close();}
