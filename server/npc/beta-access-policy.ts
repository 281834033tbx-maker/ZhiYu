import type {IncomingMessage,ServerResponse} from 'node:http';
import type {BetaAccount} from './beta-identity';

type RoutePolicy={allowed:boolean;actions?:ReadonlySet<string>;largeSnapshot?:boolean};
const deny:RoutePolicy={allowed:false},allow:RoutePolicy={allowed:true};
const ordinary=new Set(['send','clear','typing','read','retry']);
const professional=['task_step','task_status','task_timer','task_step_date','task_session_start','task_session_complete'];
const chatActions:Record<string,ReadonlySet<string>>={
  'xia-xia':new Set([...ordinary,'call']),molly:ordinary,'yuan-xiaoman':ordinary,'he-jiawei':ordinary,
  liu:new Set([...ordinary,...professional]),'chen-nian':new Set([...ordinary,...professional]),'zhou-chef':new Set([...ordinary,...professional]),
};
const groupActions=new Set(['remember','create','rename','settings','members','clear','exit','send','open','retry','confirm-plan','reminder']);
// The report card component retains these historical action names for genuine
// scheduled reports too. The service checks actual owner + report provenance.
const secretaryActions=new Set(['settings','locate-city','city','report-quote','report-demo-action','report-demo-quote','usage','completions']);
const arrangementActions=new Set(['offer','revoke','complete','move','step','preference']);
const dialoguePreferenceActions=new Set(['address','reset-address','supervision','board-snapshot']);
const dialoguePreferenceNpcs=new Set([...Object.keys(chatActions),'molly-system-secretary']);
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const mediaFile=new RegExp(`^/api/npc/media/${uuid}\\.(?:jpg|png|webp|gif)$`,'i');
const audioFile=new RegExp(`^/api/npc/audio/${uuid}\\.(?:wav|mp3|mp4|ogg|webm)$`,'i');
/** Explicit normal-product surface. New server routes are not implicitly
 * operator-approved merely because authenticated requests become loopback. */
export function betaNpcRoutePolicy(rawUrl:string,method:string):RoutePolicy{
  if(!rawUrl.startsWith('/api/npc/')||rawUrl.includes('\\')||rawUrl.split('?')[0].includes('%'))return deny;
  let url:URL;try{url=new URL(rawUrl,'http://localhost');}catch{return deny;}
  const path=rawUrl.split('?')[0];if(path!==url.pathname)return deny;
  const chat=/^\/api\/npc\/([^/]+)$/.exec(path)?.[1];
  if(chat&&Object.hasOwn(chatActions,chat)){
    if([...url.searchParams.keys()].some(key=>key!=='mode')||url.searchParams.getAll('mode').some(value=>value!=='normal')||url.searchParams.getAll('mode').length>1)return deny;
    if(method==='GET')return allow;
    return method==='POST'?{allowed:true,actions:chatActions[chat]}:deny;
  }
  if(path==='/api/npc/task-calendar')return method==='GET'&&[...url.searchParams.keys()].every(key=>key==='npc')&&url.searchParams.getAll('npc').length===1?allow:deny;
  if(path==='/api/npc/arrangements'){
    if(method==='GET')return [...url.searchParams.keys()].every(key=>key==='status')&&url.searchParams.getAll('status').length<=1&&url.searchParams.getAll('status').every(value=>value==='active'||value==='all')?allow:deny;
    return method==='POST'&&!url.search?{allowed:true,actions:arrangementActions}:deny;
  }
  if(path==='/api/npc/dialogue-preferences'){
    if(method==='GET')return [...url.searchParams.keys()].every(key=>key==='npc')&&url.searchParams.getAll('npc').length<=1&&url.searchParams.getAll('npc').every(id=>dialoguePreferenceNpcs.has(id))?allow:deny;
    return method==='POST'&&!url.search?{allowed:true,actions:dialoguePreferenceActions,largeSnapshot:true}:deny;
  }
  if(url.search)return deny;
  if(path==='/api/npc/groups')return method==='GET'?allow:method==='POST'?{allowed:true,actions:groupActions}:deny;
  if(path==='/api/npc/secretary')return method==='GET'?allow:method==='POST'?{allowed:true,actions:secretaryActions}:deny;
  if(path==='/api/npc/realtime-speech/settings')return method==='GET'?allow:deny;
  if(path==='/api/npc/moments'||path==='/api/npc/moments/status'||new RegExp(`^/api/npc/moments/${uuid}/image$`,'i').test(path))return method==='GET'?allow:deny;
  if(path==='/api/npc/moments/run-now'||/^\/api\/npc\/moments\/[a-zA-Z0-9_-]+\/interaction$/.test(path))return method==='POST'?allow:deny;
  if(path==='/api/npc/media')return method==='POST'?allow:deny;
  if(mediaFile.test(path)||audioFile.test(path)||path==='/api/npc/audio/status')return method==='GET'?allow:deny;
  if(['/api/npc/audio/upload','/api/npc/audio/translate','/api/npc/audio/transcribe','/api/npc/images/retry','/api/npc/voice/retry'].includes(path))return method==='POST'?allow:deny;
  if(path==='/api/npc/beta-surveys')return method==='GET'?allow:deny;
  if(/^\/api\/npc\/beta-surveys\/(?:A|B)$/.test(path))return method==='GET'||method==='PUT'?allow:deny;
  if(/^\/api\/npc\/beta-surveys\/(?:A|B)\/(?:submit|seen)$/.test(path))return method==='POST'?allow:deny;
  return deny;
}
class PolicyError extends Error{constructor(message:string,public status:number){super(message);}}
async function verifyActionAndReplay(req:IncomingMessage,actions:ReadonlySet<string>,largeSnapshot=false){
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new PolicyError('请发送 JSON 请求',415);
  const chunks:Buffer[]=[];let size=0;
  for await(const raw of req){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>(largeSnapshot?8*1024*1024:128*1024))throw new PolicyError('请求内容过长',413);chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);let body:unknown;
  try{body=JSON.parse(bytes.toString('utf8'));}catch{throw new PolicyError('请求内容无效',400);}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new PolicyError('请求内容无效',400);
  const action=(body as {action?:unknown}).action;
  if(typeof action!=='string'||!actions.has(action))throw new PolicyError('内测账号不能使用维护或演示操作',403);
  if(size>128*1024&&!(largeSnapshot&&action==='board-snapshot'))throw new PolicyError('请求内容过长',413);
  // Existing ordinary NPC handlers all read JSON with for-await. Replay exactly
  // the original bytes once, so their normal validators retain full authority.
  let replayed=false;
  Object.defineProperty(req,Symbol.asyncIterator,{configurable:true,value:async function*(){if(replayed)return;replayed=true;yield bytes;}});
}
/** Invoke after session/Origin validation but BEFORE request normalization and
 * before the task-calendar branch. Non-beta desktop behavior stays synchronous. */
export function guardBetaNpcAccess(req:IncomingMessage,res:ServerResponse,account:Pick<BetaAccount,'is_beta'>,proceed:()=>void):void{
  if(account.is_beta!==1)return proceed();
  const policy=betaNpcRoutePolicy(req.url||'/',req.method||'GET');
  const reject=(status:number,error:string)=>{if(res.writableEnded)return;res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({error}));};
  if(!policy.allowed)return reject(403,'内测账号不能使用维护、调试或全局设置接口');
  if(!policy.actions)return proceed();
  void verifyActionAndReplay(req,policy.actions,policy.largeSnapshot).then(proceed).catch(error=>reject(error instanceof PolicyError?error.status:400,error instanceof PolicyError?error.message:'请求暂时无法处理'));
}
