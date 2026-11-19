import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import type {Plugin} from 'vite';
import {initBetaIdentity,lookupBetaAccount,isTrustedHost,isTrustedMutation,generateBetaInvites,listBetaInvites,updateBetaInvite,setAccountInternal} from './beta-identity';
import {createBetaAdminAuth} from './beta-admin-auth';
import {betaAnalyticsChanges,buildBetaDashboard,initBetaAnalytics,recordBetaActivity,recordBetaEvent,type BetaActivityInput,type BetaEventInput} from './beta-analytics-store';
import {initBetaSurveys} from './beta-survey-store';
import {beijingDate,beijingTime,BETA_NPC_NAMES,type BetaDashboard} from '../../lib/npc/beta-analytics';

const CLIENT_EVENTS=new Set(['brief_viewed','weekly_viewed','platform_opened','card_shared']);
function send(res:ServerResponse,status:number,data:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));}
async function body(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('请使用 JSON 请求');let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>16384)throw Error('请求内容过长');}const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('请求内容无效');return value as Record<string,unknown>;}
const safeCsv=(value:unknown)=>{let text=value===null||value===undefined?'':typeof value==='string'||typeof value==='number'||typeof value==='boolean'?String(value):JSON.stringify(value);if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function betaDashboardCsv(data:BetaDashboard,table:string):string {
  let rows:unknown[][];
  switch(table){
    case 'daily':rows=[['日期（北京时间）','活跃用户数','消息总数'],...data.series.map(r=>[r.date,r.activeUsers,r.messages])];break;
    case 'retention':rows=[['加入日期','用户数','第1天留存','第3天留存','第7天留存','第14天留存','第30天留存'],...data.cohorts.map(r=>[r.date,r.users,...r.retention.map(v=>v.rate===null?'数据不足':v.rate+'% ('+v.retained+'/'+v.eligible+')')])];break;
    case 'npcs':rows=[['智友','收到消息数','通话分钟'],...data.npcs.map(r=>[BETA_NPC_NAMES[r.npcId]??r.npcId,r.messages,r.callMinutes])];break;
    case 'features':rows=[['功能','使用次数'],...data.features.map(r=>[r.label,r.count])];break;
    case 'surveys':rows=[['问卷','题目','用户编号','回答'],...(['A','B'] as const).flatMap(v=>data.surveys.versions[v].questions.flatMap(q=>q.answers?.map(a=>[v,q.label,a.userNumber,a.answer])??q.options?.map(o=>[v,q.label,'汇总',o.label+'：'+o.count+'人 / '+(o.percentage===null?'数据不足':o.percentage+'%')])??[]))];break;
    default:rows=[['用户编号',...(data.role==='founder'?['备注']:[]),'加入日期','最近一次活跃','累计消息数','累计使用分钟','最常聊的智友'],...data.users.map(r=>[r.userNumber,...(data.role==='founder'?[r.note??'']:[]),beijingTime(r.joinedAt),beijingTime(r.lastActiveAt),r.messageCount,Math.round(r.activeSeconds/60*100)/100,r.favoriteNpc?BETA_NPC_NAMES[r.favoriteNpc]??r.favoriteNpc:'暂无记录'])];
  }
  return '\uFEFF'+rows.map(row=>row.map(safeCsv).join(',')).join('\r\n')+'\r\n';
}
export function betaAnalyticsLocal(options:{env?:NodeJS.ProcessEnv;now?:()=>number;onOpen?:(db:DatabaseSync,accountId:string,now:number)=>void}={}):Plugin {
  return {name:'zhiyu-beta-analytics-admin',apply:'serve',configureServer(server){
    const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');initBetaIdentity(db);initBetaAnalytics(db);initBetaSurveys(db);
    const auth=createBetaAdminAuth(db,root,{env:options.env}),now=options.now??Date.now;
    server.middlewares.use((req,res,next)=>{
      const path=(req.url??'/').split('?')[0];if(!path.startsWith('/api/admin/')&&!path.startsWith('/api/beta/'))return next();
      // The separate surveys plugin owns its endpoints.
      if(path.startsWith('/api/beta/surveys'))return next();
      if(!isTrustedHost(req))return send(res,403,{error:'请求主机未授权'});
      if(req.method!=='GET'&&!isTrustedMutation(req))return send(res,403,{error:'请求来源无效'});
      if(path.startsWith('/api/beta/')){
        const account=lookupBetaAccount(req,db,now());if(!account)return send(res,401,{error:'请先登录智域'});
        if(req.headers['x-zhiyu-account']!==account.id)return send(res,409,{error:'账号已切换，请刷新后重试'});
        if(req.method!=='POST')return send(res,405,{error:'不支持此请求方式'});
        void (async()=>{
          const input=await body(req);
          if(path==='/api/beta/activity'){
            const activity=recordBetaActivity(db,account.id,input as BetaActivityInput,now());
            if(input.action==='open'&&!activity.duplicate)options.onOpen?.(db,account.id,now());
            return send(res,200,{ok:true,...activity});
          }
          if(path==='/api/beta/events'){
            const batch=Array.isArray(input.events)?input.events:[input];if(batch.length>32)throw Error('事件过多');
            let accepted=0;
            for(const value of batch){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('事件无效');const item=value as Record<string,unknown>;
              if(!CLIENT_EVENTS.has(String(item.type)))throw Error('此事件由服务器记录');
              if(Object.keys(item).some(k=>!['eventId','type','npcId','meta'].includes(k)))throw Error('事件不能包含正文、用户身份或自报时长');
              if(item.meta&&typeof item.meta==='object'&&'recipientIds' in item.meta)throw Error('收信智友由服务器记录');
              if(recordBetaEvent(db,{accountId:account.id,eventId:item.eventId as string,type:item.type as BetaEventInput['type'],npcId:item.npcId as string|undefined,meta:item.meta as BetaEventInput['meta'],at:now()}))accepted++;
            }
            return send(res,200,{ok:true,accepted});
          }
          return send(res,404,{error:'接口不存在'});
        })().catch(()=>send(res,400,{error:'使用事件无效，请刷新后重试'}));return;
      }
      if(path==='/api/admin/session'&&req.method==='GET')return send(res,200,{role:auth.sessionFor(req,now()),configured:auth.configured()});
      if(path==='/api/admin/login'&&req.method==='POST'){
        void body(req).then(input=>{const result=auth.login(req,res,input,now());send(res,result.status,result);}).catch(()=>send(res,400,{error:'登录请求无效'}));return;
      }
      const role=auth.sessionFor(req,now());if(!role)return send(res,401,{error:'请先登录数据看板'});
      if(path==='/api/admin/logout'&&req.method==='POST'){auth.logout(req,res);return send(res,200,{ok:true});}
      if(path==='/api/admin/updates'&&req.method==='GET'){
        res.statusCode=200;res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.write(': connected\n\n');
        const changed=()=>{if(auth.sessionFor(req,now())!==role){res.end();return;}res.write('event: changed\ndata: {}\n\n');};
        const keep=setInterval(()=>{if(auth.sessionFor(req,now())!==role){res.end();return;}res.write(': keepalive\n\n');},25000);
        const serverClose=()=>{close();res.end();};
        const close=()=>{clearInterval(keep);betaAnalyticsChanges.removeListener('change',changed);server.httpServer?.removeListener('close',serverClose);};
        betaAnalyticsChanges.on('change',changed);res.once('close',close);server.httpServer?.once('close',serverClose);return;
      }
      const query=new URL(req.url??'/', 'http://localhost').searchParams;
      const filters={...(query.get('npcId')?{npcId:query.get('npcId')!}:{}),...(query.get('ageGroup')?{ageGroup:query.get('ageGroup')!}:{})};
      if(path==='/api/admin/dashboard'&&req.method==='GET'){try{return send(res,200,buildBetaDashboard(db,role,now(),filters));}catch{return send(res,500,{error:'数据读取失败，请重试'});}}
      if(path==='/api/admin/export.csv'&&req.method==='GET'){
        try{const data=buildBetaDashboard(db,role,now(),filters),csv=betaDashboardCsv(data,query.get('table')??'users');res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition',`attachment; filename="zhiyu-${beijingDate(now())}.csv"`);res.setHeader('X-Content-Type-Options','nosniff');res.end(csv);return;}catch{return send(res,500,{error:'表格导出失败，请重试'});}
      }
      // Role checks happen before reading bodies or sensitive tables, including CSV.
      if(role!=='founder')return send(res,403,{error:'此操作仅创始人可用'});
      if(path==='/api/admin/invites'&&req.method==='GET')return send(res,200,{invites:listBetaInvites(db)});
      if(path==='/api/admin/accounts'&&req.method==='GET')return send(res,200,{accounts:db.prepare(`SELECT a.id,a.display_number AS userNumber,a.is_internal AS internal,a.created_at AS joinedAt,i.note FROM zhiyu_accounts a LEFT JOIN zhiyu_beta_invites i ON i.account_id=a.id ORDER BY a.created_at DESC`).all()});
      if(req.method!=='POST')return send(res,405,{error:'不支持此请求方式'});
      void (async()=>{
        const input=await body(req);
        if(path==='/api/admin/invites'){
          if(!Number.isSafeInteger(input.count)||Number(input.count)<1||Number(input.count)>500||input.note!==undefined&&(typeof input.note!=='string'||input.note.length>200)||input.isInternal!==undefined&&typeof input.isInternal!=='boolean')throw Error('邀请码参数无效');
          return send(res,200,{invites:generateBetaInvites(db,{count:input.count as number,note:input.note as string|undefined,isInternal:input.isInternal===true},now())});
        }
        const invite=path.match(/^\/api\/admin\/invites\/([A-Za-z0-9-]+)$/);
        if(invite){if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>200)||input.disabled!==undefined&&typeof input.disabled!=='boolean'||input.isInternal!==undefined&&typeof input.isInternal!=='boolean')throw Error('修改内容无效');const updated=updateBetaInvite(db,invite[1],input,now());if(updated)betaAnalyticsChanges.emit('change');return send(res,updated?200:404,{ok:updated});}
        const internal=path.match(/^\/api\/admin\/accounts\/([A-Za-z0-9-]+)\/internal$/);
        if(internal){if(typeof input.internal!=='boolean')throw Error('内部账号标记无效');const updated=setAccountInternal(db,internal[1],input.internal);if(updated)betaAnalyticsChanges.emit('change');return send(res,updated?200:404,{ok:updated});}
        return send(res,404,{error:'接口不存在'});
      })().catch(()=>send(res,400,{error:'操作未完成，请检查输入后重试'}));
    });
    server.httpServer?.once('close',()=>db.close());
  }};
}
