import type { YuanState } from './yuan-xiaoman';
import { ensureContact, contactDecision, contactUserActivity } from './contact-life';

// Assistant-proposed scheduling defaults, not character sleep/work facts.
export const yuanProactivePolicy = {
  version: 2, firstDelayMs: 3600000,
  source: '2026-09-20 user_required: daily close contact, awake hours, one follow-up and continuous life; timings are implementation defaults.',
};
export type YuanProactive = {
  enabled: boolean; nextAt: number; sentAt: number[];
  waitForUser: boolean; lastAttemptAt: number; lastError: string;
  version?: number;
};
export function ensureYuanProactive(s: YuanState, now: number): YuanProactive {
  const c = ensureContact(s, now);
  if (!s.proactive) s.proactive = { enabled: c.enabled, nextAt: c.nextAt, sentAt: [], waitForUser: false, lastAttemptAt: 0, lastError: '', version: 2 };
  const p = s.proactive;
  if (p.version !== 2) {
    c.enabled = p.enabled; c.sentAt = [...p.sentAt];
    p.version = 2; p.nextAt = c.nextAt; p.waitForUser = false;
  }
  c.enabled = p.enabled;
  return p;
}
export function yuanUserActivity(s: YuanState, text: string, now: number) {
  const p = ensureYuanProactive(s, now);
  contactUserActivity(s, text, now);
  p.enabled = s.contactLife!.enabled; p.waitForUser = false; p.nextAt = s.contactLife!.nextAt;
}
export function yuanProactiveDue(s: YuanState, now: number) {
  ensureYuanProactive(s, now);
  if (s.queue.length ||
      (s.pending && now - s.pending.since < 180000) || s.retryAt > now ||
      Object.values(s.typing).some(t => t.until > now) ||
      !s.messages.some(m => m.role === 'user') ||
      s.messages.some(m => m.role === 'assistant' && (m.deliverAt || 0) > now)) return false;
  return contactDecision(s, now).kind !== null;
}
export function finishYuanProactive(s: YuanState, now: number, sent: boolean) {
  const p = ensureYuanProactive(s, now);
  const c = s.contactLife!;
  p.nextAt = c.nextAt; p.lastError = ''; p.sentAt = c.sentAt; p.waitForUser = !!c.waiting;
  if (!sent) p.nextAt = c.nextAt = now + yuanProactivePolicy.firstDelayMs;
}
