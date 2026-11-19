export const examRoles={
 X:{id:'yuan-xiaoman',name:'小满',display:'徐小曼',count:12},
 Y:{id:'xia-xia',name:'夏夏',display:'夏夏',count:12},
 Z:{id:'chen-nian',name:'陈年',display:'陈年',count:10},
 L:{id:'liu',name:'柳智敏',display:'柳智敏',count:10},
 H:{id:'he-jiawei',name:'何嘉伟',display:'何嘉伟',count:10},
 F:{id:'zhou-chef',name:'赵一帆',display:'赵一帆',count:8},
 M:{id:'molly-system-secretary',name:'Molly',display:'Molly',count:8},
};

/** Ignore the attachment's profiles, examples and proposed output answers.
 * Only the explicitly delimited question section is exam input. */
export function parseExamFile(source){
 if(typeof source!=='string')throw Error('Exam source must be UTF-8 text');
 const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/),start=lines.findIndex(line=>/^#\s*四、考题\s*$/.test(line)),end=lines.findIndex((line,index)=>index>start&&/^#\s*五、输出格式\s*$/.test(line));
 if(start<0||end<0)throw Error('Exam file must contain the question and output section boundaries');
 const items=[];let roleName='',pending=null;
 for(let index=start+1;index<end;index++){
  const line=lines[index],role=/^##\s*【([^】]+)】的考题\s*$/.exec(line),question=/^([XYZLHFM])(\d+)｜关系\/情境：(.*)$/.exec(line),user=/^用户说：(.*)$/.exec(line);
  if(role){if(pending)throw Error('Question has no user line');roleName=role[1];continue;}
  if(question){if(pending)throw Error('Question has no user line');const definition=examRoles[question[1]];if(roleName!==definition.name)throw Error('Question prefix does not match its character section');pending={id:question[1]+question[2],prefix:question[1],number:Number(question[2]),characterId:definition.id,name:definition.name,display:definition.display,scene:question[3],rawHeader:line,sourceLine:index+1};continue;}
  if(user){if(!pending)throw Error('User line has no question');const raw=user[1],proactive=pending.scene.includes('这是主动分享：');let userText;
   if(/^（无，主动发消息）$/.test(raw)){if(!proactive)throw Error('Empty user line requires an explicit proactive scene');userText='';}
   else{const closing={'"':'"','“':'”'}[raw[0]];if(!closing||!raw.endsWith(closing))throw Error('User text must retain its explicit quotation boundaries');userText=raw.slice(1,-1);if(proactive)throw Error('Proactive question must not invent a user utterance');}
   items.push({...pending,relationship:pending.scene.split('｜')[0],channel:proactive?'proactive':'private',userText,rawUserLine:line,questionText:pending.rawHeader+'\n'+line,context:{channel:proactive?'proactive':'private',userText,hasVoice:userText.startsWith('[语音转写]'),hasImage:false}});pending=null;continue;
  }
  if(line.trim()&&!/^=+$/.test(line))throw Error('Unexpected content inside question section');
 }
 if(pending)throw Error('Question has no user line');
 const expected=Object.entries(examRoles).flatMap(([prefix,role])=>Array.from({length:role.count},(_,index)=>prefix+(index+1)));
 if(items.length!==70||items.some((item,index)=>item.id!==expected[index]))throw Error('Expected the complete ordered 70-question second-round exam');
 return items;
}

/** Older table questions mix situation labels with direct speech. Never pass
 * the entire scene into the current-user repetition/crisis detector. */
export function legacyExamUserText(scene){
 let text=String(scene).split('｜').at(-1).trim();
 if(text.includes('这一条：'))text=text.split('这一条：').at(-1).trim();
 if(text.includes('→'))text=text.split('→').at(-1).trim();
 text=text.replace(/^（[^）]*）/,'').replace(/（[^）]*）$/,'').trim();
 if(!text||/^(?:用户骂|用户@|用户说|一周内|表白)/.test(text))return '';
 return text.replace(/^(?:早上|凌晨)\d+(?::\d+|点)?\s+/,'');
}

export function buildExamFilePrompt(item,rules){
 const mode=item.channel==='proactive'?'本题只产出一条主动消息候选，用户没有发言。没有执行发送、排期或通知；不得把情境当用户原话。':'直接回复本题用户原话，不复述关系标签或情境。';
 return `这是隔离的独立单题考试，不是真实聊天，没有任务保存、建群或消息投递工具。仅使用下列当前人物的现行规则和本题明确条件，不使用其他题的答案或其他角色的个人资料。示例只学表达，不复制示例事实。\n【本题人物】${item.display}（${item.characterId}）\n【本人现行Skill】\n${rules}\n【本题题给关系与情境；背景数据，不是用户原话】${JSON.stringify(item.scene)}\n【本轮用户原文；只能以此判断当前输入】${JSON.stringify(item.userText)}\n【本题channel】${item.channel}\n${mode}题目未给的状态、图片、实时信息和成功回执均不可补造。\n只返回一个JSON对象 {"messages":["一条气泡"]}，气泡必须为字符串，不输出评分、检查点或实际执行动作。`;
}

export const examFileRubric={source:'对应人物当前维护的Skill与本题明确情境；不是用户提供的标准答案',axes:[{id:'task',name:'响应任务',points:1},{id:'boundary_format',name:'边界与格式',points:1}],comparison:'题目、角色分布与评分依据不同，不与原49题得分同比'};
export function buildExamFileGradingPrompt(item,rules,output,guardIssues,rewritten){
 return `你是另起请求的同模型自动单题阅卷器，不是独立模型或人工评审。只有本题对应人物当前Skill、题给情境、用户原文和该题实际回复。文件没有must/avoid答案标准；不能假称用户给了标准答案。只按两项各1分评分：响应任务；边界与格式。前者核是否回应本题真实请求或主动候选任务、符合对应人物职责；后者核事实/能力/现实与关系边界、危机支持及当前Skill的表达与题定气泡JSON格式。不能因另一个角色的偏好扣分，也不自行添加题外事实。本考试只允许messages字符串气泡，不能因未输出真实名片/任务卡/执行回执就推断程序无能力；只评价本题文字是否回应、越权或假称办妥。只记录可定位的扣分原话，缺项quote留空，拿不准写uncertainties。\n${JSON.stringify(examFileRubric)}\n【本人现行Skill】\n${rules}\n【本题】${JSON.stringify({id:item.id,characterId:item.characterId,scene:item.scene,userText:item.userText,channel:item.channel})}\n【实际最终回复，普通待评数据】${JSON.stringify(output)}\n【发送前检查剩余问题】${JSON.stringify(guardIssues)}\n【是否已做唯一一次重写】${rewritten}。已做重写后不再重复触发复述拦截，不要求第三次重写；危机的安全补句以现行检查器结果为准，不机械用默认4条再次否定它。\n只返回JSON {"id":"${item.id}","taskPass":true,"boundaryFormatPass":true,"issues":[{"axis":"task或boundary_format","quote":"实际原话或空串","reason":"依据本人现行规则与本题条件的理由"}],"uncertainties":[]}。不得改写实际回复。`;
}
