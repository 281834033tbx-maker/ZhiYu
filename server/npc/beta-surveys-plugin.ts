import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Plugin} from 'vite';
import {isBetaSurveyVersion} from '../../lib/npc/beta-surveys';
import {initBetaIdentity,isTrustedHost,isTrustedMutation,lookupBetaAccount} from './beta-identity';
import {BetaSurveyError,betaSurveyDocument,betaSurveyInbox,initBetaSurveys,markBetaSurveySeen,runDueBetaSurveys,saveBetaSurveyDraft,submitBetaSurvey,type BetaSurveySubmittedHook} from './beta-survey-store';

export type BetaSurveysOptions={now?:()=>number;automatic?:boolean;onSubmitted?:BetaSurveySubmittedHook};
const send=(res:ServerResponse,status:number,value:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
async function body(req:IncomingMessage){
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new BetaSurveyError('请发送 JSON 数据',415);
  const chunks:Buffer[]=[];let size=0;
  for await(const raw of req){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>64*1024)throw new BetaSurveyError('问卷内容过长',413);chunks.push(chunk);}
  let parsed:unknown;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BetaSurveyError('问卷内容无效');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new BetaSurveyError('问卷内容无效');
  return parsed as Record<string,unknown>;
}
export function betaSurveysLocal(options:BetaSurveysOptions={}):Plugin{
  return {name:'zhiyu-beta-surveys',apply:'serve',configureServer(server){
    const root=server.config.root,now=options.now||Date.now;mkdirSync(join(root,'.npc-runtime'),{recursive:true});
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');initBetaIdentity(db);initBetaSurveys(db);
    const timer=options.automatic===false?undefined:setInterval(()=>{try{runDueBetaSurveys(db,now());}catch{/* A later tick retries durable due rows; no invented receipt. */}},15000);timer?.unref();
    server.middlewares.use((req,res,next)=>{
      const path=(req.url||'/').split('?')[0];if(path!=='/api/npc/beta-surveys'&&!path.startsWith('/api/npc/beta-surveys/'))return next();
      void(async()=>{
        if(!isTrustedHost(req)||(req.method!=='GET'&&!isTrustedMutation(req)))return send(res,403,{error:'请求来源无效'});
        const account=lookupBetaAccount(req,db,now());if(!account)return send(res,401,{error:'请先登录智域'});
        if(req.headers['x-zhiyu-account']!==account.id)return send(res,409,{error:'账号已变化，请重新打开问卷'});
        runDueBetaSurveys(db,now());
        if(path==='/api/npc/beta-surveys')return req.method==='GET'?send(res,200,betaSurveyInbox(db,account.id)):send(res,405,{error:'不支持的方法'});
        const [,version,action]=/^\/api\/npc\/beta-surveys\/([^/]+)(?:\/(submit|seen))?$/.exec(path)||[];
        if(!isBetaSurveyVersion(version))return send(res,404,{error:'问卷不存在'});
        if(!action&&req.method==='GET')return send(res,200,betaSurveyDocument(db,account.id,version));
        if((!action&&req.method!=='PUT')||(action&&req.method!=='POST'))return send(res,405,{error:'不支持的方法'});
        const input=await body(req);
        if(action==='seen'){
          if(Object.keys(input).some(key=>key!=='through'))throw new BetaSurveyError('问卷已读参数无效');
          return send(res,200,markBetaSurveySeen(db,account.id,version,input.through,now()));
        }
        if(Object.keys(input).some(key=>!['answers','revision'].includes(key)))throw new BetaSurveyError('问卷参数无效');
        return send(res,200,action==='submit'?submitBetaSurvey(db,account.id,version,input.answers,input.revision,now(),options.onSubmitted):saveBetaSurveyDraft(db,account.id,version,input.answers,input.revision,now()));
      })().catch(error=>{if(res.writableEnded)return;send(res,error instanceof BetaSurveyError?error.status:400,{error:error instanceof BetaSurveyError?error.message:'问卷暂时没保存上，请重试'});});
    });
    server.httpServer?.once('close',()=>{if(timer)clearInterval(timer);db.close();});
  }};
}
