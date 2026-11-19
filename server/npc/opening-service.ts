import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage} from '../../lib/npc/contracts';
import {OPENING_CHARACTER_IDS, openingCharacterId, openingFor, type OpeningCharacterId} from '../../lib/npc/opening';
import {scheduleDelivery} from '../../lib/npc/delivery';
import {createMolly} from '../../lib/npc/molly';
import {createState} from '../../lib/npc/engine';
import {createYuan} from '../../lib/npc/yuan-xiaoman';
import {createHe} from '../../lib/npc/he-jiawei';
import {createChen} from '../../lib/npc/chen-nian';
import {createLiu} from '../../lib/npc/liu';
import {createChef} from '../../lib/npc/zhou-chef';

type OpeningState = {messages: ChatMessage[]; revision?: number; [key: string]: unknown};
type OpeningRow = {owner: string; npc_id: OpeningCharacterId; version: number; status: string; due_at: number | null};
export type OpeningServiceOptions = {
  rng?: () => number;
  /** May disable artwork for a deployment without the bundled placeholder. */
  teamCardReady?: () => boolean;
};
const sessions = {
  molly: {table: 'molly_sessions', suffix: 'molly-system-secretary', create: () => createMolly()},
  'xia-xia': {table: 'sessions', suffix: 'xia-xia:normal', create: () => createState('normal')},
  'yuan-xiaoman': {table: 'yuan_sessions', suffix: 'yuan-xiaoman', create: (now: number) => createYuan(now)},
  'he-jiawei': {table: 'he_sessions', suffix: 'he-jiawei', create: () => createHe()},
  'chen-nian': {table: 'chen_sessions', suffix: 'chen-nian', create: () => createChen()},
  liu: {table: 'liu_sessions', suffix: 'liu', create: (now: number) => createLiu(now)},
  'zhou-chef': {table: 'zhou_chef_sessions', suffix: 'zhou-chef', create: () => createChef()},
} as const;
const proactiveDelay: Partial<Record<OpeningCharacterId, number>> = {'yuan-xiaoman': 60_000, 'xia-xia': 90_000};
export const openingTurnId = (id: OpeningCharacterId, version: number) => `fixed-opening:${id}:v${version}`;
export function isFixedOpeningMessage(message: Pick<ChatMessage, 'turnId'>): boolean {
  return /^fixed-opening:(?:molly|yuan-xiaoman|xia-xia|he-jiawei|chen-nian|liu|zhou-chef):v\d+$/u.test(message.turnId);
}
let savepointSequence = 0;

/** Literal host delivery bypasses every model parser/guard. Only registration
 * grants eligibility; a first GET never infers that an old owner is new. */
