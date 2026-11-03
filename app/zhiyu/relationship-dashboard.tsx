'use client';

import { ArrowLeft } from 'lucide-react';
import type { CoreRelationshipValues } from '../../lib/npc/relationship-values';
import { RELATIONSHIP_UNLOCKS } from '../../lib/npc/relationship-values';
import './relationship-dashboard.css';

const labels = {
  familiarity: ['熟悉度', '彼此了解与共同经历'],
  affection: ['好感度', '角色对互动的积极感受'],
  trust: ['信任度', '边界尊重与言行可靠'],
  comfort: ['舒适度', '相处时的自在程度'],
} as const;

export default function RelationshipDashboard({
  name,
  values,
  relationship,
  loading = false,
  onBack,
}: {
  name: string;
  values?: CoreRelationshipValues;
  relationship?: string;
  loading?: boolean;
  onBack: () => void;
}) {
  const ready = values && Object.values(values).some(value => value !== null);
  const photoGate = RELATIONSHIP_UNLOCKS.dailyPhoto;
  const closeGate = RELATIONSHIP_UNLOCKS.closeInteraction;
  const photoOpen = ready && Object.entries(photoGate).every(([key, threshold]) => (values[key as keyof CoreRelationshipValues] ?? 0) >= threshold);
  const intimateScoreOpen = ready && Object.entries(closeGate).every(([key, threshold]) => (values[key as keyof CoreRelationshipValues] ?? 0) >= threshold);
  const lover = relationship === 'lovers';

  return <section className="relationship-dashboard" aria-label={`${name}的隐藏数值`}>
    <div className="relationship-dashboard-head">
      <button type="button" onClick={onBack}><ArrowLeft size={17}/>返回聊天</button>
      <span>{name}的隐藏数值</span>
    </div>
    <div className="relationship-dashboard-content">
      <div className="relationship-intro">
        <span className="relationship-kicker">RELATIONSHIP</span>
        <h2>隐藏数值</h2>
        <p>这些数值记录你们这段对话里的相处变化，不是对你的评价。</p>
      </div>
      <div className="relationship-values">
        {(Object.keys(labels) as (keyof typeof labels)[]).map(key => {
          const value = values?.[key] ?? null;
          return <article className="relationship-value" key={key}>
            <div className="relationship-value-copy"><div><strong>{labels[key][0]}</strong><small>{labels[key][1]}</small></div><b>{value === null ? '—' : value}</b></div>
            <div className="relationship-track" role={value === null ? undefined : 'progressbar'} aria-label={value === null ? undefined : labels[key][0]} aria-valuemin={value === null ? undefined : 0} aria-valuemax={value === null ? undefined : 100} aria-valuenow={value === null ? undefined : value}><i style={{ width: `${value ?? 0}%` }}/></div>
          </article>;
        })}
      </div>
      {!ready && <output className="relationship-unavailable">{loading ? '正在读取关系数值…' : `${name}的关系数值暂未接入，当前没有可显示的分数。`}</output>}
      {ready && <div className="relationship-unlocks">
        <h3>相处里程碑</h3>
        <article className={'relationship-unlock-card ' + (photoOpen ? 'is-open' : '')}>
          <span className="relationship-unlock-icon">✦</span><div><strong>生活照片分享</strong><p>{photoOpen ? '已达到基础条件；人物会在合适的生活分享中自主选择是否配图。' : `熟悉 ${photoGate.familiarity} · 好感 ${photoGate.affection} · 信任 ${photoGate.trust} · 舒适 ${photoGate.comfort}`}</p></div><small>{photoOpen ? '可触发' : '培养中'}</small>
        </article>
        <article className={'relationship-unlock-card ' + (intimateScoreOpen && lover ? 'is-open' : '')}>
          <span className="relationship-unlock-icon">♡</span><div><strong>更亲密的互动</strong><p>{intimateScoreOpen && lover ? '数值与关系阶段已满足基础条件；仍以双方意愿和角色边界为准。' : `好感 ${closeGate.affection} · 信任 ${closeGate.trust} · 舒适 ${closeGate.comfort}，并需双方确认恋人关系。`}</p></div><small>{intimateScoreOpen && lover ? '基础条件满足' : '培养中'}</small>
        </article>
      </div>}
      {ready && <p className="relationship-footnote">分数通过具体互动缓慢变化；单纯重复发消息不会涨分。达到门槛代表具备触发条件，不代表人物必须采取某种行动。</p>}
    </div>
  </section>;
}
