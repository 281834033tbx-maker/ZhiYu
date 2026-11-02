import {parseChoicePart, type ChoicePart} from './choice-chat';
import type { ChatMessage } from './contracts';
import { enabledCharacterDirectory, companionDirectory, getCharacter, type CharacterService } from './character-directory';
export const MOLLY_ID = 'molly-system-secretary';
// Compatibility export; public facts and responsibilities have one source.
export const mollyCatalog = enabledCharacterDirectory();
export type MollyQuery = {
  name: string | null;
  gender: string | null;
  ageMin: number | null;
  ageMax: number | null;
  tags: string[];
  unsupported: string[];
  excluded: string[];
};
export type MollyState = {
  revision?: number;
  characterId: typeof MOLLY_ID;
  address: string;
  query: MollyQuery;
  messages: ChatMessage[];
  queue: string[];
  pending: { id: string; since: number } | null;
  completed: string[];
  inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  error: string;
  retryAt: number;
};
export const emptyQuery = (): MollyQuery => ({
  name: null,
  gender: null,
  ageMin: null,
  ageMax: null,
  tags: [],
  unsupported: [],
  excluded: [],
});
export function createMolly(): MollyState {
  return {
    characterId: MOLLY_ID,
    address: '老大',
    query: emptyQuery(),
    // Opening the pinned window is not permission for an unsolicited message.
    // Existing stored conversations are loaded unchanged by the plugin.
    messages: [],
    queue: [],
    pending: null,
    completed: [],
    inputRevision: 0,
    typing: {},
    error: '',
    retryAt: 0,
  };
}
export function matchMolly(query: MollyQuery) {
  return mollyCatalog.filter(
    (c) =>
      !query.unsupported.length &&
      !query.excluded.includes(c.id) &&
      (!query.name || [c.name, c.realName, ...c.aliases].includes(query.name)) &&
      (!query.gender || query.gender === c.gender) &&
      (query.ageMin === null || (c.age !== null && c.age >= query.ageMin)) &&
      (query.ageMax === null || (c.age !== null && c.age <= query.ageMax)) &&
      query.tags.every((t) => [...c.tags, ...c.aliases, c.personality].includes(t)),
  );
}
type MollyActionSource = {
  sourceMessageId: string;
  /** A continuous excerpt of that real user message, not a model paraphrase. */
  evidence: string;
  scope: 'current_user';
  polarity: 'affirmed';
  /** Internal interpretation confidence; this is not a measured accuracy rate. */
  confidence: number;
};
export type MollyAction = MollyActionSource & (
  | { type: 'handoff'; targetId: string; service: CharacterService; request: string;
      mode: 'new' | 'continue-plan' | 'confirm-plan' }
  | { type: 'tasks'; scope: 'current_user'; taskScope: 'today' | 'all' }
  | { type: 'create-group'; memberIds: string[]; goal: string }
);
export type MollyOutput = {
  replyTo?: (string|null)[];
  intent: 'chat' | 'reject' | 'search' | 'clarify' | 'rename' | 'operation';
  messages: (string | ChoicePart)[];
  address: string | null;
  query: MollyQuery | null;
  queryMode?: 'refine' | 'replace' | 'clear';
  candidateIds?: string[];
  /** Proposals only; the server persists and executes before acknowledging. */
  actions?: MollyAction[];
  // Advisory only. Actual matches are determined by the program, and omitting
  // this hint must never replace reviewed dialogue with a canned response.
  noMatch?: boolean;
  // Derived from the user input by parseMolly; never accepted from model JSON.
  genderDirective?: '男' | '女' | 'any';
};

export function mollyCompanionChoice(query: MollyQuery = emptyQuery()): ChoicePart | null {
  const eligible = new Set(matchMolly(query).map(person => person.id));
  const people = companionDirectory().filter(person => eligible.has(person.id));
  return people.length >= 2 ? { type: 'choice', text: '想聊哪种？',
    options: people.map(person => `${person.name}｜${person.personality}`) } : null;
}

