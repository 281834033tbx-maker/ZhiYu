import ts from 'typescript';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';

export const forbiddenCopy=/NPC|AI\s*生成|生成中|生成失败|演示|原型|本地服务|Codex|DeepSeek|模型|Skill|prompt|\.json|\.md|npc-skills|user_required|未记录|US\$|许晓曼|袁小满|许小满|周师傅/iu;
const displayAttributes=new Set(['aria-label','alt','title','placeholder','data-tooltip','label','description','emptyText','emptyLabel','subtitle','message','text']);
const sinkCalls=/^(?:notify|toast|set(?:[A-Za-z]*Error|Notice|Toast))$/u;
const safeCalls=new Set(['userFacingError','reportUserFacingError','userFacingValidationMessage']);
const functionName=node=>ts.isIdentifier(node)?node.text:ts.isPropertyAccessExpression(node)?node.name.text:'';

function stringsFrom(node,checker,seen=new Set()) {
  if(!node||seen.has(node))return [];
  seen=new Set(seen);seen.add(node);
  if(ts.isStringLiteralLike(node))return [{node,text:node.text}];
  if(ts.isTemplateExpression(node))return [node.head,...node.templateSpans.map(span=>span.literal)].map(part=>({node:part,text:part.text})).concat(node.templateSpans.flatMap(span=>stringsFrom(span.expression,checker,seen)));
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node)||ts.isTypeAssertionExpression(node))return stringsFrom(node.expression,checker,seen);
  if(ts.isConditionalExpression(node))return [...stringsFrom(node.whenTrue,checker,seen),...stringsFrom(node.whenFalse,checker,seen)];
  if(ts.isBinaryExpression(node)) {
    if(node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)return stringsFrom(node.right,checker,seen);
    if([ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind))return [...stringsFrom(node.left,checker,seen),...stringsFrom(node.right,checker,seen)];
    return [];
  }
  if(ts.isArrayLiteralExpression(node))return node.elements.flatMap(item=>stringsFrom(item,checker,seen));
  if(ts.isObjectLiteralExpression(node))return node.properties.flatMap(property=>ts.isPropertyAssignment(property)&&['text','error','message','label','title'].includes(property.name.getText().replace(/['"]/g,''))?stringsFrom(property.initializer,checker,seen):[]);
  if(ts.isElementAccessExpression(node))return stringsFrom(node.expression,checker,seen);
  if(ts.isCallExpression(node)) {
    const name=functionName(node.expression);
    if(safeCalls.has(name))return [];
    if(ts.isPropertyAccessExpression(node.expression)&&['join','trim','slice','toString','toLocaleString'].includes(name))return stringsFrom(node.expression.expression,checker,seen);
    const symbol=checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression)?node.expression.name:node.expression);
    const target=symbol?.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(symbol):symbol;
    return (target?.declarations||[]).flatMap(declaration=>{
      if(!('body'in declaration)||!declaration.body)return [];
      if(!ts.isBlock(declaration.body))return stringsFrom(declaration.body,checker,seen);
      const values=[];
      const returns=child=>{if(ts.isReturnStatement(child))values.push(...stringsFrom(child.expression,checker,seen));else if(!ts.isFunctionLike(child))ts.forEachChild(child,returns);};
      ts.forEachChild(declaration.body,returns);return values;
    });
  }
  if(ts.isIdentifier(node)||ts.isPropertyAccessExpression(node)) {
    const location=ts.isPropertyAccessExpression(node)?node.name:node;
    const symbol=checker.getSymbolAtLocation(location);
    const target=symbol?.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(symbol):symbol;
    return (target?.declarations||[]).flatMap(declaration=>'initializer'in declaration?stringsFrom(declaration.initializer,checker,seen):[]);
  }
  return [];
}

function unsafeError(node) {
  if(!node)return null;
  if(ts.isCallExpression(node)&&safeCalls.has(functionName(node.expression)))return null;
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)return unsafeError(node.right);
  if(ts.isConditionalExpression(node))return unsafeError(node.whenTrue)||unsafeError(node.whenFalse);
  if(ts.isPropertyAccessExpression(node)&&['message','error','deliveryError'].includes(node.name.text))return node;
  let found=null;
  ts.forEachChild(node,child=>{if(!found)found=unsafeError(child);});
  return found;
}

export function inspectProgram(program,files,root=process.cwd()) {
  const checker=program.getTypeChecker(),results=[],keys=new Set();
  const add=(node,text,kind)=>{
    const source=node.getSourceFile(),position=source.getLineAndCharacterOfPosition(node.getStart(source));
    const item={file:relative(root,source.fileName),line:position.line+1,column:position.character+1,kind,text};
    const key=JSON.stringify(item);if(!keys.has(key)){keys.add(key);results.push(item);}
  };
  const inspect=(expression,kind)=>{
    for(const item of stringsFrom(expression,checker))if(forbiddenCopy.test(item.text))add(item.node,item.text,kind);
    const raw=unsafeError(expression);if(raw)add(raw,raw.getText(),'raw-error');
  };
  for(const file of files) {
    const source=program.getSourceFile(file);if(!source)continue;
    const visit=node=>{
      if(ts.isJsxText(node)&&forbiddenCopy.test(node.text))add(node,node.text.replace(/\s+/g,' ').trim(),'jsx-text');
      if(ts.isJsxAttribute(node)&&displayAttributes.has(node.name.getText(source))&&node.initializer)inspect(ts.isJsxExpression(node.initializer)?node.initializer.expression:node.initializer,'attribute');
      if(ts.isJsxExpression(node)&&!ts.isJsxAttribute(node.parent)&&node.expression)inspect(node.expression,'render-expression');
      if(ts.isCallExpression(node)&&sinkCalls.test(functionName(node.expression))&&node.arguments[0])inspect(node.arguments[0],'message-sink');
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  return results;
}

export function inspectSource(source,filename=resolve('copy-fixture.tsx')) {
  const options={jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022,noLib:true};
  const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
  host.getSourceFile=(file,...rest)=>file===filename?ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX):original(file,...rest);
  return inspectProgram(ts.createProgram([filename],options,host),[filename],process.cwd());
}

export function inspectApplication(root=process.cwd()) {
  const files=[];
  const walk=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())walk(file);else if(/\.[tj]sx?$/u.test(entry.name))files.push(file);}};
  walk(join(root,'app'));walk(join(root,'components'));
  const config=ts.readConfigFile(join(root,'tsconfig.json'),path=>readFileSync(path,'utf8'));
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
  return inspectProgram(ts.createProgram(files,{...parsed.options,noEmit:true,incremental:false}),files,root);
}
