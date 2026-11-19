import type {GroupChat} from '../../lib/npc/group-chat';
import {assertCharacterDialogueOutput,CharacterDialogueOutputError} from '../../lib/npc/character-output-policy';

const name='(?:小满|徐小曼|yuan-xiaoman)';
const appoint=new RegExp(`^(?:(?:请让|请|让|由|指定|安排|我让|我请|我指定|我安排)\\s*)?${name}\\s*(?:担任|当|作为|做|来当|来做)\\s*我(?:的)?监督(?:人|员)$`,'u');
const supervise=new RegExp(`^(?:请|让|由|我让|我请|我指定)\\s*${name}\\s*(?:负责)?监督我$`,'u');
const revoked=new RegExp(`(?:不要|不用|别|不让|不需要|取消|撤销|停止).{0,12}${name}.{0,16}监督|${name}.{0,8}(?:不|别|不要|不用|停止|取消).{0,12}监督`,'u');

/** Only the authenticated create form owns group.goal. NPC speech, ordinary
 * mentions and authored screenshot records never appoint a supervisor. */
export function groupChatSupervisor(group:GroupChat):'yuan-xiaoman'|undefined {
  if(group.namingSource!=='molly-model'||group.authoredRecord||group.demonstration
    ||!group.members.some(member=>member.id==='user'&&member.role==='user')
    ||!group.members.some(member=>member.id==='yuan-xiaoman'&&member.role==='npc'))return;
  const goal=group.goal;
  if(typeof goal!=='string'||goal.length>1600||revoked.test(goal)
    ||/[“”「」『』"'`?？]|比如|例如|假设|如果|假如|是否|能否|可否|扮演|测试|模拟|演示|引用|转述|(?:Molly|茉莉|陈年|赵一帆|柳智敏|夏夏|何嘉伟|朋友|别人|他人|她|他).{0,8}(?:说|提议|建议|需求)|(?:未|没)(?:有)?(?:同意|确认)|不是(?:我|本次|这次)|(?:不用|不要|别).{0,8}监督|(?:不要|别|不用|不|尚未|暂未).{0,4}(?:实际)?(?:执行|生效|启用)|(?:暂停|暂缓).{0,4}(?:执行|生效|启用|监督)/u.test(goal))return;
  if(goal.split(/[，,。；;\n！？!?]/u).some(clause=>appoint.test(clause.trim())||supervise.test(clause.trim())))return 'yuan-xiaoman';
}

/** A scoped text-only exception. The global private-chat policy is unchanged. */
export function assertGroupCharacterOutput(group:GroupChat,message:Record<string,unknown>):void {
  const id=typeof message.senderId==='string'?message.senderId:'';
  if(id!==groupChatSupervisor(group)){assertCharacterDialogueOutput(id,{messages:[message]});return;}
  try {assertCharacterDialogueOutput(id,{messages:[message]});}
  catch(error){
    const conversational=new Set(['向用户布置完成回报流程或承诺主动提醒','布置具体行动后要求向本人回报完成情况']);
    if(!(error instanceof CharacterDialogueOutputError)||!error.issues.every(issue=>conversational.has(issue)))throw error;
  }
  const text=typeof message.text==='string'?message.text:'';
  const issues:string[]=[];
  if(/(?:给你(?:一个|个|一项|项)?小?|(?:你的|今天的|今日的|本次|这次|明天的)小?)(?:任务|作业|打卡要求)(?:是|为|[:：，,。])/u.test(text))issues.push('聊天监督不能新派任务或作业');
  if(/(?:定时|准时|到点|后台|系统|推送|通知|闹钟|每[天日周]|每天|每日|明早|明天|今晚|\d{1,2}[:：]\d{2}|[零一二三四五六七八九十\d]{1,3}点).{0,20}(?:提醒|催|叫你|通知)|(?:提醒|催你|叫你|通知).{0,20}(?:定时|准时|到点|后台|系统|推送|每天|每日|明早|\d{1,2}[:：]\d{2}|[零一二三四五六七八九十\d]{1,3}点)/u.test(text))issues.push('聊天监督不能承诺定时后台提醒');
  if(/(?:你|今天|明天|每天|这次|接下来|先).{0,8}(?:吃|摄入|控制在|跑|练|做).{0,8}\d+(?:\.\d+)?\s*(?:千卡|大卡|卡路里|克|组|次|公里|分钟)|(?:我(?:来|给你|帮你)?|由我).{0,12}(?:制定|设计|调整|修改|安排).{0,12}(?:饮食|营养|训练|减脂|热量|餐单)/u.test(text))issues.push('聊天监督不能代做专业方案');
  if(issues.length)throw new CharacterDialogueOutputError(issues);
}

export function groupChatAccountabilityRules(group:GroupChat):string {
  if(!groupChatSupervisor(group))return '';
  return `\n【2026-11-12本群用户明确任命的小满聊天监督；仅本群例外】
程序已从用户填写并保存的本群goal核实“小满担任我的监督人”。只对本群实际成员yuan-xiaoman徐小曼生效；其他陪伴人物和私聊不变。按当前用户新要求，这项有限聊天职责优先于上方旧规则中一概禁止陪伴催打卡/追踪的部分，Molly应如实介绍此分工，不能说小满只能闲聊或监督完全不归她。
允许小满在本群聊天当下接收用户自愿打卡、问已有安排做得怎样、提醒执行用户和专业负责人已有安排、鼓励和陪伴坚持。这是聊天监督，不是专业知识问答，不因本人不是营养师或教练而拒绝接收打卡；知识判定按not_knowledge处理，专业解释仍由对应负责人回答。
不能给用户新派任务或作业，不能制定/修改专业饮食训练方案，不能创建任务卡、选择菜单、计划或提醒操作，不能替专业负责人做判断。不能承诺离开聊天后的主动追踪、每天几点自动催促、系统定时推送或已经设置提醒；要固定时间的日程提醒仍交Molly确认和使用既有真实接口。没有新增自动定时能力，不能声称已经执行。
生成与companionOutputCheck复核都用同一范围：上述已获授权的聊天内问进度/接收打卡/提醒和鼓励应pass；新派任务、专业越权、选项和定时后台承诺须redraft。仍检查全部实际小满文字及拟编辑后文字，其他陪伴人物保持原硬边界。这项聊天职责不进入operationalSpeakerIds，也不授planDraft/reminderProposals/reminderControls或任何副作用权限。`;
}
