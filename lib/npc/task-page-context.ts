/** User-selected mock task metadata. It is not a ProfessionalTask, a command,
 * proof of completion, or authority to mutate an NPC's task store. */
export type TaskPageContext = {
  source:'task-page-demo';
  id:string;
  title:string;
  date:string;
  summary:string;
};

export const TASK_PAGE_CONTEXT_LIMIT=2400;
const plainText=(value:unknown,min:number,max:number)=>{
  if(typeof value!=='string')return null;
  const text=value.trim();
  return text.length>=min&&text.length<=max?text:null;
};
function hasControlCharacters(text:string,multiline=false) {
  for(let index=0;index<text.length;index++){
    const code=text.charCodeAt(index);
    if(code===127||(code<32&&!(multiline&&(code===9||code===10||code===13))))return true;
  }
  return false;
}

/** undefined = absent; null = invalid. Construct a fresh allow-listed object,
 * so unknown client fields can never enter persisted chat metadata. */
export function parseTaskPageContext(value:unknown):TaskPageContext|undefined|null {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const input=value as Record<string,unknown>;
  if(input.source!=='task-page-demo')return null;
  const id=plainText(input.id,1,128),title=plainText(input.title,1,160);
  const date=plainText(input.date,10,10),summary=plainText(input.summary,1,2000);
  if(!id||!title||!date||!summary||!/^[a-zA-Z0-9:_-]+$/.test(id)
    ||hasControlCharacters(title)||hasControlCharacters(summary,true)
    ||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const dateValue=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(dateValue.getTime())||dateValue.toISOString().slice(0,10)!==date)return null;
  const context:TaskPageContext={source:'task-page-demo',id,title,date,summary:summary.replace(/\r\n?/g,'\n')};
  return JSON.stringify(context).length<=TASK_PAGE_CONTEXT_LIMIT?context:null;
}

/** A future prompt adapter can use this without relabelling a mock task as a
 * server-verified execution record. Existing prompts already serialize the
 * optional metadata on their full ChatMessage history. */
export function describeTaskPageContext(context:TaskPageContext):string {
  return '用户选中的任务页演示快照，仅用于理解当前问题，不代表真实执行或后台已创建任务：'+JSON.stringify(context);
}
