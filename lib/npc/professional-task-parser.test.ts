import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfessionalTaskOperation, ProfessionalTaskError } from './professional-task';

const proposal=(steps:unknown[]=[{title:'准备食材',instructions:['洗好土豆。','切成滚刀块。']}])=>({
  decision:'create',basis:'execution_commitment',scope:'current_user',polarity:'affirmed',readiness:'ready',confidence:.95,
  sourceMessageId:'source',evidence:'我要做地三鲜。',title:'地三鲜',goalKey:'地三鲜',steps,
});
const stepFrom=(step:Record<string,unknown>)=>{
  const parsed=parseProfessionalTaskOperation(proposal([{title:'准备食材',...step}]));
  assert.ok('steps'in parsed);return parsed.steps[0];
};
const rejectsField=(step:unknown,path:string,type:string)=>{
  assert.throws(()=>parseProfessionalTaskOperation(proposal([step])),error=>{
    assert.ok(error instanceof ProfessionalTaskError);assert.equal(error.code,'TASK_STEP_CONTENT_INVALID');
    assert.ok(error.message.includes(`steps[0]${path}`),error.message);assert.ok(error.message.includes(`类型${type}`),error.message);
    return true;
  });
};

void test('数组协议保持原归一化和去重，不改变限额内的内容',()=>{
  assert.deepEqual(stepFrom({instructions:[' 洗好土豆。 ','切成滚刀块。'],notes:['下锅前擦干。'],completionCondition:' 表面没有水。 ',durationSeconds:300}),{
    title:'准备食材',instructions:['洗好土豆。','切成滚刀块。'],notes:['下锅前擦干。'],completionCondition:'表面没有水。',durationSeconds:300,
    details:['洗好土豆。','切成滚刀块。','注意：下锅前擦干。','完成状态：表面没有水。'],
  });
  const normalized=stepFrom({details:['旧正文。','旧正文。'],instructions:['新正文。'],notes:[]});
  assert.deepEqual(normalized.details,['旧正文。','新正文。']);assert.equal(normalized.notes,undefined);
});

void test('null仅表示缺省：有真实操作时可兼容空可选字段，不将null变成正文',()=>{
  assert.deepEqual(stepFrom({id:null,details:null,instructions:['洗好土豆。'],notes:null,completionCondition:null,durationSeconds:null}),{
    title:'准备食材',instructions:['洗好土豆。'],details:['洗好土豆。'],
  });
  assert.deepEqual(stepFrom({details:['旧操作。'],instructions:null,notes:null}),{title:'准备食材',details:['旧操作。']});
  rejectsField({title:'缺操作',details:null,instructions:null,notes:['注意热油。']},'.instructions','null');
});

void test('单字符串与多行字符串兼容为真实文本数组，保持所有非空行及顺序',()=>{
  assert.deepEqual(stepFrom({details:' 旧操作。\n\n旧补充。 ',instructions:' 洗好土豆。\r\n\r\n切成滚刀块。 ',notes:'下锅前擦干。\r注意油温。',completionCondition:'表面没有水。'}),{
    title:'准备食材',instructions:['洗好土豆。','切成滚刀块。'],notes:['下锅前擦干。','注意油温。'],completionCondition:'表面没有水。',
    details:['旧操作。','旧补充。','洗好土豆。','切成滚刀块。','注意：下锅前擦干。','注意：注意油温。','完成状态：表面没有水。'],
  });
  assert.deepEqual(stepFrom({details:'洗好土豆。',notes:' \n\r\n '}),{title:'准备食材',details:['洗好土豆。']});
  rejectsField({title:'缺操作',instructions:' \n\r\n '},'.instructions','string');
});

void test('结构化正文单字符串也可独立使用，模型运行状态字段继续丢弃',()=>{
  const step=stepFrom({instructions:'先洗。\n再切。',completedAt:'2026-10-10T01:00:00Z',timer:{status:'running',remainingMs:300_000}});
  assert.deepEqual(step,{title:'准备食材',instructions:['先洗。','再切。'],details:['先洗。','再切。']});
});

