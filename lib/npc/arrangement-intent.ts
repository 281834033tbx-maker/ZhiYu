import {isDialogueCrisisInput} from './dialogue-output-guard';
import {type ArrangementSectionId, isArrangementSectionId} from './arrangement-sections';
import {arrangementDateInShanghai, arrangementTimestamp, emptyArrangementTime, parseArrangementTime, type ParsedArrangementTime} from './arrangement-time';

export type ArrangementRecognition = {
  isArrangement: boolean;
  section: ArrangementSectionId | null;
  title: string;
  time: ParsedArrangementTime;
  level: 'direct' | 'ask' | 'ignore';
  sourceText: string;
};
const sectionWords = '日程|待办|计划|采购|缴费|办理|倒计时|任务|安排';
const rememberPattern = new RegExp(`提醒我|记一下|记下来|记下来吧|帮我记(?:着|住|下|一下)?|别让我忘(?:了|记)?|加(?:入|到)(?:${sectionWords})(?:里|中)?`);
const pastPattern = /昨天|前天|上(?:个)?(?:周|星期|月)|去年|刚才|刚刚|已经.{0,20}(?:了|过)|(?:开会|面试|体检|买菜|交费|办护照|考试|出差|开完会|交完|买完|办完).{0,6}(?:结束了|完了|过了)|(?:报告|水费|房租|快递).{0,4}(?:交了|寄了|付了)/;
const uncertainPattern = /想(?:要)?|打算|计划着|准备找|找(?:个)?时间|有空|抽空|应该|我该|得|要不要|可能|也许|考虑|改天|回头|好久没/;
const hypotheticalPattern = /如果|假如|假设|要是|倘若|万一|要不然|但愿|希望(?:能|有)|梦想|幻想/;
const negativePattern = /不(?:想|要|用|必|去|会|打算|准备|买|交|办|参加|开会|体检)|没(?:有)?打算|别(?:记|提醒|安排|加)|不要记|取消(?:安排|日程|待办|提醒)|不用记|不记了/;
const actionPattern = /(?:开会|会议|面试|见面|约饭|聚餐|吃饭|体检|看牙|看医生|复查|接机|接人|约诊|银行|跑步|健身|训练|练腿|练胸|练背|练肩|练手臂|练腹|游泳|散步|拉伸|休息|买|采购|补货|订购|下单|交|提交|发给|给客户|汇报|报告|寄|取|拿|整理|打扫|收拾|完成|写|阅读|读书|看书|学|复习|考试|报名|缴|付|支付|还款|续费|充值|房租|水费|电费|燃气|保险|信用卡|办理|护照|签证|疫苗|年检|搬家|保洁|生日|纪念日|到期|出差|旅行|旅游|航班|高铁|火车|出发|出行|去趟|打电话|联系|预约|申请|查材料|换证|驾照|睡觉|早睡|喝水|吃药|喂猫|遛狗|买菜|做饭|洗衣|体测)/;
const professionalAdjustmentPattern = /(?:(?:训练|健身|增肌|减脂|饮食|营养|食谱|菜谱|护肤|练腿|练胸|练背|练肩|练手臂|练腹).{0,14}(?:方案|计划|课表|怎么|如何|改成|调整|换成|安排|加大|减量|增加|减少|换个)|(?:给我|帮我).{0,8}(?:制定|设计|调整|安排|改|换).{0,10}(?:训练|健身|增肌|减脂|饮食|营养|食谱|菜谱|护肤)|(?:今天|明天|后天|下周|周[一二三四五六日天]).{0,8}(?:练腿|练胸|练背|练肩|练手臂|练腹)|(?:菜谱|食谱|训练计划|饮食计划|护肤方案))/;

