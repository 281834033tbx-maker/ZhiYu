import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
export type ApprovedMoment = {id:string;personId:string;title:string;text:string;images:string[];scheduledFor?:string;timelineAt?:string;publicationMode?:'historical';sourceRequestId:string;authorization:string;approved:boolean;provenance:string};
export type ScheduledRow = {id:string;character:string;scheduled:number;status:'scheduled'|'published'|'blocked_by_role_policy';published:number|null;data:string};
export const scheduledPolicy = {minGapMs:2*60*60*1000,maxDaily:2,timezone:'Asia/Shanghai'};
export function installApprovedMoments(db:DatabaseSync,root:string) {
  db.exec(`CREATE TABLE IF NOT EXISTS npc_scheduled_moments(id TEXT PRIMARY KEY,character TEXT NOT NULL,scheduled INTEGER NOT NULL,status TEXT NOT NULL,published INTEGER,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS npc_moment_publication_receipts(id TEXT PRIMARY KEY,published INTEGER NOT NULL,data TEXT NOT NULL);`);
  const file=join(root,'npc-skills/data/moments-approved-20260919.json');
  if(!existsSync(file))return;
  const manifest=JSON.parse(readFileSync(file,'utf8')) as {items:ApprovedMoment[]};
  // Validate the complete batch before inserting anything. Never overwrite published rows.
  for(const item of manifest.items){
    if(item.approved!==true || !item.authorization || item.personId!=='yuan-xiaoman' || !item.id.startsWith('approved-') || !Number.isFinite(Date.parse(item.timelineAt || item.scheduledFor || '')) || typeof item.text!=='string' || !Array.isArray(item.images) || (!item.text && !item.images.length))throw Error('动态发布清单无效');
    for(const url of item.images){
      const base=resolve(root,'public/npc/yuan-xiaoman/moments')+sep,path=resolve(root,'public',url.slice(1));
      if(!url.startsWith('/npc/yuan-xiaoman/moments/') || !path.startsWith(base) || !existsSync(path))throw Error('动态原图缺失或路径无效');
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const item of manifest.items) {
      const at=Date.parse(item.timelineAt || item.scheduledFor || '');
      if(item.publicationMode==='historical') {
        if(at>Date.now())throw Error('历史动态不能放在未来');
        const previous=db.prepare('SELECT * FROM npc_scheduled_moments WHERE id=?').get(item.id) as ScheduledRow|undefined;
        if(previous?.status==='published' && previous.published===at && previous.data===JSON.stringify(item))continue;
        db.prepare("INSERT INTO npc_scheduled_moments VALUES(?,?,?,'published',?,?) ON CONFLICT(id) DO UPDATE SET scheduled=excluded.scheduled,status='published',published=excluded.published,data=excluded.data").run(item.id,item.personId,at,at,JSON.stringify(item));
        const appliedAt=Date.now();
        db.prepare('INSERT OR REPLACE INTO npc_moment_publication_receipts VALUES(?,?,?)').run(item.id,appliedAt,JSON.stringify({id:item.id,status:'published',mode:'historical_import',timelineAt:new Date(at).toISOString(),appliedAt:new Date(appliedAt).toISOString(),destination:'local-app-moments',sourceRequestId:item.sourceRequestId,previousState:previous||null}));
      } else db.prepare("INSERT OR IGNORE INTO npc_scheduled_moments VALUES(?,?,?,'scheduled',NULL,?)").run(item.id,item.personId,at,JSON.stringify(item));
    }
    db.exec('COMMIT');
  }
  catch(e){db.exec('ROLLBACK');throw e;}
}
const localDay=(at:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:scheduledPolicy.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function publishDueMoments(db:DatabaseSync,now=Date.now()) {
  const published:string[]=[];
  db.exec('BEGIN IMMEDIATE');
  try{
    // Also covers direct publication utilities, not only the running app queue.
    // Published history and original payloads are retained verbatim.
    db.prepare("UPDATE npc_scheduled_moments SET status='blocked_by_role_policy' WHERE character IN ('molly','molly-system-secretary') AND status='scheduled'").run();
    const due=db.prepare("SELECT * FROM npc_scheduled_moments WHERE status='scheduled' AND scheduled<=? ORDER BY scheduled").all(now) as ScheduledRow[];
    for(const row of due){
      const history=db.prepare("SELECT published FROM npc_scheduled_moments WHERE character=? AND status='published' ORDER BY published DESC").all(row.character) as {published:number}[];
      // Approved historical rows stay untouched. New scheduled publications share
      // the same quota with autonomous posts rather than getting a second quota.
      if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_moments'").get()){
        const live=db.prepare("SELECT owner,created,data FROM npc_moments WHERE character=? AND status='published'").all(row.character) as {owner:string;created:number;data:string}[];
        const owners=new Set(live.map(item=>item.owner));
        if([...owners].some(owner=>{
          const own=live.filter(item=>item.owner===owner).map(item=>JSON.parse(item.data).publishedAt||item.created);
          const all=[...own,...history.map(item=>item.published)].sort((a,b)=>b-a);
          return (all[0]&&now-all[0]<scheduledPolicy.minGapMs)||all.filter(at=>localDay(at)===localDay(now)).length>=scheduledPolicy.maxDaily;
        }))continue;
      }
      if(history[0] && now-history[0].published<scheduledPolicy.minGapMs)continue;
      if(history.filter(h=>localDay(h.published)===localDay(now)).length>=scheduledPolicy.maxDaily)continue;
      const data=JSON.parse(row.data) as ApprovedMoment;
      if(!data.approved || !data.authorization)continue;
      const result=db.prepare("UPDATE npc_scheduled_moments SET status='published',published=? WHERE id=? AND status='scheduled'").run(now,row.id);
      if(result.changes){
        db.prepare('INSERT OR IGNORE INTO npc_moment_publication_receipts VALUES(?,?,?)').run(row.id,now,JSON.stringify({id:row.id,character:row.character,scheduledFor:new Date(row.scheduled).toISOString(),publishedAt:new Date(now).toISOString(),destination:'local-app-moments',sourceRequestId:data.sourceRequestId,status:'published'}));
        published.push(row.id);
      }
    }
    db.exec('COMMIT');return published;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function scheduledMomentItems(db:DatabaseSync) {
  return (db.prepare('SELECT * FROM npc_scheduled_moments ORDER BY scheduled').all() as ScheduledRow[])
    .filter(row => !['molly','molly-system-secretary'].includes(row.character) || row.status === 'published')
    .map(row=>{
    const p=JSON.parse(row.data) as ApprovedMoment;
    return {id:row.id,personId:row.character,status:row.status,text:p.text,title:p.title,createdAt:row.published||row.scheduled,scheduledFor:row.scheduled,images:p.images,source:'npc-moment' as const};
  });
}