void test('对象、嵌套数组、数字和布尔正文全部拒绝，不stringify伪装成文本',()=>{
  for(const key of ['details','instructions','notes']) for(const [value,type] of [[{text:'PRIVATE_RECIPE_BODY'},'object'],[[['PRIVATE_RECIPE_BODY']],'array'],[42,'number'],[true,'boolean']] as const) {
    const step={title:'合法标题',instructions:['实际操作。'],[key]:value};
    rejectsField(step,Array.isArray(value)?`.${key}[0]`:`.${key}`,type);
    assert.throws(()=>parseProfessionalTaskOperation(proposal([step])),error=>error instanceof Error&&!error.message.includes('PRIVATE_RECIPE_BODY'));
  }
  for(const value of [null,'PRIVATE_RECIPE_BODY',[],42,true]) rejectsField(value,'',value===null?'null':Array.isArray(value)?'array':typeof value);
});

void test('数组项保持严格：null、空白、数字和对象不能吞掉，诊断定位具体项且不含正文',()=>{
  for(const key of ['details','instructions','notes']) for(const value of [null,' ',42,{text:'PRIVATE_RECIPE_BODY'}]){
    const step={title:'合法标题',instructions:['实际操作。'],[key]:['第一条有效操作。',value]};
    rejectsField(step,`.${key}[1]`,value===null?'null':typeof value);
    assert.throws(()=>parseProfessionalTaskOperation(proposal([step])),error=>error instanceof Error&&!error.message.includes('PRIVATE_RECIPE_BODY')&&!error.message.includes('第一条有效操作。'));
  }
});

void test('数组与兼容字符串同样遵守details37、instructions12、notes12条数限制',()=>{
  for(const [key,limit] of [['details',37],['instructions',12],['notes',12]] as const){
    const text=Array.from({length:limit},(_,index)=>`有效文本${index}。`);
    const step=stepFrom({instructions:['实际操作。'],[key]:text.join('\n')});
    assert.ok(key === 'details' ? step.details.includes(text[0]) : step[key]?.includes(text[0]));
    for(const value of [[...text,'超出条数。'],[...text,'超出条数。'].join('\n')]) rejectsField({title:'合法标题',instructions:['实际操作。'],[key]:value},`.${key}`,Array.isArray(value)?'array':'string');
  }
});

void test('每段1200字符上限与完成判断1200字符上限不放宽',()=>{
  const max='字'.repeat(1200),tooLong='字'.repeat(1201);
  for(const key of ['details','instructions','notes']){
    assert.ok(stepFrom({instructions:['操作。'],[key]:max}).details.length);
    rejectsField({title:'合法标题',instructions:['操作。'],[key]:tooLong},`.${key}[0]`,'string');
    rejectsField({title:'合法标题',instructions:['操作。'],[key]:[tooLong]},`.${key}[0]`,'string');
  }
  assert.equal(stepFrom({instructions:['操作。'],completionCondition:max}).completionCondition,max);
  rejectsField({title:'合法标题',instructions:['操作。'],completionCondition:tooLong},'.completionCondition','string');
  for(const value of [{text:'PRIVATE_CONDITION'},['PRIVATE_CONDITION'],42,false,' ']) rejectsField({title:'合法标题',instructions:['操作。'],completionCondition:value},'.completionCondition',Array.isArray(value)?'array':typeof value);
});

void test('20步与总归一化内容30000字符上限保持不变',()=>{
  assert.equal('steps'in parseProfessionalTaskOperation(proposal(Array.from({length:20},()=>({title:'短步骤',instructions:'操作。'})))),true);
  assert.throws(()=>parseProfessionalTaskOperation(proposal(Array.from({length:21},()=>({title:'短步骤',instructions:'操作。'})))),/任务目标或步骤不完整/);
  const largeStep={title:'步骤',details:Array.from({length:12},(_,index)=>`操作${index}。${'字'.repeat(1190)}`)};
  assert.throws(()=>parseProfessionalTaskOperation(proposal([largeStep,largeStep,largeStep])),/任务内容过长/);
  assert.throws(()=>parseProfessionalTaskOperation(proposal([{...largeStep,details:largeStep.details.join('\n')},{...largeStep,details:largeStep.details.join('\n')},{...largeStep,details:largeStep.details.join('\n')}])),/任务内容过长/);
});

void test('时长类型与边界不转数值字符串，不将null或短时自动建计时',()=>{
  for(const value of [null,30,60,119]) assert.equal(stepFrom({instructions:'操作。',durationSeconds:value}).durationSeconds,undefined);
  for(const value of [120,300,86_400]) assert.equal(stepFrom({instructions:'操作。',durationSeconds:value}).durationSeconds,value);
  for(const value of [0,-1,120.1,86_401,'300',true,{seconds:300},[300]]) rejectsField({title:'合法标题',instructions:'操作。',durationSeconds:value},'.durationSeconds',Array.isArray(value)?'array':typeof value);
});