function validateMollyActions(raw: unknown, incoming: string, state: MollyState | undefined, query: MollyQuery | null): MollyAction[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 3) throw Error('Invalid Molly actions');
  const actions: MollyAction[] = [], keys = new Set<string>();
  for (const value of raw) {
    const action = value as MollyAction;
    if (!action || typeof action !== 'object' || Array.isArray(action)
      || !['handoff', 'tasks', 'create-group'].includes(action.type)
      || typeof action.sourceMessageId !== 'string' || !action.sourceMessageId.trim()
      || typeof action.evidence !== 'string' || !action.evidence.trim() || action.evidence.length > 2000
      || !incoming.includes(action.evidence)
      || action.scope !== 'current_user' || action.polarity !== 'affirmed'
      || typeof action.confidence !== 'number' || !Number.isFinite(action.confidence) || action.confidence < .9 || action.confidence > 1)
      throw Error('Invalid Molly action evidence');
    const source = state?.messages.find(message => message.id === action.sourceMessageId && message.role === 'user'
      && (state.queue.includes(message.turnId) || state.pending?.id === message.turnId));
    if (!source || !('text' in source.part) || !source.part.text.includes(action.evidence)) throw Error('Molly action lacks current user source');
    let key = action.type as string;
    if (action.type === 'handoff') {
      const person = getCharacter(action.targetId);
      if (!person || !person.services.includes(action.service)
        || typeof action.request !== 'string' || !action.request.trim() || action.request.length > 2000
        || !['new', 'continue-plan', 'confirm-plan'].includes(action.mode)) throw Error('Invalid Molly handoff target');
      // Search interests from a past conversation must not become professional
      // qualifications. Only this turn's explicitly applicable constraints apply here.
      const constraints = structuredClone(query || emptyQuery());
      const gender = explicitGender(incoming);
      if (gender) constraints.gender = gender === 'any' ? null : gender;
      if (!matchMolly(constraints).some(candidate => candidate.id === person.id)) throw Error('Molly handoff violates user constraints');
      key += `:${person.id}`;
      actions.push({type: 'handoff', sourceMessageId: action.sourceMessageId, evidence: action.evidence.trim(),
        scope: 'current_user', polarity: 'affirmed', confidence: action.confidence, targetId: person.id,
        service: action.service, request: action.request.trim(), mode: action.mode});
    } else if (action.type === 'tasks') {
      if (!['today', 'all'].includes(action.taskScope)) throw Error('Invalid Molly task scope');
      actions.push({type: 'tasks', sourceMessageId: action.sourceMessageId, evidence: action.evidence.trim(),
        scope: 'current_user', polarity: 'affirmed', confidence: action.confidence, taskScope: action.taskScope});
    } else {
      if (!Array.isArray(action.memberIds) || action.memberIds.length < 1 || action.memberIds.length > mollyCatalog.length
        || new Set(action.memberIds).size !== action.memberIds.length || action.memberIds.some(id => typeof id !== 'string' || !getCharacter(id))
        || typeof action.goal !== 'string' || !action.goal.trim() || action.goal.length > 1000) throw Error('Invalid Molly group');
      actions.push({type: 'create-group', sourceMessageId: action.sourceMessageId, evidence: action.evidence.trim(),
        scope: 'current_user', polarity: 'affirmed', confidence: action.confidence, memberIds: [...action.memberIds], goal: action.goal.trim()});
    }
    if (keys.has(key)) throw Error('Duplicate Molly action');
    keys.add(key);
  }
  return actions;
}

