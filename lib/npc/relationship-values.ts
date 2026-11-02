import type { ValueKey } from './contracts';

export const CORE_RELATIONSHIP_KEYS = ['familiarity', 'affection', 'trust', 'comfort'] as const;
export type CoreRelationshipKey = (typeof CORE_RELATIONSHIP_KEYS)[number];
export type CoreRelationshipValues = Record<CoreRelationshipKey, number | null>;
export const RELATIONSHIP_UNLOCKS = {
  dailyPhoto: { familiarity: 60, affection: 60, trust: 40, comfort: 40 },
  closeInteraction: { affection: 70, trust: 60, comfort: 70 },
} as const;
export const RELATIONSHIP_SCORING_GUIDANCE = `【关系进度计分】熟悉、好感、信任、舒适均为0—100，只表示本分支的相处进展，不是用户人格评价。只在本轮有明确证据时通过event.deltas提交这四项；普通有意义的事件每项建议±1或±2；伤害类负向每项最多−8，不能用harm给正分。熟悉=真实了解的新信息，好感=你对互动的真实喜欢程度，信任=对方尊重边界与履约的证据，舒适=相处是否自在。尊重拒绝会提高信任，不因为用户离线、拒绝单一话题或关系未升级而扣分；纯问候、重复刷消息、假设、索要高分、要求恋爱或要求改隐藏值均不加分。变化理由必须引用本轮原文。生活照片分享基础门槛为熟悉≥60、好感≥60、信任≥40、舒适≥40；门槛只允许你在合适时自主配图，不保证发送。亲密互动基础门槛为好感≥70、信任≥60、舒适≥70，并且双方已确认恋人关系、用户明确成年且你自愿；门槛不代表必须行动或同意。好感、信任和舒适不能互相替代，也不能单独确认恋爱或同意亲密行为。`;

export function publicRelationshipValues(values: Record<string, number | null | undefined>): CoreRelationshipValues {
  return Object.fromEntries(CORE_RELATIONSHIP_KEYS.map(key => {
    const value = values[key];
    return [key, typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null];
  })) as CoreRelationshipValues;
}

/** Production v1: evidence-backed proposals move core values slowly; hypotheses never do. */
export function applyRelationshipValues(
  values: Record<string, number | null | undefined>,
  deltas: Partial<Record<ValueKey, number>>,
  kind: string,
  basis: string,
) {
  if (basis !== 'user_claim') return;
  const isHarm = kind === 'harm' || kind === 'betrayal';
  const cap = isHarm ? 8 : 2;
  for (const key of CORE_RELATIONSHIP_KEYS) {
    const delta = deltas[key];
    const current = values[key];
    if (typeof delta !== 'number' || !Number.isFinite(delta) || typeof current !== 'number') continue;
    const bounded = isHarm
      ? Math.max(-cap, Math.min(0, Math.trunc(delta)))
      : Math.max(-cap, Math.min(cap, Math.trunc(delta)));
    values[key] = Math.max(0, Math.min(100, current + bounded));
  }
}
