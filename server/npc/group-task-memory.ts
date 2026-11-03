import type {DatabaseSync} from 'node:sqlite';

export type TaskFactKey = 'food_allergy' | 'dietary_avoidance' | 'food_allergy_status' | 'dietary_avoidance_status' | 'height' | 'weight' | 'body_fat' | 'waist' | 'sleep' | 'energy' | 'soreness';
export type TaskEvidence = {sourceCharacterId: string; messageId: string; at: string | null; chronology: 'dated' | 'undated'; quote: string};
export type TaskFact = {key: TaskFactKey; value: string | number; unit?: 'cm' | 'kg' | '%'; evidence: TaskEvidence};
export type TaskMemorySnapshot = {version: 'group-task-memory-20261007-v1'; facts: TaskFact[]};
type Operation = {action: 'set'; fact: TaskFact} | {action: 'remove'; key: TaskFactKey; value?: string | number};
type EventRow = {operations: string};

const OWNER = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SOURCES = new Set(['molly', 'zhou-chef', 'chen-nian', 'yuan-xiaoman', 'xia-xia', 'liu', 'he-jiawei']);
const SESSION_SOURCES = [
  ['sessions', 'xia-xia:normal', 'xia-xia'], ['molly_sessions', 'molly-system-secretary', 'molly'],
  ['yuan_sessions', 'yuan-xiaoman', 'yuan-xiaoman'], ['chen_sessions', 'chen-nian', 'chen-nian'],
  ['liu_sessions', 'liu', 'liu'], ['he_sessions', 'he-jiawei', 'he-jiawei'],
  ['zhou_chef_sessions', 'zhou-chef', 'zhou-chef'],
] as const;
const FOODS = ['辛辣食物', '动物内脏', '乳制品', '豆制品', '鸡蛋', '鸭蛋', '鹅蛋', '花生米', '花生', '牛奶', '羊奶', '大豆', '芝麻', '坚果', '小麦', '麸质', '荞麦', '海鲜', '龙虾', '小龙虾', '生蚝', '牡蛎', '扇贝', '贝类', '鱼类', '虾类', '蟹类', '鱼', '虾', '蟹', '芒果', '菠萝', '辣椒', '香菜', '猪肉', '牛肉', '羊肉', '鸡肉', '鸭肉', '酒精', '咖啡', '辣的', '辣'];
const FOOD_PATTERN = new RegExp(FOODS.sort((a, b) => b.length - a.length).join('|'), 'gu');
const NON_SELF = /(?:假如|假设|比如|例如|举例|测试|模拟|演示|扮演|台词|角色|NPC|引用|转述|听说|据说|你说|你写|他说|她说|别人|他人|朋友|同事|患者|客户|孩子|女儿|儿子|妈妈|爸爸|父亲|母亲|老公|老婆|妻子|丈夫|男友|女友|宠物|如果)/iu;
const FRAMED = /(?:测试|模拟|演示|扮演|台词|角色|NPC|[“”「」『』"])/iu;
const UNCERTAIN = /(?:[?？]|是不是|是否|会不会|可能|好像|怀疑|不确定|似乎|也许|(?:吗|么|呢)$)/u;
const METRICS: TaskFactKey[] = ['height', 'weight', 'body_fat','waist','sleep','energy','soreness'];

function foodItems(clause: string, dietary = false): string[] {
  return [...new Set([...clause.matchAll(FOOD_PATTERN)].map(match => {
    const item = match[0];
    if (item === '花生米') return '花生';
    if (item === '鱼类' || item === '虾类' || item === '蟹类') return item.slice(0, 1);
    return dietary && ['辣', '辣的', '辣椒'].includes(item) ? '辛辣食物' : item;
  }))];
}

function factId(key: TaskFactKey, value?: string | number) {
  return ['food_allergy', 'dietary_avoidance'].includes(key) ? `${key}:${value}` : key;
}

/** Bounded direct statements only. Unknown semantics are left for the group to ask. */
export function extractTaskFacts(sourceCharacterId: string, messageId: string, text: string, at: string | null): Operation[] {
  if (!text.trim() || text.length > 4000 || FRAMED.test(text)) return [];
  const operations: Operation[] = [];
  let subjectBlocked = false;
  const remove = (key: TaskFactKey, value?: string | number) => operations.push({action: 'remove', key, ...(value === undefined ? {} : {value})});
  for (const raw of text.match(/[^，,。!！?？\n;；]+[?？]?/gu) || []) {
    const clause = raw.trim();
    if (!clause || clause.length > 180) continue;
    // A third-person/hypothetical subject carries to following fragments until
    // a new, explicit first-person statement appears; questions affect only their clause.
    if (NON_SELF.test(clause)) {subjectBlocked = true; continue;}
    if (/^(?:我(?!们)|本人)/u.test(clause)) subjectBlocked = false;
    if (subjectBlocked || UNCERTAIN.test(clause)) continue;
    const evidence: TaskEvidence = {sourceCharacterId, messageId, at, chronology: at ? 'dated' : 'undated', quote: clause};
    const set = (key: TaskFactKey, value: string | number, unit?: TaskFact['unit'], quote = clause) => operations.push({action: 'set', fact: {key, value, ...(unit ? {unit} : {}), evidence: {...evidence, quote}}});
    const foods = foodItems(clause);
    const avoidances = foodItems(clause, true);
    const retract = /(?:撤回|删除|忘掉|清除|取消|记错|写错|说错|不对)/u.test(clause);
    const refuseMemory = /(?:不要|别|不用).{0,8}(?:记|存|共享|发给)/u.test(clause);
    if (retract || refuseMemory) {
      if (/过敏/u.test(clause)) {
        if (foods.length) foods.forEach(item => remove('food_allergy', item));
        else {remove('food_allergy'); remove('food_allergy_status');}
      }
      if (/(?:忌口|不吃|不能吃)/u.test(clause)) {
        if (avoidances.length) avoidances.forEach(item => remove('dietary_avoidance', item));
        else {remove('dietary_avoidance'); remove('dietary_avoidance_status');}
      }
      if (/身高/u.test(clause)) remove('height');
      if (/体重/u.test(clause)) remove('weight');
      if (/体脂/u.test(clause)) remove('body_fat');
      if (/腰围/u.test(clause)) remove('waist');
      if (/睡眠/u.test(clause)) remove('sleep');
      if (/精力/u.test(clause)) remove('energy');
      if (/酸痛/u.test(clause)) remove('soreness');
      if (/(?:全部|所有).{0,5}(?:健康|饮食|任务)(?:资料|记忆|信息)|(?:健康|饮食|任务)(?:资料|记忆|信息).{0,5}(?:全部|所有)/u.test(clause)) {
        [...METRICS, 'food_allergy', 'dietary_avoidance', 'food_allergy_status', 'dietary_avoidance_status'].forEach(key => remove(key as TaskFactKey));
      }
      continue;
    }
    if (/^(?:我(?:本人|的)?(?:以前|曾经|当时|之前|原来|过去)|以前|曾经|当时|之前|原来|过去)/u.test(clause)) continue;
    if (/^(?:我(?:本人|现在|目前)?(?:没有|无)|没有|无)(?:任何)?(?:食物|食品)?过敏(?:情况|史)?$/u.test(clause)) {
      remove('food_allergy'); set('food_allergy_status', 'none'); continue;
    }
    if (/^(?:我(?:本人|现在|目前)?(?:没有|无)|没有|无)(?:任何)?忌口$/u.test(clause)) {
      remove('dietary_avoidance'); set('dietary_avoidance_status', 'none'); continue;
    }
    if (foods.length && /过敏/u.test(clause)) {
      if (/(?:不再|不|没|没有).{0,8}过敏|(?:没有|无).{0,8}过敏/u.test(clause)) foods.forEach(item => remove('food_allergy', item));
      else if (/^(?:我|本人|对|食物过敏|过敏|海鲜|鱼|虾|蟹|贝类|龙虾|小龙虾|生蚝|牡蛎|扇贝|花生|牛奶|羊奶|乳制品|鸡蛋|鸭蛋|鹅蛋|大豆|豆制品|芝麻|坚果|小麦|麸质|荞麦|芒果|菠萝|辣椒)/u.test(clause)) {
        const spans = [...clause.matchAll(FOOD_PATTERN)];
        const start = Math.min(spans[0]!.index!, clause.indexOf('过敏'));
        const end = Math.max(spans.at(-1)!.index! + spans.at(-1)![0].length, clause.indexOf('过敏') + 2);
        remove('food_allergy_status'); foods.forEach(item => set('food_allergy', item, undefined, clause.slice(start, end)));
      }
      continue;
    }
    if (avoidances.length && !/(?:今天|这顿|这一餐|这几天|暂时|本次)/u.test(clause)) {
      if (/^(?:我(?:现在|目前)?|现在|目前)?.{0,8}(?:可以吃|能吃|恢复吃|不再忌口|不忌口)/u.test(clause)) avoidances.forEach(item => remove('dietary_avoidance', item));
      else if (/^(?:我(?:本人|现在|目前)?|本人)?(?:不吃|不能吃|不喜欢吃|不爱吃|忌口|要避开|避免吃|忌)/u.test(clause) || /^忌口(?:是|有|包括)?/u.test(clause)) {
        const marker = /(?:不吃|不能吃|不喜欢吃|不爱吃|忌口|要避开|避免吃|忌)/u.exec(clause)!;
        const last = [...clause.matchAll(FOOD_PATTERN)].at(-1)!;
        remove('dietary_avoidance_status'); avoidances.forEach(item => set('dietary_avoidance', item, undefined, clause.slice(marker.index, last.index! + last[0].length)));
      }
    }
    // Undated legacy figures are not presented as current body measurements.
    if (!at) continue;
    const ownMetric = /^(?:我(?:本人|现在|目前)?(?:的)?|本人|现在|目前|身高|体重|体脂|腰围|睡眠|精力|酸痛)/u.test(clause);
    if (!ownMetric) continue;
    const number = '(\\d{1,3}(?:\\.\\d{1,2})?)';
    const waist=/腰围(?:是|为|现在|目前)?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:厘米|公分|cm)(?![a-z])/iu.exec(clause);
    if(waist&&Number(waist[1])>=30&&Number(waist[1])<=250)set('waist',Number(waist[1]),'cm',waist[0]);
    const feeling=/^(?:我(?:最近|现在|今天|目前)?(?:的)?|本人)?(睡眠|精力|(?:肌肉)?酸痛)(?:是|很|比较|程度|情况)?(好|一般|差|轻|中等|重|没有)[。！!\s]*$/u.exec(clause);
    if(feeling)set(feeling[1]==='睡眠'?'sleep':feeling[1]==='精力'?'energy':'soreness',feeling[2]);
    const height = new RegExp('身高(?:是|为|有|现在|目前|改为|改成|更新为)?\\s*' + number + '\\s*(厘米|公分|cm|米|m)(?![a-z])', 'iu').exec(clause);
    if (height) {
      const value = Number(height[1]) * (/^(?:米|m)$/i.test(height[2]) ? 100 : 1);
      if (value >= 40 && value <= 250) set('height', Number(value.toFixed(2)), 'cm', height[0]);
    }
    const weight = new RegExp('(?:体重(?:是|为|有|现在|目前|改为|改成|更新为)?|我(?:现在|目前)?(?:体重)?(?:是|重))\\s*' + number + '\\s*(公斤|千克|kg|斤)(?![a-z])', 'iu').exec(clause);
    if (weight) {
      const value = Number(weight[1]) * (weight[2] === '斤' ? 0.5 : 1);
      if (value >= 10 && value <= 500) set('weight', Number(value.toFixed(2)), 'kg', weight[0]);
    }
    const bodyFat = new RegExp('体脂(?:率)?(?:是|为|现在|目前|改为|改成|更新为)?\\s*(?:' + number + '\\s*[%％]|百分之' + number + ')', 'u').exec(clause);
    if (bodyFat) {
      const value = Number(bodyFat[1] || bodyFat[2]);
      if (value > 0 && value <= 75) set('body_fat', value, '%', bodyFat[0]);
    }
  }
  return operations;
}

/** Stores only extracted task evidence in a new table; private sessions remain untouched. */
export class TaskMemoryStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS npc_group_task_memory_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, source_character TEXT NOT NULL,
      message_id TEXT NOT NULL, at TEXT, at_ms INTEGER, operations TEXT NOT NULL,
      UNIQUE(owner,source_character,message_id)
    ); CREATE INDEX IF NOT EXISTS npc_group_task_memory_owner ON npc_group_task_memory_events(owner,at_ms,seq);`);
  }

  private checkOwner(owner: string) {
    if (!OWNER.test(owner)) throw new Error('任务记忆需要已认证账号');
  }

  record(owner: string, sourceCharacterId: string, messageId: string, text: string, at?: string): TaskMemorySnapshot {
    this.ingest(owner, sourceCharacterId, messageId, text, at);
    return this.snapshot(owner);
  }

  private ingest(owner: string, sourceCharacterId: string, messageId: string, text: string, at?: string): void {
    this.checkOwner(owner);
    if (!SOURCES.has(sourceCharacterId) && !/^group-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sourceCharacterId)) throw new Error('无效任务记忆来源');
    // oxlint-disable-next-line no-control-regex -- Reject control characters in evidence IDs.
    if (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 180 || /[\u0000-\u001f\u007f]/u.test(messageId)) throw new Error('无效任务记忆消息编号');
    if (typeof text !== 'string') throw new Error('无效任务记忆文字');
    if (at !== undefined && (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(at) || !Number.isFinite(Date.parse(at)))) throw new Error('无效任务记忆消息时间');
    const date = at === undefined ? null : new Date(Date.parse(at)).toISOString();
    const operations = extractTaskFacts(sourceCharacterId, messageId, text, date);
    if (operations.length) this.db.prepare('INSERT OR IGNORE INTO npc_group_task_memory_events(owner,source_character,message_id,at,at_ms,operations) VALUES(?,?,?,?,?,?)')
      .run(owner, sourceCharacterId, messageId, date, date ? Date.parse(date) : null, JSON.stringify(operations));
  }

  collect(owner: string): TaskMemorySnapshot {
    this.checkOwner(owner);
    const tables = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[]).map(row => row.name));
    const incoming: {source: string; id: string; text: string; at?: string; sequence: number}[] = [];
    let sequence = 0;
    for (const [table, suffix, source] of SESSION_SOURCES) {
      if (!tables.has(table)) continue;
      // Exact owner + production suffix; exclude test and special scenario branches.
      const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${suffix}`) as {data: string} | undefined;
      if (!row) continue;
      let state: {mode?: string; messages?: unknown[]};
      try {state = JSON.parse(row.data);} catch {continue;}
      if (!state || state.mode === 'test' || !Array.isArray(state.messages)) continue;
      for (const item of state.messages) {
        if (!item || typeof item !== 'object') continue;
        const message = item as {id?: unknown; role?: unknown; at?: unknown; chronologyUnknown?: unknown; part?: {type?: unknown; text?: unknown}; status?: unknown};
        if (message.role !== 'user' || message.status === 'model_proposed' || message.part?.type !== 'text'
          || typeof message.part.text !== 'string' || typeof message.id !== 'string') continue;
        const at = message.chronologyUnknown !== true && typeof message.at === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(message.at) && Number.isFinite(Date.parse(message.at)) ? message.at : undefined;
        incoming.push({source, id: message.id, text: message.part.text, ...(at ? {at} : {}), sequence: sequence++});
      }
    }
    incoming.sort((a, b) => (a.at ? Date.parse(a.at) : -Infinity) - (b.at ? Date.parse(b.at) : -Infinity) || a.sequence - b.sequence);
    for (const message of incoming) {
      try {this.ingest(owner, message.source, message.id, message.text, message.at);} catch { /* Skip malformed archived evidence, never invent repairs. */ }
    }
    return this.snapshot(owner);
  }

  snapshot(owner: string): TaskMemorySnapshot {
    this.checkOwner(owner);
    const facts = new Map<string, TaskFact>();
    const rows = this.db.prepare('SELECT operations FROM npc_group_task_memory_events WHERE owner=? ORDER BY CASE WHEN at_ms IS NULL THEN 0 ELSE 1 END,at_ms,seq').all(owner) as EventRow[];
    for (const row of rows) for (const operation of JSON.parse(row.operations) as Operation[]) {
      if (operation.action === 'set') facts.set(factId(operation.fact.key, operation.fact.value), operation.fact);
      else for (const [id, fact] of facts) if (fact.key === operation.key && (operation.value === undefined || fact.value === operation.value)) facts.delete(id);
    }
    return {version: 'group-task-memory-20261007-v1', facts: [...facts.values()].sort((a, b) => a.key.localeCompare(b.key) || String(a.value).localeCompare(String(b.value)))};
  }
}