function explicitGender(incoming: string): MollyOutput['genderDirective'] {
  const text = incoming.replace(/\s+/g, '');
  const desired = new Set<'男' | '女'>();
  const excluded = new Set<'男' | '女'>();
  let unrestricted = false;
  // A noun can have age/trait modifiers between the request and gender. Work
  // within clauses so a later correction replaces an explicitly old request.
  const clauses = text.split(/[，,。！？!?；;\n]|(?=现在|这次|目前|改成|换成)/).filter(Boolean);
  for (const clause of clauses) {
    if (/以前|之前|原来|刚才/.test(clause) && clauses.some(next => /^(?:现在|这次|目前|改成|换成)/.test(next))) continue;
    if (/男女都(?:行|可以|可)|(?:性别|男女)(?:不限|无所谓)|(?:不限|不限制)(?:性别|男女)/.test(clause)) {
      desired.clear(); excluded.clear(); unrestricted = true; continue;
    }
    // Alternatives are a question, not a selected gender.
    if (/(?:男.{0,8}(?:还是|或者|或).{0,8}女|女.{0,8}(?:还是|或者|或).{0,8}男)/.test(clause)) continue;
    const mentions = [...clause.matchAll(/([男女])(?:的|生|人|孩(?:子|儿|纸)?|性|朋友|友|模特|厨师|演员|明星)/g)]
      .map(match => ({gender: match[1] as '男' | '女', index: match.index}));
    if (!mentions.length) {
      const bare = /(?:推荐|找|要|换|选|给我|来)(?:个|一个|位|一位)?([男女])$/.exec(clause);
      if (bare) mentions.push({gender: bare[1] as '男' | '女', index: clause.length - 1});
    }
    for (const match of mentions) {
      const before = clause.slice(0, match.index);
      const gender = match.gender;
      const negated = /(?:不要|别|不想|不需要|不喜欢|不找|不推荐|排除|拒绝)[^男女]{0,30}$/.test(before);
      if (negated) excluded.add(gender);
      else if (/(?:推荐|找|要|换|选|给我|来|只|限)/.test(before) || /^(?:男|女)(?:的|生|人|孩|性)/.test(clause)) {
        if (unrestricted) { desired.clear(); excluded.clear(); unrestricted = false; }
        desired.add(gender);
      }
    }
  }
  if (unrestricted && !desired.size && !excluded.size) return 'any';
  for (const gender of excluded) desired.delete(gender);
  if (desired.size === 1) return [...desired][0];
  if (desired.size > 1) return undefined;
  // Within this verified catalog, an explicit exclusion leaves the other gender.
  return excluded.size === 1 ? ([...excluded][0] === '男' ? '女' : '男') : undefined;
}