export class OpeningService {
  constructor(private db: DatabaseSync, _root: string, private now: () => number = Date.now, private options: OpeningServiceOptions = {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS npc_experience_onboarding(owner TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS npc_opening_accounts(owner TEXT PRIMARY KEY,registered_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS npc_opening_states(owner TEXT NOT NULL,npc_id TEXT NOT NULL,version INTEGER NOT NULL,
        status TEXT NOT NULL,due_at INTEGER,started_at INTEGER,cancelled_at INTEGER,PRIMARY KEY(owner,npc_id));`);
  }
  private atomic<T>(run: () => T): T {
    const key = `fixed_opening_${++savepointSequence}`;
    this.db.exec(`SAVEPOINT ${key}`);
    try {const result = run(); this.db.exec(`RELEASE ${key}`); return result;}
    catch (error) {this.db.exec(`ROLLBACK TO ${key}; RELEASE ${key}`); throw error;}
  }
  private tableExists(table: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  }
  private read(owner: string, id: OpeningCharacterId): OpeningState | null {
    const info = sessions[id];
    if (!this.tableExists(info.table)) return null;
    const row = this.db.prepare(`SELECT data FROM ${info.table} WHERE id=?`).get(`${owner}:${info.suffix}`) as {data: string} | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.data) as OpeningState;
    if (!Array.isArray(parsed.messages)) throw Error('已有对话数据格式无效，未写入开场白');
    return parsed;
  }
  private save(owner: string, id: OpeningCharacterId, state: OpeningState): void {
    const info = sessions[id], key = `${owner}:${info.suffix}`;
    state.revision = (state.revision || 0) + 1;
    if (id === 'xia-xia') {
      this.db.exec('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL)');
      this.db.prepare('INSERT INTO sessions(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data')
        .run(key, state.revision, JSON.stringify(state));
    } else {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${info.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
      this.db.prepare(`INSERT INTO ${info.table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(key, JSON.stringify(state));
    }
  }
  private eligible(owner: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM npc_opening_accounts WHERE owner=?').get(owner);
  }
  /** Only a trusted fresh-account hook may call this, in its transaction. */
  initializeRegistration(owner: string, claimedLegacy = false): boolean {
    return this.atomic(() => {
      if (!owner || this.db.prepare('SELECT 1 FROM npc_experience_onboarding WHERE owner=?').get(owner) || this.eligible(owner)) return false;
      const now = this.now();
      const existing = OPENING_CHARACTER_IDS.some(id => (this.read(owner, id)?.messages.length || 0) > 0);
      if (claimedLegacy || existing) {
        this.db.prepare('INSERT OR IGNORE INTO npc_experience_onboarding(owner,at) VALUES(?,?)').run(owner, now);
        return false;
      }
      this.db.prepare('INSERT INTO npc_opening_accounts(owner,registered_at) VALUES(?,?)').run(owner, now);
      this.db.prepare('INSERT INTO npc_experience_onboarding(owner,at) VALUES(?,?)').run(owner, now);
      for (const id of OPENING_CHARACTER_IDS) this.db.prepare('INSERT INTO npc_opening_states(owner,npc_id,version,status,due_at) VALUES(?,?,?,?,?)')
        .run(owner, id, openingFor(id).version, 'waiting', id === 'molly' ? now : proactiveDelay[id] ? now + proactiveDelay[id]! : null);
      this.start(owner, 'molly', now);
      return true;
    });
  }
  private start(owner: string, id: OpeningCharacterId, now: number): boolean {
    const row = this.db.prepare('SELECT * FROM npc_opening_states WHERE owner=? AND npc_id=?').get(owner, id) as OpeningRow | undefined;
    if (!row || row.status !== 'waiting') return false;
    const current = this.read(owner, id);
    // A speech accepted by another worker wins over an unsolicited introduction.
    if (current?.messages.some(message => message.role === 'user') || current?.messages.some(isFixedOpeningMessage)) {
      this.db.prepare("UPDATE npc_opening_states SET status='cancelled',cancelled_at=? WHERE owner=? AND npc_id=?").run(now, owner, id);
      return false;
    }
    const state = current || sessions[id].create(now) as OpeningState;
    const from = state.messages.length, version = row.version;
    for (const [index, entry] of openingFor(id).messages.entries()) {
      if (typeof entry !== 'string' && this.options.teamCardReady?.() === false) continue;
      state.messages.push({id: `fixed-opening-${id}-v${version}-${index + 1}`, turnId: openingTurnId(id, version), role: 'assistant',
        at: new Date(now).toISOString(), origin: 'proactive', part: typeof entry === 'string' ? {type: 'text', text: entry} : {...entry},
        secretaryEvent: {id: `opening:${id}:v${version}:${index + 1}`, kind: 'opening'}});
    }
    scheduleDelivery(state.messages, from, now, now, {characterId: id, rng: this.options.rng});
    this.save(owner, id, state);
    this.db.prepare("UPDATE npc_opening_states SET status='queued',started_at=? WHERE owner=? AND npc_id=? AND status='waiting'").run(now, owner, id);
    return true;
  }
  /** The four non-proactive introductions start on first private-chat GET. */
  open(owner: string, inputId: string): boolean {
    const id = openingCharacterId(inputId);
    if (!id || !this.eligible(owner) || id === 'molly' || proactiveDelay[id]) return false;
    return this.atomic(() => this.start(owner, id, this.now()));
  }
  /** Call before accepting actual user input and before reading its chat state.
   * Keep delivered history, physically remove future opening bubbles, so neither
   * deliveryView nor a later poll can show stale typing or cancelled messages. */
  noteUserSpeech(owner: string, inputId: string, currentState?: {messages: ChatMessage[]}): boolean {
    const id = openingCharacterId(inputId);
    if (!id || !this.eligible(owner)) return false;
    return this.atomic(() => {
      const row = this.db.prepare('SELECT * FROM npc_opening_states WHERE owner=? AND npc_id=?').get(owner, id) as OpeningRow | undefined;
      if (!row || row.status === 'cancelled' || row.status === 'sent') return false;
      const now = this.now(), state = currentState || this.read(owner, id);
      if (state) {
        const kept = state.messages.filter(message => !(isFixedOpeningMessage(message) && (message.deliverAt || 0) > now));
        if (kept.length !== state.messages.length) {
          state.messages = kept;
          if (!currentState) this.save(owner, id, state as OpeningState);
        }
      }
      this.db.prepare("UPDATE npc_opening_states SET status='cancelled',cancelled_at=? WHERE owner=? AND npc_id=?").run(now, owner, id);
      return true;
    });
  }
  /** Same-connection GET polling or a background timer drives delayed contacts. */
  tick(owner?: string): number {
    return this.atomic(() => {
      const now = this.now(); let started = 0;
      const rows = this.db.prepare(`SELECT * FROM npc_opening_states WHERE status IN ('waiting','queued')${owner === undefined ? '' : ' AND owner=?'}`)
        .all(...(owner === undefined ? [] : [owner])) as OpeningRow[];
      for (const row of rows) {
        if (row.status === 'waiting' && row.due_at !== null && row.due_at <= now) {
          if (this.start(row.owner, row.npc_id, now)) started++;
        } else if (row.status === 'queued') {
          const state = this.read(row.owner, row.npc_id);
          if (state && !state.messages.some(message => isFixedOpeningMessage(message) && (message.deliverAt || 0) > now))
            this.db.prepare("UPDATE npc_opening_states SET status='sent' WHERE owner=? AND npc_id=? AND status='queued'").run(row.owner, row.npc_id);
        }
      }
      return started;
    });
  }
}
const services = new WeakMap<DatabaseSync, OpeningService>();
export function openingServiceFor(db: DatabaseSync, root: string, now?: () => number): OpeningService {
  let service = services.get(db);
  // A first accepted POST can instantiate this service inside the caller's
  // transaction. If that transaction rolls back schema creation as well, the
  // cached service must not poison the next request with missing-table errors.
  if (service && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='npc_opening_accounts'").get()) service = undefined;
  if (!service) {service = new OpeningService(db, root, now); services.set(db, service);}
  return service;
}
