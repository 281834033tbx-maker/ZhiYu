import type {DatabaseSync} from 'node:sqlite';
import {betaSurveyDay,betaSurveyOpener,betaSurveyQuestions,betaSurveyVersions,validateBetaSurveyAnswers,type BetaSurveyAnswers,type BetaSurveyAnalytics,type BetaSurveyCard,type BetaSurveyDocument,type BetaSurveyVersion,type SurveyAnswerRow,type SurveyVersionAnalytics} from '../../lib/npc/beta-surveys';

type Invitation={account_id:string;version:BetaSurveyVersion;scheduled_at:number;due_at:number;received_at:number|null;reminder_due_at:number|null;reminded_at:number|null;seen_at:number|null;submitted_at:number|null;answers_json:string;revision:number;updated_at:number};
export type BetaSurveySubmission={accountId:string;surveyId:BetaSurveyVersion;submissionId:string;at:number};
export type BetaSurveySubmittedHook=(db:DatabaseSync,event:BetaSurveySubmission)=>void;
export class BetaSurveyError extends Error{constructor(message:string,public status=400){super(message);}}
const DAY=86400000,OFFSET=8*3600000;
const finite=(now:number)=>{if(!Number.isFinite(now)||now<0)throw Error('时间无效');return now;};
export function betaSurveyBeijingDay(now:number){return new Date(finite(now)+OFFSET).toISOString().slice(0,10);}
const dayIndex=(now:number)=>Math.floor((finite(now)+OFFSET)/DAY);
const hour=(now:number)=>new Date(now+OFFSET).getUTCHours();
export function betaSurveyDaytimeAt(now:number){
  finite(now);const date=betaSurveyBeijingDay(now),h=hour(now);
  if(h<9)return Date.parse(`${date}T09:00:00+08:00`);
  if(h<21)return now;
  const tomorrow=new Date((dayIndex(now)+1)*DAY).toISOString().slice(0,10);
  return Date.parse(`${tomorrow}T09:00:00+08:00`);
}
let savepointSequence=0;
function atomic<T>(db:DatabaseSync,work:()=>T):T{
  const name=`beta_survey_${++savepointSequence}`;db.exec(`SAVEPOINT ${name}`);
  try{const result=work();db.exec(`RELEASE SAVEPOINT ${name}`);return result;}
  catch(error){db.exec(`ROLLBACK TO SAVEPOINT ${name}`);db.exec(`RELEASE SAVEPOINT ${name}`);throw error;}
}
export function initBetaSurveys(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS beta_survey_first_opens(account_id TEXT NOT NULL,day TEXT NOT NULL,opened_at INTEGER NOT NULL,PRIMARY KEY(account_id,day));
    CREATE TABLE IF NOT EXISTS beta_survey_invitations(account_id TEXT NOT NULL,version TEXT NOT NULL CHECK(version IN ('A','B')),scheduled_at INTEGER NOT NULL,due_at INTEGER NOT NULL,received_at INTEGER,reminder_due_at INTEGER,reminded_at INTEGER,seen_at INTEGER,submitted_at INTEGER,answers_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(account_id,version));
    CREATE INDEX IF NOT EXISTS beta_survey_due ON beta_survey_invitations(received_at,due_at);
    CREATE INDEX IF NOT EXISTS beta_survey_reminder_due ON beta_survey_invitations(submitted_at,reminded_at,reminder_due_at);`);
}
/** Every actual application open calls this; heartbeats cannot create first opens. */
export function noteBetaSurveyOpen(db:DatabaseSync,accountId:string,now=Date.now()){
  finite(now);initBetaSurveys(db);
  const account=db.prepare(`SELECT created_at FROM zhiyu_accounts a WHERE id=? AND is_beta=1 AND NOT EXISTS(SELECT 1 FROM zhiyu_beta_invites i WHERE i.account_id=a.id AND i.disabled_at IS NOT NULL)`).get(accountId) as {created_at:number}|undefined;
  if(!account)return;
  return atomic(db,()=>{
    const day=betaSurveyBeijingDay(now);
    db.prepare('INSERT OR IGNORE INTO beta_survey_first_opens VALUES(?,?,?)').run(accountId,day,now);
    const opened=(db.prepare('SELECT opened_at FROM beta_survey_first_opens WHERE account_id=? AND day=?').get(accountId,day) as {opened_at:number}).opened_at;
    for(const version of betaSurveyVersions){
      if(dayIndex(now)-dayIndex(account.created_at)<betaSurveyDay(version))continue;
      // A missed anniversary is not backdated: the next observed open schedules
      // the unsent version, and its actual receipt time remains the source.
      const due=betaSurveyDaytimeAt(opened+5*60000);
      db.prepare('INSERT OR IGNORE INTO beta_survey_invitations(account_id,version,scheduled_at,due_at,updated_at) VALUES(?,?,?,?,?)').run(accountId,version,now,due,now);
    }
  });
}
/** Durable clock, independent of an open tab. No model or fabricated history. */
export function runDueBetaSurveys(db:DatabaseSync,now=Date.now()){
  finite(now);initBetaSurveys(db);if(betaSurveyDaytimeAt(now)!==now)return {delivered:0,reminded:0};
  return atomic(db,()=>{
    const active=`EXISTS(SELECT 1 FROM zhiyu_accounts a WHERE a.id=beta_survey_invitations.account_id AND a.is_beta=1 AND NOT EXISTS(SELECT 1 FROM zhiyu_beta_invites i WHERE i.account_id=a.id AND i.disabled_at IS NOT NULL))`;
    const delivered=db.prepare(`UPDATE beta_survey_invitations SET received_at=?,reminder_due_at=?,updated_at=? WHERE received_at IS NULL AND due_at<=? AND ${active}`).run(now,now+DAY,now,now).changes;
    const reminded=db.prepare(`UPDATE beta_survey_invitations SET reminded_at=?,updated_at=? WHERE received_at IS NOT NULL AND submitted_at IS NULL AND reminded_at IS NULL AND reminder_due_at<=? AND ${active}`).run(now,now,now).changes;
    return {delivered:Number(delivered),reminded:Number(reminded)};
  });
}
function invitation(db:DatabaseSync,accountId:string,version:BetaSurveyVersion):Invitation{
  const row=db.prepare('SELECT * FROM beta_survey_invitations WHERE account_id=? AND version=? AND received_at IS NOT NULL').get(accountId,version) as Invitation|undefined;
  if(!row)throw new BetaSurveyError('问卷暂未发送',404);return row;
}
function document(row:Invitation):BetaSurveyDocument{return {version:row.version,answers:JSON.parse(row.answers_json) as BetaSurveyAnswers,revision:row.revision,...(row.submitted_at===null?{}:{submittedAt:row.submitted_at})};}
export function betaSurveyDocument(db:DatabaseSync,accountId:string,version:BetaSurveyVersion){return document(invitation(db,accountId,version));}
export function betaSurveyInbox(db:DatabaseSync,accountId:string):{cards:BetaSurveyCard[];unread:number}{
  const rows=db.prepare('SELECT * FROM beta_survey_invitations WHERE account_id=? AND received_at IS NOT NULL ORDER BY received_at,version').all(accountId) as Invitation[];
  const cards=rows.map(row=>({version:row.version,title:'智域内测问卷',durationLabel:'大约 3 分钟',opener:betaSurveyOpener(row.version),receivedAt:row.received_at!,...(row.reminded_at===null?{}:{remindedAt:row.reminded_at}),...(row.submitted_at===null?{}:{submittedAt:row.submitted_at}),...(row.seen_at===null?{}:{seenAt:row.seen_at}),hasDraft:Object.keys(JSON.parse(row.answers_json) as object).length>0}));
  return {cards,unread:cards.filter(row=>Math.max(row.receivedAt,row.remindedAt||0,row.submittedAt||0)>(row.seenAt||0)).length};
}
export function markBetaSurveySeen(db:DatabaseSync,accountId:string,version:BetaSurveyVersion,through:unknown,now=Date.now()){
  if(typeof through!=='number'||!Number.isFinite(through)||through<0||through>now)throw new BetaSurveyError('已读时间无效');
  const row=invitation(db,accountId,version),last=Math.max(row.received_at!,row.reminded_at||0,row.submitted_at||0),seen=Math.max(row.seen_at||0,Math.min(through,last,now));
  db.prepare('UPDATE beta_survey_invitations SET seen_at=MAX(COALESCE(seen_at,0),?) WHERE account_id=? AND version=?').run(seen,accountId,version);return betaSurveyInbox(db,accountId);
}
export function saveBetaSurveyDraft(db:DatabaseSync,accountId:string,version:BetaSurveyVersion,value:unknown,revision:unknown,now=Date.now()){
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new BetaSurveyError('问卷版本无效');
  const {answers}=validateBetaSurveyAnswers(version,value);
  return atomic(db,()=>{
    const row=invitation(db,accountId,version);
    if(row.submitted_at!==null)throw new BetaSurveyError('问卷已提交，不能覆盖答案',409);
    if(row.revision!==revision)throw new BetaSurveyError('问卷已在其他页面更新，请重新打开后继续',409);
    db.prepare('UPDATE beta_survey_invitations SET answers_json=?,revision=revision+1,updated_at=? WHERE account_id=? AND version=?').run(JSON.stringify(answers),now,accountId,version);
    return betaSurveyDocument(db,accountId,version);
  });
}
export function submitBetaSurvey(db:DatabaseSync,accountId:string,version:BetaSurveyVersion,value:unknown,revision:unknown,now=Date.now(),onSubmitted?:BetaSurveySubmittedHook){
  return atomic(db,()=>{
    const row=invitation(db,accountId,version);
    // Repeating submit (including an old-tab retry) returns the original receipt.
    if(row.submitted_at!==null)return {...document(row),fresh:false};
    if(typeof revision!=='number'||!Number.isSafeInteger(revision)||row.revision!==revision)throw new BetaSurveyError('问卷已在其他页面更新，请重新打开后继续',409);
    const {answers,errors}=validateBetaSurveyAnswers(version,value,true);
    if(Object.keys(errors).length)throw new BetaSurveyError('还有必答题未填写');
    db.prepare('UPDATE beta_survey_invitations SET answers_json=?,revision=revision+1,submitted_at=?,updated_at=? WHERE account_id=? AND version=?').run(JSON.stringify(answers),now,now,accountId,version);
    onSubmitted?.(db,{accountId,surveyId:version,submissionId:`beta-survey:${accountId}:${version}`,at:now});
    return {...betaSurveyDocument(db,accountId,version),fresh:true};
  });
}

/** Display redaction applies to quotes for both roles. Only the dedicated
 * founder contact field bypasses it; notes and raw account IDs never enter DTOs. */
export function redactBetaSurveyText(text:string){
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,'[联系方式已隐去]')
    .replace(/(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}/gu,'[手机号已隐去]')
    .replace(/(?:\+?\d[\d ()-]{5,}\d)/gu,'[号码已隐去]')
    .replace(/((?:微\s*信(?:号|账号)?|wechat|weixin|vx|v信|wx)\s*(?:号|id)?\s*[:：=是为]?\s*)([a-z][a-z0-9_-]{4,31})/giu,'$1[微信号已隐去]')
    .replace(/\b[a-z][a-z0-9_-]{5,31}\b/giu,'[可能的联系方式已隐去]');
}
export function buildSurveyAnalytics(db:DatabaseSync,filter:{role:'founder'|'investor';npcId?:string;ageGroup?:string}):BetaSurveyAnalytics{
  initBetaSurveys(db);
  const rows=db.prepare(`SELECT i.*,a.display_number FROM beta_survey_invitations i JOIN zhiyu_accounts a ON a.id=i.account_id WHERE a.is_internal=0 AND a.is_beta=1 AND i.received_at IS NOT NULL ORDER BY i.received_at,a.display_number`).all() as Array<Invitation&{display_number:string}>;
  const firstAnswers=new Map(rows.filter(row=>row.version==='A'&&row.submitted_at!==null).map(row=>[row.account_id,JSON.parse(row.answers_json) as BetaSurveyAnswers]));
  const visibleText=(row:Invitation)=>{
    const profile=firstAnswers.get(row.account_id);
    return (!filter.npcId||profile?.q6===filter.npcId)&&(!filter.ageGroup||profile?.q1===filter.ageGroup);
  };
  const percent=(count:number,total:number)=>total?count*100/total:null;
  const versions={} as {A:SurveyVersionAnalytics;B:SurveyVersionAnalytics};
  for(const version of betaSurveyVersions){
    const received=rows.filter(row=>row.version===version),submitted=received.filter(row=>row.submitted_at!==null).map(row=>({...row,answers:JSON.parse(row.answers_json) as BetaSurveyAnswers}));
    const scoreId=version==='A'?'q10':'q1',scores=submitted.map(row=>row.answers[scoreId]).filter((value):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=10);
    const promoters=scores.filter(score=>score>=9).length,detractors=scores.filter(score=>score<=6).length;
    const questions=betaSurveyQuestions(version).filter(question=>!question.contact||filter.role==='founder').map(question=>{
      const answered=submitted.filter(row=>row.answers[question.id]!==undefined&&row.answers[question.id]!==''&&(!Array.isArray(row.answers[question.id])||(row.answers[question.id] as string[]).length));
      if(question.kind==='text')return {id:question.id,label:question.label,kind:question.kind,total:answered.length,...(question.contact?{contact:true}:{}),answers:answered.filter(visibleText).map(row=>{
        const profile=firstAnswers.get(row.account_id),raw=String(row.answers[question.id]);
        return {userNumber:row.display_number,answer:question.contact?raw:redactBetaSurveyText(raw),submittedAt:row.submitted_at!,...(typeof profile?.q1==='string'?{ageGroup:profile.q1}:{}),...(typeof profile?.q6==='string'?{npcId:profile.q6}:{})} satisfies SurveyAnswerRow;
      })};
      const choices=question.kind==='score'?Array.from({length:11},(_,score)=>({value:String(score),label:`${score} 分`})):(question.options||[]);
      return {id:question.id,label:question.label,kind:question.kind,total:answered.length,options:choices.map(option=>{
        const count=answered.filter(row=>Array.isArray(row.answers[question.id])?(row.answers[question.id] as string[]).includes(option.value):String(row.answers[question.id])===option.value).length;
        return {...option,count,percentage:percent(count,answered.length)};
      })};
    });
    versions[version]={version,received:received.length,submitted:submitted.length,completionRate:percent(submitted.length,received.length),nps:{score:scores.length?(promoters-detractors)*100/scores.length:null,total:scores.length,promoters,passives:scores.length-promoters-detractors,detractors},questions};
  }
  const allReceived=rows.length,allSubmitted=rows.filter(row=>row.submitted_at!==null).length,disappointment=rows.filter(row=>row.version==='B'&&row.submitted_at!==null).map(row=>(JSON.parse(row.answers_json) as BetaSurveyAnswers).q4).filter(Boolean),count=disappointment.filter(value=>value==='非常失望').length;
  return {versions,completion:{received:allReceived,submitted:allSubmitted,rate:percent(allSubmitted,allReceived)},veryDisappointed:{count,total:disappointment.length,rate:percent(count,disappointment.length)},filtersAppliedTo:'text_answers'};
}
