import {publicGroupDirectory} from './character-directory';

export type BetaSurveyVersion='A'|'B';
export type BetaSurveyAnswer=string|number|string[];
export type BetaSurveyAnswers=Record<string,BetaSurveyAnswer>;
export type BetaSurveyOption={value:string;label:string};
export type BetaSurveyQuestion={id:string;label:string;kind:'single'|'multiple'|'text'|'score';options?:BetaSurveyOption[];optional?:boolean;hint?:string;contact?:boolean;maxLength?:number};
const options=(labels:string[]):BetaSurveyOption[]=>labels.map(label=>({value:label,label}));
export const BETA_SURVEY_AGES=['18–22','23–25','26–28','29–35','36–45','46 岁以上'];
export const betaSurveyVersions=['A','B'] as const;
export const betaSurveyDay=(version:BetaSurveyVersion)=>version==='A'?7:28;
export const isBetaSurveyVersion=(value:unknown):value is BetaSurveyVersion=>value==='A'||value==='B';
export const betaSurveyOpener=(version:BetaSurveyVersion)=>version==='A'
  ?['内测满一周了。','给我 3 分钟，填个问卷。好话坏话都要真话。']
  :['内测满四周了。','再给我 3 分钟，填个问卷。好话坏话都要真话。'];
export const BETA_SURVEY_REMINDER=['问卷还没填。','就 3 分钟。'];
export const BETA_SURVEY_THANKS='收到了。你说的每一条，我们都会看。';
export function betaSurveyQuestions(version:BetaSurveyVersion):BetaSurveyQuestion[]{
  return version==='A'?[
    {id:'q1',label:'你的年龄段',kind:'single',options:options(BETA_SURVEY_AGES)},
    {id:'q2',label:'你现在住在哪个城市？',kind:'text',maxLength:80},
    {id:'q3',label:'你的状态',kind:'single',options:options(['上班','学生','自己做生意','暂时没工作','退休','其他'])},
    {id:'q4',label:'用智域之前，你用过 AI 吗？',kind:'single',options:options(['经常用','偶尔用','几乎没用过'])},
    {id:'q5',label:'这一周你大概每天打开几次？',kind:'single',options:options(['没怎么打开','1 次','2–3 次','4 次以上'])},
    {id:'q6',label:'你最喜欢哪个智友？',kind:'single',options:publicGroupDirectory().map(person=>({value:person.id,label:person.name}))},
    {id:'q7',label:'为什么最喜欢 TA？',kind:'text',optional:true,maxLength:2000},
    {id:'q8',label:'哪些功能对你有用？',kind:'multiple',options:options(['健身计划','饮食建议','做饭指导','每日简报','提醒','和智友聊天','语音通话','群聊','其他'])},
    {id:'q9',label:'哪里让你觉得不好用或者别扭？',kind:'text',optional:true,maxLength:2000},
    {id:'q10',label:'你有多大可能把智域推荐给朋友？',kind:'score'},
  ]:[
    {id:'q1',label:'你有多大可能把智域推荐给朋友？',kind:'score'},
    {id:'q2',label:'和刚开始用的时候比，你的生活有变化吗？',kind:'single',options:options(['变化很大','有一些','没什么变化'])},
    {id:'q3',label:'具体有什么变化？',kind:'text',optional:true,hint:'例：瘦了几斤、学会了几道菜',maxLength:2000},
    {id:'q4',label:'如果智域明天消失了，你会怎么样？',kind:'single',options:options(['非常失望','有点失望','无所谓'])},
    {id:'q5',label:'如果有家庭版（每月 15 元，帮全家管饭和身体），你愿意开通吗？',kind:'single',options:options(['愿意','可能','不愿意'])},
    {id:'q6',label:'如果有和智友视频通话（每月 19 元），你愿意开通吗？',kind:'single',options:options(['愿意','可能','不愿意'])},
    {id:'q7',label:'你最希望智域再帮你做什么？',kind:'text',maxLength:2000},
    {id:'q8',label:'你会继续用下去吗？',kind:'single',options:options(['会','看情况','不会'])},
    {id:'q9',label:'方便我们回访吗？方便的话留个微信或手机号',kind:'text',optional:true,contact:true,hint:'只用于回访，不会公开',maxLength:200},
  ];
}

/** The same allow-list validates draft and final answers; defaults never become answers. */
export function validateBetaSurveyAnswers(version:BetaSurveyVersion,value:unknown,complete=false):{answers:BetaSurveyAnswers;errors:Record<string,string>}{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('问卷答案格式无效');
  const input=value as Record<string,unknown>,questions=betaSurveyQuestions(version),answers:BetaSurveyAnswers={},errors:Record<string,string>={};
  if(Object.keys(input).some(key=>!questions.some(question=>question.id===key)))throw Error('问卷包含无效题目');
  for(const question of questions){
    const raw=input[question.id];
    if(raw===undefined||raw===null||raw===''){if(complete&&!question.optional)errors[question.id]='请回答这一题';continue;}
    if(question.kind==='text'){
      if(typeof raw!=='string'||raw.length>(question.maxLength||2000))throw Error('填空答案过长或格式无效');
      const text=raw.trim();if(text)answers[question.id]=text;else if(complete&&!question.optional)errors[question.id]='请回答这一题';
    }else if(question.kind==='score'){
      if(typeof raw!=='number'||!Number.isInteger(raw)||raw<0||raw>10)throw Error('请选择 0–10 分');
      answers[question.id]=raw;
    }else if(question.kind==='single'){
      if(typeof raw!=='string'||!question.options?.some(option=>option.value===raw))throw Error('单选答案无效');
      answers[question.id]=raw;
    }else{
      if(!Array.isArray(raw)||raw.length>question.options!.length||raw.some(item=>typeof item!=='string'||!question.options?.some(option=>option.value===item)))throw Error('多选答案无效');
      const chosen=[...new Set(raw as string[])];answers[question.id]=chosen;
      if(complete&&!chosen.length)errors[question.id]='请至少选择一项';
    }
  }
  return {answers,errors};
}

export type BetaSurveyCard={version:BetaSurveyVersion;title:string;durationLabel:string;opener:string[];receivedAt:number;remindedAt?:number;submittedAt?:number;seenAt?:number;hasDraft:boolean};
export type BetaSurveyDocument={version:BetaSurveyVersion;answers:BetaSurveyAnswers;revision:number;submittedAt?:number};
export type SurveyAnswerRow={userNumber:string;answer:string;submittedAt:number;ageGroup?:string;npcId?:string};
export type SurveyQuestionAnalytics={id:string;label:string;kind:BetaSurveyQuestion['kind'];total:number;options?:{value:string;label:string;count:number;percentage:number|null}[];answers?:SurveyAnswerRow[];contact?:boolean};
export type SurveyVersionAnalytics={version:BetaSurveyVersion;received:number;submitted:number;completionRate:number|null;nps:{score:number|null;total:number;promoters:number;passives:number;detractors:number};questions:SurveyQuestionAnalytics[]};
export type BetaSurveyAnalytics={versions:{A:SurveyVersionAnalytics;B:SurveyVersionAnalytics};completion:{received:number;submitted:number;rate:number|null};veryDisappointed:{count:number;total:number;rate:number|null};filtersAppliedTo:'text_answers'};