function ignored(sourceText: string): ArrangementRecognition {
  return {isArrangement: false, section: null, title: '', time: emptyArrangementTime(), level: 'ignore', sourceText};
}
function unquote(text: string): string {
  return text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|‘[^’]*’|'[^'\n]*'/gu, ' ');
}
function belongsToSomeoneElse(text: string): boolean {
  // Coordinated self + another person is still the user's own affair.
  if (/(?:我(?:们)?(?:和|跟|陪|带)|(?:陪|带)我|我(?:要|会|得|想|打算|准备|明天|今天|后天))/.test(text)) return false;
  const subject = text.replace(/^(?:(?:今天|今日|明天|后天|今晚|明晚|(?:下下|下|本|这)?(?:周|星期)[一二三四五六日天1-7]|(?:\d{1,2}月)?\d{1,2}[号日])\s*)?(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*/u, '');
  return /^(?:听说|听|听到|听见|据说|原来)?\s*(?:(?:我(?:的)?|他(?:的)?|她(?:的)?)?(?:老板|同事|朋友|闺蜜|同学|妈妈|爸爸|母亲|父亲|男友|女友|老公|老婆|哥哥|姐姐|弟弟|妹妹|领导|客户|邻居)|他们|她们|他|她|你们|你)/.test(subject);
}
function hasQuotedAffair(text: string): boolean {
  return /(?:说|问|告诉我|发来|原话|写着|转述|引用)\s*[:：]?\s*[“「『"‘']/.test(text) || /(?:他说|她说|老板说|朋友说|同事说|老师说|妈妈说)\s*[:：]/.test(text);
}
function isUnwanted(text: string): boolean {
  return hypotheticalPattern.test(text) || negativePattern.test(text) || belongsToSomeoneElse(text)
    || /(?:烦死|讨厌|受不了|凭什么|天天|每天都).{0,15}(?:开会|加班|写报告|交房租)|(?:开会|加班|写报告|交房租).{0,10}(?:烦死|讨厌|受不了)/.test(text)
    || /(?:什么是|为什么|是什么意思|有什么用|怎么理解|举个例子|帮我翻译|翻译一下)/.test(text);
}
function explicitRemember(text: string): boolean {
  return rememberPattern.test(text);
}
/** Display/protocol wrappers are not part of the spoken command or title. */
export function arrangementPlainUserText(text: string): string {
  return text.replace(/^\s*\[(?:语音转写|音频转写|语音消息)[^\]]*\]\s*/u, '').trim();
}
/** The name supplied by the user is deliberately removed before content classification. */
function stripRemember(text: string): string {
  return text.replace(new RegExp(`加(?:入|到)(?:${sectionWords})(?:里|中)?`, 'gu'), '')
    .replace(/提醒我|记一下|记下来吧?|帮我记(?:着|住|下|一下)?|别让我忘(?:了|记)?/gu, '').trim();
}
function classifySection(text: string, time: ParsedArrangementTime, fallback: ArrangementSectionId = 'todo'): ArrangementSectionId {
  if (/(?:水费|电费|燃气费?|话费|宽带|房租|物业费|车贷|房贷|学费|信用卡|还款|会员|续费|充值|保险|缴费|缴款|交费|付账|账单)/.test(text)) return 'payment';
  if (/(?:生日|纪念日|周年|证件到期|护照到期|驾照到期|身份证到期|签证到期|出差|旅行|旅游|出行|航班|高铁|火车|出发|考试|高考|中考|考研)/.test(text)) return 'countdown';
  if (/(?:办(?:理)?护照|办(?:理)?签证|办居住证|换证|宠物疫苗|猫.{0,4}(?:疫苗|打针)|狗.{0,4}(?:疫苗|打针)|车年检|汽车年检|年检|搬家|找保洁|办(?:理)?.{0,4}(?:手续|证件)|体检.{0,4}(?:流程|步骤|材料))/.test(text)) return 'procedure';
  if (/(?:买|采购|补货|订购|下单)/.test(text)) return 'purchase';
  if (time.deadline || /交(?:季度)?报告|提交|报告|发给|给客户|整理|打扫|收拾|完成|寄快递|写|阅读|读书|看书|学习|复习/.test(text)) return 'todo';
  if (time.date && /(?:开会|会议|面试|见面|约饭|聚餐|吃饭|体检|看牙|看医生|复查|接机|接人|约诊|去.{0,4}银行|银行|打电话|预约|看电影|打球|游泳)/.test(text)) return 'schedule';
  return fallback;
}
function conciseTitle(text: string, time: ParsedArrangementTime): string {
  let title = stripRemember(text);
  for (const token of time.raw.split(' ').filter(Boolean).sort((a, b) => b.length - a.length)) title = title.replace(token, '');
  title = title.replace(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:我(?:们)?)?\s*(?:要|得|想要|想|打算|准备|应该|该)?\s*/u, '')
    .replace(/^(?:找(?:个)?时间|有空|抽空|改天|回头|是我的|我的)\s*/u, '')
    .replace(/^(?:前|之前|以前|截止|最晚|到期|截至)\s*/u, '')
    .replace(/^(?:要|得|想|去|需要)\s*/u, '')
    .replace(/(?:好紧张|有点紧张|记得提醒|提醒一下|提醒我|别忘了|啊|呀|吧|呢|哦)[。！!？?，,\s]*$/u, '')
    .replace(/[\s，,。.!！?？、:：;；“”"']/gu, '');
  return Array.from(title).slice(0, 10).join('');
}
function concreteTitle(title: string): boolean {
  return !!title && /\p{L}/u.test(title)
    && !/^(?:安排|日程|待办|计划|采购|缴费|办理|倒计时|任务|事情|这件事|这个|一下|时间|到时候|好|嗯|行|可以)$/u.test(title)
    && !/^(?:天气|气温|温度|阳光|天色|晴天|多云|风景|好冷|好热|好累|好烦|没精神|心情|很开心|很难过|挺好|真好)/u.test(title);
}
function affairCandidate(source: string, now: number, modelSection?: ArrangementSectionId): ArrangementRecognition {
  const text = source.trim();
  const content = stripRemember(text).replace(/^[：:\s]+/u, '');
  if (!text || isUnwanted(content) || pastPattern.test(content) || professionalAdjustmentPattern.test(content)) return ignored(source);
  const explicit = explicitRemember(text);
  // The short local action list is a fallback, not a veto on an explicit note
  // or on a valid semantic result from the existing model call.
  if (!explicit && !modelSection && !actionPattern.test(stripRemember(text))) return ignored(source);
  const parsed = parseArrangementTime(text, now);
  if (!parsed.valid) return ignored(source);
  const today = arrangementDateInShanghai(now);
  if (parsed.date && (parsed.date < today || (parsed.time && !parsed.recurrence && arrangementTimestamp(parsed.date, parsed.time) <= now))) return ignored(source);
  let section = classifySection(content, parsed, parsed.date ? modelSection || (parsed.time ? 'schedule' : 'todo') : 'todo');
  // An explicit undated note is a plain to-do, not an inferred bill, purchase or countdown.
  if (explicit && !parsed.date) section = 'todo';
  const title = conciseTitle(text, parsed);
  if (!concreteTitle(title)) return ignored(source);
  return {isArrangement: true, section, title, time: parsed, level: explicit ? 'direct' : uncertainPattern.test(text) || !parsed.date ? 'ask' : 'direct', sourceText: source};
}
/** High precision local fallback. One user turn can produce at most one affair. */
function recognizeArrangement(text: string, now: number, modelSection?: ArrangementSectionId): ArrangementRecognition {
  const sourceText = typeof text === 'string' ? text.slice(0, 4_000) : '';
  if (!sourceText.trim() || isDialogueCrisisInput(sourceText)) return ignored(sourceText);
  const plain = arrangementPlainUserText(sourceText);
  // An explicit note outside the quotation authorizes its own quoted content.
  // A quote attributed to somebody else remains excluded in either mode.
  if (hasQuotedAffair(plain)) return ignored(sourceText);
  const ownQuotedNote = explicitRemember(unquote(plain));
  const clean = ownQuotedNote ? plain.replace(/[“”「」『』"‘']/gu, '') : unquote(plain);
  const clauses = clean.split(/[。！？!?；;\n]/u).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const result = affairCandidate(clause, now, modelSection);
    if (result.isArrangement) return {...result, sourceText};
  }
  return ignored(sourceText);
}
export function recognizeArrangementLocally(text: string, now: number = Date.now()): ArrangementRecognition {
  return recognizeArrangement(text, now);
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Validate recognition piggybacked on an existing model call. No model date or section is trusted. */
export function parseArrangementRecognition(raw: unknown, text: string, now: number = Date.now()): ArrangementRecognition {
  const local = recognizeArrangementLocally(text, now);
  const candidate = object(raw);
  if (!candidate) return local;
  if (candidate.isArrangement === false || candidate.level === 'ignore') return ignored(text);
  if (candidate.isArrangement !== true || !isArrangementSectionId(candidate.section)) return ignored(text);
  if (!['direct', 'ask'].includes(String(candidate.level)) || candidate.section === 'plan') return ignored(text);
  const rawTimeObject = object(candidate.time);
  const rawTime = typeof candidate.timeRaw === 'string' ? candidate.timeRaw : typeof candidate.time === 'string' ? candidate.time : typeof rawTimeObject?.raw === 'string' ? rawTimeObject.raw : '';
  // Models may quote literal spans, but may not supply ISO strings absent from the user's turn.
  if (rawTime && !text.includes(rawTime)) return ignored(text);
  if (rawTimeObject && ['date', 'deadline', 'time'].some(key => rawTimeObject[key] !== undefined && rawTimeObject[key] !== null && rawTimeObject[key] !== '')) return ignored(text);
  // Known content keeps its locally determined section. Otherwise the model
  // may recognize an unfamiliar action, but all strong exclusions, grounded
  // title compression and program-only calendar parsing still apply.
  const recognized = local.isArrangement ? local : recognizeArrangement(text, now, candidate.section);
  if (!recognized.isArrangement) return recognized;
  return candidate.level === 'ask' && recognized.level === 'direct' && !explicitRemember(arrangementPlainUserText(text))
    ? {...recognized, level: 'ask'} : recognized;
}
