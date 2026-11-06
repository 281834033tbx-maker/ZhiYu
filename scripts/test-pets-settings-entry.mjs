import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real catalog/menu/dialog components with synthetic hooks and in-memory storage.
// No browser, native bridge, real account, network, database or payment is used.
const slots=[],storage=new Map(),events=[];let cursor=0,sequence=0,closed=0;
const jsx=(type,props)=>({type,props:props||{}});
const react={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
 useRef(value){const i=cursor++;return slots[i]??={current:value};},
 useId(){return 'fixture-id-'+sequence++;},useMemo(callback){return callback();},useCallback(callback){return callback;},
 useEffect(){},useLayoutEffect(){},useSyncExternalStore(_subscribe,snapshot){return snapshot();},
};
const document={body:{synthetic:true},activeElement:null};
const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
const globals={console,document,localStorage,window:{localStorage,dispatchEvent:event=>events.push(event.type)},Event:class{constructor(type){this.type=type;}}};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props'in value?[value,...nodes(value.props.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'&&'props'in value?text(value.props.children):typeof value==='string'||typeof value==='number'?String(value):'';
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
function load(path,extra={}) {
 const source=readFileSync(path,'utf8'),sandboxModule={exports:{}};
 const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:Symbol.for('fragment')},'react-dom':{createPortal:node=>node},'lucide-react':new Proxy({},{get:()=>()=>null}),
  'next/image':()=>null,'../../lib/user-facing-errors':{reportUserFacingError:(_e,_kind,label)=>label},'./directory-divider':()=>null,'./dungeons':()=>null,
  './pet-storage':{PET_STATE_CHANGED_EVENT:'zhiyu-pet-state-changed',petStorageKey:id=>'zhiyu-pets-v1:'+id},'./pet-display-frames':{petDisplayFrames:{}},
  './auth-gate':{useAccount:()=>({account:{id:'pet-ui-owner'}})},'./pressable-icon-button':props=>jsx('button',props),'./anchored-popup-motion':{useAnchoredPopupPresence:open=>open},...extra};
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{...globals,module:sandboxModule,exports:sandboxModule.exports,require:name=>name.endsWith('.css')?{}:(assert.ok(name in deps,'Unexpected dependency '+name),deps[name])},{filename:path});return sandboxModule.exports;
}
const PetPage=load('app/zhiyu/pets.tsx').default;
const initialPet={id:'regular-bengal-cat',name:'保留旧昵称',description:'普通宠物',appearance:4,imageSrc:'/old-cat.png'};
storage.set('zhiyu-pets-v1:another-owner','untouched-other-account');
storage.set('zhiyu-pets-v1:pet-ui-owner',JSON.stringify({pets:[initialPet],selectedId:initialPet.id,visible:true}));
const page=PetPage({accountId:'pet-ui-owner',dirWidth:260,onDirectoryWidthChange(){},embedded:true});
const renderPage=()=>{cursor=0;return page.type(page.props);};
let tree=renderPage();
assert.ok(text(tree).includes('保留旧昵称'),'adopted pets keep their saved names');
assert.equal(nodes(tree).filter(node=>node.type==='aside').length,0,'modal catalog has no second navigation page');
button(tree,'去领养').props.onClick();tree=renderPage();
const cards=nodes(tree).filter(node=>node.type==='div'&&String(node.props.className).includes('zy-pet-discover-card'));
const limited=cards.filter(node=>String(node.props.className).includes('is-limited'));
const regular=cards.filter(node=>!String(node.props.className).includes('is-limited'));
assert.equal(limited.length,6);assert.equal(regular.length,16);
for(const card of limited){const b=nodes(card).find(node=>node.type==='button');assert.match(text(b),/^¥18$/);assert.equal(b.props.disabled,true);assert.equal(b.props.onClick,undefined,'limited pets never trigger a pretend payment');}
for(const card of regular){const b=nodes(card).find(node=>node.type==='button');assert.ok(['领养','已领养'].includes(text(b)));assert.ok(!/¥|购买/.test(text(card)),'regular pets are not paid products');}
const adoptedCard=regular.find(card=>text(card).includes('德文卷毛猫'));button(adoptedCard,'领养').props.onClick();
const saved=JSON.parse(storage.get('zhiyu-pets-v1:pet-ui-owner'));
assert.equal(saved.pets.length,2);assert.equal(saved.pets[0].name,'保留旧昵称');assert.equal(saved.selectedId,'regular-devon-rex');assert.equal(saved.visible,true);assert.equal(storage.get('zhiyu-pets-v1:another-owner'),'untouched-other-account');
assert.ok(events.includes('zhiyu-pet-state-changed'),'existing chat pet display receives its state event');
console.log('PASS: catalog preserves adopted pets, regular adoption is free, and limited pets retain disabled RMB prices.');

slots.length=0;cursor=0;
const PetsDialog=load('app/zhiyu/pets-dialog.tsx',{'./pets':{default:PetPage}}).default;
const modal=PetsDialog({onClose(){closed++;}});
assert.equal(modal.type,'dialog');assert.ok(nodes(modal).some(node=>node.type===PetPage&&node.props.embedded===true));
modal.props.onCancel({target:{},currentTarget:{},preventDefault(){throw Error('nested dialog cancel must not be intercepted');}});assert.equal(closed,0);
const same={};modal.props.onCancel({target:same,currentTarget:same,preventDefault(){}});assert.equal(closed,1);
console.log('PASS: pets use an in-page dialog, and a nested rename dialog can cancel independently.');

slots.length=0;cursor=0;
const Menu=load('app/zhiyu/chat-add-menu.tsx',{'./pets-dialog':{default:PetsDialog}}).default;
const renderMenu=()=>{cursor=0;return Menu({groups:[],onCreateGroup(){},onSelectGroup(){}});};
tree=renderMenu();nodes(tree).find(node=>node.props['aria-label']==='添加与任务').props.onClick();tree=renderMenu();
assert.ok(button(tree,'宠物'));assert.ok(button(tree,'发起群聊'));assert.equal(button(tree,'简报与周报'),undefined);
button(tree,'宠物').props.onClick();tree=renderMenu();assert.ok(nodes(tree).some(node=>node.type===PetsDialog));
console.log('PASS: add menu opens pets in the dialog and no longer contains report schedule settings.');

slots.length=0;cursor=0;
const schedule=()=>null;
const Settings=load('app/zhiyu/app-settings.tsx',{'../../desktop/package.json':{default:{version:'0.1.0'}},'./theme':{useTheme:()=>({transitioning:false,theme:'light',setTheme(){},toggleTheme(){}})},'./font-size':{useFontSize:()=>({fontSize:'medium',setFontSize(){}})},'./morning-reminder-settings':{ReportScheduleSettings:schedule}}).default;
tree=Settings({person:{name:'合成账号'},username:'fixture',onClose(){},async onLogout(){}});
assert.ok(nodes(tree).some(node=>node.type===schedule),'schedule controls are embedded in the main settings dialog');
assert.match(text(tree),/简报与周报/);assert.doesNotMatch(text(tree),/演示|重新生成/);
console.log('PASS: report schedule controls are embedded in Settings without demo generation UI.');