const mollyText = (text: string) => text.replace(/[“”‘’"'《》：:]/g, '').trim();

// Conservative guard for recognizable misspellings used to address Molly.
// The dialogue Skill handles broader semantic cases; this never spellchecks
// unrelated names, quoted third parties, or a user's own chosen address.
export function mollyNameCorrection(incoming: string): string | null {
  const typos = /\b(?:Moly|Mollly|Mollyy|Moll|Mlly|Molyl|Molli|Moli)\b/gi;
  for (const match of incoming.matchAll(typos)) {
    const before = incoming.slice(0, match.index).trim();
    const after = incoming.slice(match.index! + match[0].length).trim();
    if (/(?:叫我|称呼我|喊我|管我叫)[\s，,。！？!?]*$/.test(before)) continue;
    const selfName = /(?:你(?:不是)?叫|你的?名字(?:是|叫|写成|拼成)?|称呼你|叫你)[\s，,。！？!?]*$/.test(before);
    if (!selfName && /(?:朋友|同事|他|她|别人|认识|姓名|名字)[^，,。！？!?\n]{0,20}$/.test(before)) continue;
    const rest = after.replace(/^[\s，,。！？!?]+/, '');
    const atStart = !before && (!rest || /^(?:你|请|给我|帮我|找|推荐|你好|嗨|早安|早上好|晚安)/.test(rest)
      || rest === '早' || (/^(?:今天|开心)/.test(rest) && /(?:吗|呢|[？?])\s*$/.test(rest)));
    const atEnd = /^[\s，,。！？!?]*$/.test(after)
      && ((/(?:你|给我|帮我)/.test(before) && /(?:吗|呢|吧|[，,。！？!?])$/.test(before))
        || /(?:你好|嗨|谢谢|晚安|早安)[\s，,。！？!?]*$/.test(before));
    if (selfName || atStart || atEnd) return match[0];
  }
  return null;
}

export function parseMolly(raw: unknown, incoming: string, state?: MollyState): MollyOutput {
  const source = raw as MollyOutput;
  const o = source && {
    intent: source.intent, messages: source.messages, address: source.address,
    query: source.query, replyTo: source.replyTo, candidateIds: source.candidateIds,
    queryMode: source.queryMode, noMatch: source.noMatch,
  } as MollyOutput;
  if (
    !o ||
    !['chat', 'reject', 'search', 'clarify', 'rename', 'operation'].includes(
      o.intent,
    ) ||
    !Array.isArray(o.messages) ||
    o.messages.length > 2 ||
    o.messages.some((t) => typeof t === 'string' ? !t.trim() || t.length > 600 : !t || typeof t !== 'object' || t.type !== 'choice')
  )
    throw Error('Invalid Molly reply');
  if (o.intent === 'rename' && !/(?:叫我|称呼我|喊我|管我叫|把(?:我的)?称呼(?:改|换|设))/i.test(incoming)) {
    // Calling Molly by a name is not a request to rename the user.
    o.intent = 'chat';
    o.address = null;
    o.query = null;
  }
  if (
    o.address !== null &&
    (typeof o.address !== 'string' ||
      o.address.length > 24 ||
      !o.address.trim() ||
      !incoming.includes(o.address))
  )
    throw Error('Unsupported address change');
  if (o.intent !== 'rename') o.address = null;
  if (o.query !== null) {
    const q = o.query;
    if (
      typeof q !== 'object' ||
      ![q.name, q.gender].every((v) => v === null || (typeof v === 'string' && !!v.trim() && v.length <= 120)) ||
      ![null, '男', '女'].includes(q.gender) ||
      ![q.ageMin, q.ageMax].every(
        (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 120),
      ) ||
      !['tags', 'unsupported', 'excluded'].every(
        (k) =>
          Array.isArray(q[k as keyof MollyQuery]) &&
          (q[k as 'tags'] as string[]).length <= 30 &&
          (q[k as 'tags'] as string[]).every(
            (v) => typeof v === 'string' && v.length <= 120,
          ),
      )
      || (q.ageMin !== null && q.ageMax !== null && q.ageMin > q.ageMax)
    )
      throw Error('Invalid search');
    o.query = structuredClone(q);
  }
  if (o.candidateIds !== undefined && (!Array.isArray(o.candidateIds) || o.candidateIds.length > 4 || o.candidateIds.some(id => typeof id !== 'string' || !mollyCatalog.some(c => c.id === id)))) throw Error('Invalid Molly candidates');
  if (o.noMatch !== undefined && typeof o.noMatch !== 'boolean') throw Error('Invalid Molly no-result declaration');
  const actions = validateMollyActions(source.actions, incoming, state, o.query);
  if (actions.length) {
    if (o.intent !== 'operation') throw Error('Molly actions require operation intent');
    if (actions.some(action => action.type === 'handoff' || action.type === 'create-group') && o.candidateIds?.length)
      throw Error('Molly handoff cannot also send contact cards');
    o.actions = actions;
  }
  o.messages = o.messages.map(message => typeof message === 'string' ? mollyText(message) : parseChoicePart(message));
  if (o.messages.some(text => !text)) throw Error('Empty Molly message');
  if (mollyNameCorrection(incoming) && !o.messages.some(message => /\bMolly\b/i.test(typeof message === 'string' ? message : message.text))) {
    // Preserve the generated reaction and recommendation intent. A brief name
    // correction shares the first bubble instead of adding a third message.
    if (o.messages.length) {
      const first = o.messages[0];
      o.messages[0] = typeof first === 'string' ? '是 Molly\n' + first : {...first, text: '是 Molly\n' + first.text};
    }
    else o.messages = ['是 Molly'];
  }
  // A fresh snapshot must not silently clear earlier gender constraints.
  const mayReplace = /重新(?:找|推荐|来|开始)|换(?:个|一个)?(?:需求|条件)|从头|全新需求/.test(incoming);
  const mayClear = /取消|清空|不找了|不用找|别找了/.test(incoming);
  o.queryMode = source.queryMode === 'clear' && mayClear ? 'clear'
    : source.queryMode === 'replace' && mayReplace ? 'replace' : 'refine';
  // Historically operation also stops/clears a search. Keep that reversible
  // flow, but a new secretary operation cannot acknowledge work with no action.
  const stopsSearch = /(?:取消|清空)(?:这次|当前|所有|之前的|之前)?(?:搜索|推荐|找人|筛选|条件)|不找了|不用找|别找了|暂时别聊|(?:暂时|先)?(?:别|不要|不用|停止|暂停)(?:再|给我)?(?:推荐|找人|聊了|聊天|聊)/.test(incoming);
  if (o.intent === 'operation' && !o.actions?.length && !stopsSearch) throw Error('Molly secretary operation requires an action');
  o.genderDirective = explicitGender(incoming);
  if (o.query && o.genderDirective) o.query.gender = o.genderDirective === 'any' ? null : o.genderDirective;
  return o;
}
export function applyMolly(
  state: MollyState,
  out: MollyOutput,
  turnId: string,
) {
  if (out.address) state.address = out.address;
  if (out.query && ['search','clarify','operation'].includes(out.intent)) {
    const query = structuredClone(out.query);
    if (out.queryMode === 'clear') state.query = emptyQuery();
    else {
      query.gender = out.genderDirective === 'any' ? null
        : out.genderDirective || (out.queryMode === 'replace' ? query.gender : state.query.gender || query.gender);
      state.query = query;
    }
  }
  if (out.genderDirective && ['search','clarify','operation'].includes(out.intent) && out.queryMode !== 'clear') {
    // A model's missing query must not bypass an explicit user constraint.
    state.query.gender = out.genderDirective === 'any' ? null : out.genderDirective;
  }
  let lines = out.messages,
    candidates: typeof mollyCatalog = [];
  if (out.intent === 'reject') {
    lines = out.messages.length ? out.messages : ['这项业务不接'];
  } else if (out.intent === 'rename') lines = out.messages.length ? out.messages : ['1'];
  else if (out.intent === 'search') {
    candidates = matchMolly(state.query);
    if (out.candidateIds?.length) {
      const selected = candidates.filter(c => out.candidateIds!.includes(c.id));
      // A mistaken soft selection cannot erase real hard-condition matches or
      // bypass gender/age/exclusions. Keep the verified set if none were valid.
      if (selected.length) candidates = selected;
    }
    lines = candidates.length
      ? (!out.noMatch && out.messages.length ? out.messages : ['把人带走吧'])
      : (out.messages.length ? out.messages : ['这款没有']);
  }
  if (!lines.length) throw Error('Empty reply');
  for (const [index,text] of lines.entries())
    state.messages.push({
      id: crypto.randomUUID(),
      turnId,
      role: 'assistant',
      replyTo: Array.isArray(out.replyTo)&&state.messages.some(m=>m.id===out.replyTo?.[index])?out.replyTo[index]||undefined:undefined,
      at: new Date().toISOString(),
      part: typeof text === 'string' ? { type: 'text', text: mollyText(text) } : text,
    });
  if (candidates.length)
    state.messages[state.messages.length - 1].recommendations = candidates.map(
      (c) => ({
        id: c.id,
        name: c.name,
        avatar: c.avatar,
        detail: [c.age === null ? null : `${c.age}岁`, c.role === 'professional' ? c.responsibility.split('；')[0] : c.personality].filter(Boolean).join(' · '),
      }),
    );
}
