import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage} from '../../lib/npc/contracts';
import {isDialogueCrisisInput} from '../../lib/npc/dialogue-output-guard';
import {contactUserActivity,type ContactHost} from '../../lib/npc/contact-life';
import {DialoguePreferencesStore, dialoguePreferencesFor} from './dialogue-preferences';
import {openingServiceFor, isFixedOpeningMessage} from './opening-service';

const preferences = new WeakMap<DatabaseSync, DialoguePreferencesStore>();
export function privatePreferences(db: DatabaseSync, root: string, clock: () => number = Date.now) {
  const bound = dialoguePreferencesFor(root);
  if (bound) return bound.using(db);
  let store = preferences.get(db);
  if (!store) {store = new DialoguePreferencesStore(db, clock); preferences.set(db, store);}
  return store;
}

/** GET may start an eligible fixed introduction. It never makes an old owner
 * eligible and must run before the caller loads its private state. */
export function openPrivateDialogue(db: DatabaseSync, root: string, owner: string, npc: string, clock: () => number = Date.now) {
  const service = openingServiceFor(db, root, clock);
  service.tick(owner);
  service.open(owner, npc);
}

export function hasXiaomanOpeningConsentContext(messages: ChatMessage[], now: number) {
  // Earlier user input must not turn an unrelated later "好" into consent.
  const history = messages.filter(message => !message.deliverAt || message.deliverAt <= now);
  const latest = history.at(-1);
  if (!latest || latest.role !== 'assistant' || !isFixedOpeningMessage(latest)) return false;
  const sinceUser = history.slice(history.findLastIndex(message => message.role === 'user') + 1);
  return sinceUser.some(message => message.secretaryEvent?.id === 'opening:yuan-xiaoman:v1:4');
}

/** Call inside the real ordinary-send save transaction, after validation and
 * duplicate checks. Model JSON, typing, imports and retry do not set preference
 * or cancel an introduction. Neither service modifies the accepted input. */
export function commitPrivateDialogueInput(db: DatabaseSync, root: string, owner: string, npc: string,
  state: {messages: ChatMessage[]}, incoming: string, persist: () => void, clock: () => number = Date.now) {
  const store = privatePreferences(db, root, clock);
  return store.atomic(() => {
    const agreement = npc === 'yuan-xiaoman' && hasXiaomanOpeningConsentContext(state.messages.slice(0,-1), clock());
    openingServiceFor(db, root, clock).noteUserSpeech(owner, npc, state);
    const message = state.messages.at(-1);
    const text = message?.role === 'user' && 'text' in message.part ? message.part.text : incoming;
    store.applyIncoming(owner, npc, text, {agreeToXiaomanOpening: agreement});
    // These three private engines did not previously have a life-contact loop.
    // Once explicitly opted into supervision, real replies must clear the same
    // waiting/cooldown ledger; otherwise the first reminder would block forever.
    if(['he-jiawei','chen-nian','zhou-chef'].includes(npc)&&'contactLife' in state&&state.contactLife)
      contactUserActivity(state as ContactHost,text,clock());
    persist();
  });
}

/** Trusted context stays outside user text. Each generation/review receives the
 * same effective preference and read-only snapshot; the first identity line is
 * left in place for the existing character/secretary protocol selection. */
export function privateDialoguePrompt(db: DatabaseSync, root: string, owner: string, npc: string, prompt: string,
  incoming: string, proactive = false, clock: () => number = Date.now) {
  const context=privatePreferences(db, root, clock).prompt(owner, npc, {
    channel: 'private', proactive, crisis: isDialogueCrisisInput(incoming),
  });
  // The last current-input marker owns its JSON suffix. Appending context there
  // would break scene extraction and could suppress crisis/comfort routing.
  const line=prompt.indexOf('\n');
  return line<0?prompt+'\n'+context:prompt.slice(0,line)+'\n'+context+'\n'+prompt.slice(line+1);
}
