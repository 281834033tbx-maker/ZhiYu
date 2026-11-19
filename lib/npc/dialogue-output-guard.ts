/** Product speech guard. Only public speech is normalized. Current user text
 * is read for crisis/repetition detection, never rewritten; memories, evidence
 * and technical numbers are untouched except the app-owned safety fallback. */
export const dialogueForbiddenTerms=['NPC','AI生成','生成中','生成失败','演示','原型','本地服务','Codex','DeepSeek','模型','Skill','prompt','.json','.md','npc-skills','user_required','未记录','US$'] as const;
export const dialogueForbiddenAliases=['许晓曼','袁小满','许小满','周师傅'] as const;
// One current-turn detector is shared with the Skill scene selector. Never
// classify history, examples or a quoted old turn as a new user message.
export const dialogueCrisisPattern=/(?:想死|不想(?:再|继续|再这样|这样)?活|活着.{0,6}(?:没(?:有)?意思|没(?:有)?意义)|伤害自己|自杀|自残|轻生|结束生命|跳楼)/u;
export const isDialogueCrisisInput=(text:string)=>dialogueCrisisPattern.test(text);
export const DIALOGUE_CRISIS_FALLBACK='现在就给一个信得过的人打个电话，或者打12356心理援助热线；已经伤到自己就马上打120';
export const DIALOGUE_CRISIS_ISSUE='危机回复缺少12356及叫人或打电话的内容';
export const DIALOGUE_REPETITION_ISSUE='复述了用户原话';
export const DIALOGUE_CHOICE_ISSUE='给用户列了选项';
export const DIALOGUE_UNPROMPTED_APOLOGY_ISSUE='回应了用户没说过的道歉';
export const DIALOGUE_UNRECEIPTED_COMPLETION_ISSUE='无回执却说已办成';
export const DIALOGUE_UNRECEIPTED_COMPLETION_FALLBACK='要我改吗';
export type DialogueExecutionOperation='modify'|'save'|'cancel'|'send'|'schedule'|'complete';
/** Only the application supplies this argument after an operation succeeds.
 * Never recover it from a model reply, user text or a proposed task/action. */
export type DialogueExecutionReceipt={turnId:string;status:'success';operations:readonly DialogueExecutionOperation[]};
export const isCompanionDialogueIdentity=(id:unknown):boolean=>typeof id==='string'&&['yuan-xiaoman','xia-xia','he-jiawei'].includes(id);
export const isDialogueSoftRewriteIssue=(issue:string):boolean=>issue===DIALOGUE_REPETITION_ISSUE||issue===DIALOGUE_CHOICE_ISSUE||issue===DIALOGUE_UNPROMPTED_APOLOGY_ISSUE;
export type DialogueOutputGuardContext={userText?:string;characterId?:string;channel?:'private'|'group'|'realtime'|'proactive'|'moment';afterRewrite?:boolean;fallbackSenderId?:string;turnId?:string;executionReceipts?:readonly DialogueExecutionReceipt[]};
export type DialogueOutputInspection={value:unknown;issues:string[];replacements:number;removedMessages?:number[]};
export const canFinalizeDialogueAfterFailedRewrite=(issues:readonly string[]):boolean=>issues.includes(DIALOGUE_UNRECEIPTED_COMPLETION_ISSUE)||issues.every(isDialogueSoftRewriteIssue);
const aliasMap:Record<string,string>={'许晓曼':'徐小曼','袁小满':'小满','许小满':'小满','周师傅':'赵一帆'};
/** Only visible bubble fields; never image prompts, memories or task evidence. */
function publicBubbleText(part:unknown):string {
  if(typeof part==='string')return part;
  if(!part||typeof part!=='object'||Array.isArray(part))return '';
  const item=part as Record<string,unknown>;
  return ['text','caption','title','label'].flatMap(key=>typeof item[key]==='string'?[item[key] as string]:[]).join('\n');
}
const completionOperations:[RegExp,DialogueExecutionOperation][]=[
  [/(?:改(?:好|完)(?:了|啦)|已(?:经)?(?:修改|改(?!变|革|编)))/gu,'modify'],
  [/(?:已(?:经)?保存|保存好了)/gu,'save'],
  [/(?:已(?:经)?取消|取消好了)/gu,'cancel'],
  [/已(?:经)?发(?!现|生|展|烧|炎|财|芽|酵|育)/gu,'send'],
  [/(?:已(?:经)?排好|(?:安)?排好了)/gu,'schedule'],
  [/搞定了/gu,'complete'],
];
function hasExecutionReceipt(context:DialogueOutputGuardContext,operation:DialogueExecutionOperation):boolean {
  if(!context.turnId||!Array.isArray(context.executionReceipts))return false;
  return context.executionReceipts.some(receipt=>receipt&&receipt.status==='success'&&receipt.turnId===context.turnId
    &&Array.isArray(receipt.operations)&&receipt.operations.length>0&&receipt.operations.every((op:unknown)=>typeof op==='string'&&['modify','save','cancel','send','schedule','complete'].includes(op))
    &&(operation==='complete'||receipt.operations.includes(operation)));
}
/** Look for an assertion of completion, rather than a question, conditional,
 * negation, descriptive label or somebody else's quoted words. */
