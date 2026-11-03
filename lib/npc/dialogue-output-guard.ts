/** Product speech guard. It inspects only public speech fields, never memory,
 * task evidence or user input, and never changes a technical number. */
export const dialogueForbiddenTerms=['NPC','AI生成','生成中','生成失败','演示','原型','本地服务','Codex','DeepSeek','模型','Skill','prompt','.json','.md','npc-skills','user_required','未记录','US$'] as const;
export const dialogueForbiddenAliases=['许晓曼','袁小满','许小满','周师傅'] as const;
export type DialogueOutputGuardContext={userText?:string;characterId?:string};
export type DialogueOutputInspection={value:unknown;issues:string[];replacements:number};
const aliasMap:Record<string,string>={'许晓曼':'徐小曼','袁小满':'小满','许小满':'小满','周师傅':'赵一帆'};
export function publicSpeechForbidden(text:string):string[]{
  return dialogueForbiddenTerms.filter(term=>term==='NPC'?/npc/i.test(text):text.toLowerCase().includes(term.toLowerCase()));
}
export function speechBlacklistIssues(text:string,context:DialogueOutputGuardContext={}):string[]{
  const issues:string[]=[];
  const patterns:[string,RegExp][]=[
    ['确认收到式开头',/^(?:那确实|确实|这个我认|我知道(?:[，,。！!]|$)|嗯[，,]我听着呢)/u],
    ['宣告陪伴',/(?:想聊聊的话我在这儿听着|随时找我|我一直都在|我听着呢|我陪着你|我不走)|^我在[。！!～~]*$/u],
    ['解释式道歉',/这次是我.{0,20}了|是我的问题/u],
    ['老式劝阻',/先别/u],
    ['套话或掐断话题',/这个不急|算了不说他了|换谁都|你的感受完全可以理解/u],
    ['收尾叮嘱',/(?:别自己硬扛|照顾好自己|别太累了)[哈啊吧呀嘛～~！!。]*$/u],
    ['设计好的邀约',/(?:下回一起.{0,25}[？?]|你负责.{0,25})$/u],
    ['抓用户词或总结道理',/那换个.{0,12}的|说开了总比.{0,15}强|最难受的就是/u],
    ['系统数据腔',/卡里都记着呢|根据你的记录|数据[显现]示/u],
    ['打太极与口号',/你说了算|.{1,8}的事归我管|好好好不说/u],
  ];
  for(const [label,pattern]of patterns)if(pattern.test(text))issues.push(label);
  if(/(?:难过|伤心|委屈|想哭|失恋|没戏|好累|倾诉)/u.test(context.userText||'')&&/(?:你吃饭没|起来喝口水|早点睡)/u.test(text))issues.push('用吃喝睡安慰');
  if(/大不了[^。！？!?\n]*[^呗哈啊嘛吧呀啦咯喽嘞～~！？!?]$/u.test(text))issues.push('大不了句尾缺语气词');
  if(/(?:你应该|你可以试试)/u.test(text)&&!/[？?]|怎么|如何|要不要|求|建议|办法|计划|教我/u.test(context.userText||''))issues.push('用户未求建议却直接说教');
  return issues;
}
function normalizeSpeech(input:string):{text:string;replacements:number}{
  let text=input,replacements=0;
  const numbers=(value:string)=>JSON.stringify(value.match(/[+\-−＋－]?\s*\d+(?:\.\d+)?/gu)||[]);
  const replace=(pattern:RegExp,replacement:string)=>{const next=text.replace(pattern,replacement);if(next!==text&&numbers(next)===numbers(text)){text=next;replacements++;}};
  for(const [alias,name]of Object.entries(aliasMap))replace(new RegExp(alias,'gu'),name);
  replace(/^(?:那确实|确实)[，,、\s]*/u,'对啊，');
  replace(/^这个我认[，,、\s]*/u,'对啊，');
  replace(/^我知道[，,]\s*/u,'');
  replace(/(?:这次是我[^。！？!?\n]{0,20}了|是我的问题)/gu,'对不起对不起');
  replace(/先别急着/gu,'别急着');
  replace(/这个不急/gu,'这个不用着急啊');
  replace(/好好好不说/gu,'好');
  replace(/(?:别自己硬扛|照顾好自己|别太累了)[哈啊吧呀嘛～~！!。]*$/u,'');
  // Do not fabricate a substitute feeling or change clinical/training claims.
  return {text:text.trim(),replacements};
}
export function normalizeDialogueOutput(raw:unknown,context:DialogueOutputGuardContext={}):DialogueOutputInspection {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {value:raw,issues:['回复不是消息对象'],replacements:0};
  const value=structuredClone(raw) as Record<string,unknown>,issues:string[]=[];let replacements=0;
  const inspectText=(text:string)=>{const result=normalizeSpeech(text);replacements+=result.replacements;if(!result.text)issues.push('替换后消息为空');issues.push(...publicSpeechForbidden(result.text).map(word=>'禁词：'+word),...speechBlacklistIssues(result.text,context));return result.text;};
  if(!Array.isArray(value.messages))return {value,issues:['回复没有消息列表'],replacements};
  value.messages=value.messages.map(part=>{
    if(typeof part==='string')return inspectText(part);
    if(!part||typeof part!=='object'||Array.isArray(part))return part;
    const item={...part} as Record<string,unknown>;
    // Image prompts are private instructions, not a displayed speech bubble.
    for(const key of ['text','caption','title','label'])if(typeof item[key]==='string')item[key]=inspectText(item[key] as string);
    if(Array.isArray(item.options))item.options=item.options.map(option=>typeof option==='string'?inspectText(option):option&&typeof option==='object'?{...option,...(typeof option.label==='string'?{label:inspectText(option.label)}:{})}:option);
    return item;
  });
  const messages=value.messages as unknown[];
  const silent=value.action==='silent'||value.action==='end_conversation'&&messages.length===0;
  if(!silent&&(messages.length<1||messages.length>4))issues.push('每次回复必须1至4条');
  if(/(?:^|[，,。！!？?\s])(?:闭嘴|滚|滚开|别说了|不要说话|别烦我)(?:[，,。！!？?\s]|$)/u.test(context.userText||'')&&messages.length!==1&&!silent)issues.push('被要求停止说话只能一条收口');
  return {value,issues:[...new Set(issues)],replacements};
}
export class DialogueOutputGuardError extends Error {
  readonly code='DIALOGUE_PUBLIC_OUTPUT_REJECTED';
  constructor(readonly issues:string[]){super('回复未通过发送前检查');this.name='DialogueOutputGuardError';}
}