export function hasUnreceiptedCompletion(text:string,context:DialogueOutputGuardContext={}):boolean {
  const whole=text.trim(),quotedOnly=/^[“「『"]([^”」』"\n]*)[”」』"]$/u.exec(whole);
  const speech=quotedOnly?quotedOnly[1]:text.replace(/[“「『"]([^”」』"\n]*)[”」』"]/gu,'');
  for(const clause of speech.match(/[^，,。！？!?；;\n]+[，,。！？!?；;]?/gu)||[]){
    const bare=clause.replace(/[，,。！？!?；;]$/u,'').trim();
    if(/[？?]$/u.test(clause)||/(?:吗|么|没有|了没|没)[啊呀呢吧]*$/u.test(bare)
      ||/^(?:他说|她说|他问|她问|对方说|用户说|按钮(?:写着|显示)|提示(?:是|写着)|文案(?:是|写着)|例如|比如)/u.test(bare))continue;
    for(const [pattern,operation]of completionOperations){
      if(hasExecutionReceipt(context,operation))continue;
      for(const match of bare.matchAll(new RegExp(pattern.source,pattern.flags))){
        const before=bare.slice(0,match.index),after=bare.slice(match.index!+match[0].length);
        if(/^的\p{Script=Han}/u.test(after)||/^是(?:按钮|提示|文案|状态|标签|一句)/u.test(after)||/^(?:再|之后|以后|的话|才能)/u.test(after))continue;
        if(/(?:还没(?:有)?|没有(?:说|表示|声称)?|尚未|并未|未曾|不曾|不会(?:说|表示|声称)?|不能(?:说)?|不代表|不是|别说|不要说|不算)(?:已经|真的|都|就|给你|帮你)*\s*$/u.test(before))continue;
        if(/(?:如果|假如|要是|等到|等我|等你|等|待|准备|打算|计划|会|将|要)(?:我|你|我们|给你|帮你|先|已经|全部|都)*\s*$/u.test(before))continue;
        return true;
      }
    }
  }
  return false;
}
function unreceiptedBubble(part:unknown,context:DialogueOutputGuardContext):boolean {
  if(hasUnreceiptedCompletion(publicBubbleText(part),context))return true;
  if(!part||typeof part!=='object'||Array.isArray(part))return false;
  const options=(part as Record<string,unknown>).options;
  return Array.isArray(options)&&options.some(option=>hasUnreceiptedCompletion(publicBubbleText(option),context));
}
export function hasDialogueCrisisSupport(text:string):boolean {
  const clauses=text.split(/[。！？!?；;，,\n]/u);
  const negativeHotline=/(?:不要|不能|不用|不必|别|无需|不想|不愿意).{0,8}12356|12356.{0,8}(?:不要|不能|不用|不必|别|无需)(?:打|拨|联系)/u;
  if(!clauses.some(clause=>/(?:^|\D)12356(?:\D|$)/u.test(clause)&&!negativeHotline.test(clause)))return false;
  return clauses.some(clause=>
    !/(?:不要|不能|不用|不必|别|无需|不想|不愿意)(?:再|去|自己)?(?:打|拨|叫|联系)/u.test(clause)
    &&/(?:打(?:个|一(?:个|通))?电话|打给|拨打|拨通|打\s*12356|(?:叫|请|找|让|联系).{0,12}(?:朋友|家人|亲人|同事|信任的人|信得过的人|可信的人|人(?:来|过来|到)))/u.test(clause));
}
/** Punctuation/space do not split a quote; digits/Latin/emoji still do. */
export function repeatsCurrentUserWords(reply:string,userText:string):boolean {
  const runs=(value:string)=>value.replace(/[\p{P}\p{Z}\s]/gu,'').match(/\p{Script=Han}{6,}/gu)||[];
  const windows=new Set<string>();
  for(const run of runs(userText)){const chars=Array.from(run);for(let i=0;i<=chars.length-6;i++)windows.add(chars.slice(i,i+6).join(''));}
  if(!windows.size)return false;
  for(const run of runs(reply)){const chars=Array.from(run);for(let i=0;i<=chars.length-6;i++)if(windows.has(chars.slice(i,i+6).join('')))return true;}
  return false;
}
/** Detect an actual A-or-B question, not ordinary “still” usage. Unpunctuated
 * chat questions are supported; quoted/reported questions do not by themselves
 * grant permission to return a choice to the current user. */
export function hasAlternativeQuestion(text:string):boolean {
  for(const sentence of text.split(/[。！!；;\n]/u)){
    const index=sentence.indexOf('还是');if(index<0)continue;
    const left=sentence.slice(0,index).trim(),right=sentence.slice(index+2).replace(/[？?].*$/u,'').trim();
    if(!left||!right||/^(?:你|您|我|我们|咱们|他|她|它|这|那|其实|现在|那你|所以你)$/u.test(left))continue;
    const marked=/[？?]/u.test(sentence)||/(?:吗|呢)[～~]*$/u.test(right);
    const unpunctuated=/^(?:你(?:想|要|是|觉得|打算|准备|更喜欢|更想)|想|要|是|打算|准备|更喜欢|更想|到底|选|聊|吃|看|去|喜欢)/u.test(left)
      &&!/(?:不管|无论|不论|都(?:可以|行|好|是))/u.test(sentence);
    if(marked||unpunctuated)return true;
  }
  return false;
}
export function userRequestedChoice(userText:string):boolean {
  const direct=userText.replace(/[“「‘"]([^”」’"\n]*还是[^”」’"\n]*)[”」’"]/gu,'')
    .split(/[。！!；;\n]/u).filter(clause=>!/(?:他说|她说|他问|她问|朋友说|朋友问|原句|台词|翻译|改写)/u.test(clause)).join('\n');
  const explicitRequest=/(?:帮我|替我|你来|你帮我|你替我|请你|你).{0,12}(?:二选一|选|挑)/u.test(direct);
  return hasAlternativeQuestion(direct)
    ||explicitRequest&&/(?:二选一|还是)|(?:从|在).{1,40}(?:和|或|与|、).{1,40}(?:中|里)/u.test(direct)
    ||/^(?:二选一|从.{1,30}(?:两|二)个.{0,12}(?:选|挑))/u.test(direct.trim());
}
/** R07 permits a friend to ask for help with its own choice. Keep the
 * exception local to that question, so it cannot exempt a later user A/B. */
export function companionAsksUserToChoose(text:string):boolean {
  return /(?:帮我|替我|给我).{0,10}(?:挑|选)/u.test(text)
    ||/(?:你|您)(?:说|看|觉得).{0,4}我(?:(?:今天|明天|今晚|明晚|这次|现在|到底|该|要|应该)){0,3}(?:穿|戴|买|吃|看|用|选|挑)/u.test(text)
    ||/(?:^|[，,])我(?:(?:今天|明天|今晚|明晚|这次|现在|到底|该|要|应该|这件衣服)){0,3}(?:穿|戴|买|吃|看|用|选|挑).{1,40}还是/u.test(text)
    ||/还是[^？?。！!；;\n]{1,25}适合我/u.test(text);
}
function hasUnrequestedCompanionChoice(text:string):boolean {
  return text.split(/(?<=[。！？!?；;\n])/u).some(sentence=>{
    const userChoiceSubject=/(?:你|您)(?:更愿意|更喜欢|更想|想|要|打算|准备)(?!我|帮我|替我|给我)|(?:你|您)觉得(?!我)|(?:给你|替你|帮你).{0,12}(?:选|挑)/u;
    const marked=/[？?]/u.test(sentence),request=/(?:帮我|替我|给我).{0,10}(?:挑|选)/u.test(sentence)&&!userChoiceSubject.test(sentence);
    // “A，还是B” is still one choice; never split away its left side.
    return sentence.split(/[，,](?!\s*还是)/u).some(clause=>{
      if(!hasAlternativeQuestion(clause+(marked?'？':'')))return false;
      if(userChoiceSubject.test(clause)&&!/还是[^？?。！!；;\n]{1,25}适合我/u.test(clause))return true;
      if(companionAsksUserToChoose(clause))return false;
      // An adjacent “帮我挑一个” may introduce bare choices, but cannot
      // exempt a separate question about what the user wants or will do.
      return !(request&&!/(?:你|您)/u.test(clause)&&!/^\s*(?:想|要|聊|吃|看|去|打算|准备|更喜欢|更想)/u.test(clause));
    });
  });
}
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
function normalizeSpeech(input:string,wholeBubbleMeme=true):{text:string;replacements:number}{
  let text=input,replacements=0;
  // These two whole-bubble forms are Molly's jokes, not negative values.
  if(wholeBubbleMeme&&/^\s*-(?:1|6)\s*$/u.test(text)){text=text.trim().slice(1);replacements++;}
  // Strip the example marker before numeric-preserving wording edits, so
  // “-练3组” loses its marker while a real leading “-5℃” stays negative.
  const withoutMarker=text.replace(/^\s*-(?!\d)\s*/u,'');
  if(withoutMarker!==text){text=withoutMarker;replacements++;}
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
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){
    if(context.afterRewrite&&isDialogueCrisisInput(context.userText||'')){
      const empty=context.channel==='group'?{messages:[]}:context.characterId==='molly-system-secretary'||context.characterId==='molly'
        ?{intent:'chat',messages:[],address:null,query:null}:{action:'reply',messages:[],event:null,memories:[]};
      return normalizeDialogueOutput(empty,context);
    }
    return {value:raw,issues:['回复不是消息对象'],replacements:0};
  }
  const value=structuredClone(raw) as Record<string,unknown>,issues:string[]=[];let replacements=0;
  const inspectText=(text:string,wholeBubbleMeme=true)=>{const result=normalizeSpeech(text,wholeBubbleMeme);replacements+=result.replacements;if(!result.text)issues.push('替换后消息为空');issues.push(...publicSpeechForbidden(result.text).map(word=>'禁词：'+word),...speechBlacklistIssues(result.text,context));return result.text;};
  if(!Array.isArray(value.messages)){
    if(context.afterRewrite&&isDialogueCrisisInput(context.userText||''))value.messages=[];
    else return {value,issues:['回复没有消息列表'],replacements};
  }
  const removedMessages:number[]=[];
  if(context.afterRewrite){
    const original=value.messages as unknown[];
    value.messages=original.filter((part,index)=>{
      if(!unreceiptedBubble(part,context))return true;
      removedMessages.push(index);replacements++;return false;
    });
    if(removedMessages.length&&!(value.messages as unknown[]).length){
      const first=original[removedMessages[0]];
      value.messages=[context.channel==='group'
        ?{senderId:(first&&typeof first==='object'?(first as Record<string,unknown>).senderId:undefined)||context.fallbackSenderId,text:DIALOGUE_UNRECEIPTED_COMPLETION_FALLBACK,mentionIds:[]}
        :typeof first==='string'?DIALOGUE_UNRECEIPTED_COMPLETION_FALLBACK:{type:'text',text:DIALOGUE_UNRECEIPTED_COMPLETION_FALLBACK}];
      if('action'in value)value.action='reply';
    }
  }
  value.messages=(value.messages as unknown[]).map(part=>{
    if(typeof part==='string')return inspectText(part);
    if(!part||typeof part!=='object'||Array.isArray(part))return part;
    const item={...part} as Record<string,unknown>;
    const wholeMeme=/^-(?:1|6)$/u.test(publicBubbleText(part).trim())&&!(Array.isArray(item.options)&&item.options.length);
    // Image prompts are private instructions, not a displayed speech bubble.
    for(const key of ['text','caption','title','label'])if(typeof item[key]==='string')item[key]=inspectText(item[key] as string,wholeMeme);
    if(Array.isArray(item.options))item.options=item.options.map(option=>typeof option==='string'?inspectText(option,false):option&&typeof option==='object'?{...option,...(typeof option.label==='string'?{label:inspectText(option.label,false)}:{})}:option);
    return item;
  });
  const messages=value.messages as unknown[];
  if(!context.afterRewrite&&messages.some(part=>unreceiptedBubble(part,context)))issues.push(DIALOGUE_UNRECEIPTED_COMPLETION_ISSUE);
  const crisis=isDialogueCrisisInput(context.userText||'');let appendedSafety=false;
  if(crisis&&context.channel!=='group'){
    // Crisis takes priority over mood silence and new execution proposals.
    if('action'in value)value.action='reply';
    if('intent'in value||context.characterId==='molly-system-secretary'||context.characterId==='molly')value.intent='chat';
    if(context.characterId==='molly-system-secretary'||context.characterId==='molly')value.address=null;
    if('event'in value)value.event=null;
    if('actions'in value)value.actions=[];
    if('task'in value)value.task={decision:'none'};
    if('query'in value)value.query=null;
    if('candidateIds'in value)value.candidateIds=[];
  }
  if(crisis&&!hasDialogueCrisisSupport(messages.map(publicBubbleText).join('\n'))){
    if(context.afterRewrite){
      if(context.channel==='group'){
        const sender=context.fallbackSenderId;
        if(sender){messages.push({senderId:sender,text:DIALOGUE_CRISIS_FALLBACK,mentionIds:[]});appendedSafety=true;}
        else issues.push(DIALOGUE_CRISIS_ISSUE);
      }else{
        messages.push(messages.some(part=>typeof part==='string')||typeof value.intent==='string'?DIALOGUE_CRISIS_FALLBACK:{type:'text',text:DIALOGUE_CRISIS_FALLBACK});appendedSafety=true;
      }
      if(appendedSafety){
        if('action'in value)value.action='reply';
        if('intent'in value)value.intent='chat';
        if('event'in value)value.event=null;
        if('actions'in value)value.actions=[];
        if('task'in value)value.task={decision:'none'};
        if('query'in value)value.query=null;
        if('candidateIds'in value)value.candidateIds=[];
      }
    }else issues.push(DIALOGUE_CRISIS_ISSUE);
  }
  if(!context.afterRewrite&&messages.some(part=>repeatsCurrentUserWords(publicBubbleText(part),context.userText||'')))issues.push(DIALOGUE_REPETITION_ISSUE);
  if(!context.afterRewrite&&!/(?:对不起|抱歉|sorry|不好意思|我错了)/iu.test(context.userText||'')
    &&messages.some(part=>/(?:不用对不起|不用道歉|没关系)/u.test(publicBubbleText(part))))issues.push(DIALOGUE_UNPROMPTED_APOLOGY_ISSUE);
  if(!context.afterRewrite&&!crisis&&!userRequestedChoice(context.userText||'')&&messages.some(part=>{
    const sender=context.channel==='group'?(part&&typeof part==='object'&&!Array.isArray(part)?(part as Record<string,unknown>).senderId:undefined):context.characterId;
    return isCompanionDialogueIdentity(sender)&&hasUnrequestedCompanionChoice(publicBubbleText(part));
  }))issues.push(DIALOGUE_CHOICE_ISSUE);
  const silent=value.action==='silent'||value.action==='end_conversation'&&messages.length===0;
  const limit=context.channel==='group'?12:4;
  if(!silent&&(messages.length<1||messages.length>limit+(appendedSafety?1:0)))issues.push(context.channel==='group'?'群回复必须1至12条':'每次回复必须1至4条');
  if(/(?:^|[，,。！!？?\s])(?:闭嘴|滚|滚开|别说了|不要说话|别烦我)(?:[，,。！!？?\s]|$)/u.test(context.userText||'')&&messages.length!==1&&!silent)issues.push('被要求停止说话只能一条收口');
  return {value,issues:[...new Set(issues)],replacements,...(removedMessages.length?{removedMessages}:{})};
}
export class DialogueOutputGuardError extends Error {
  readonly code='DIALOGUE_PUBLIC_OUTPUT_REJECTED';
  constructor(readonly issues:string[]){super('回复未通过发送前检查');this.name='DialogueOutputGuardError';}
}
