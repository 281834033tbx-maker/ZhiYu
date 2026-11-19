'use client';

import { Check } from 'lucide-react';
import './demo-order-change-card.css';

export type DemoOrderChangeCardProps = {
  confirmed: boolean;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
};

/** A controlled presentation card; the parent owns the demonstration state. */
export default function DemoOrderChangeCard({ confirmed, busy, error, onConfirm }: DemoOrderChangeCardProps) {
  return <section className="zy-demo-order-card" aria-label="买菜订单改期" aria-busy={busy}>
    <div className="zy-demo-order-copy">
      <strong>买菜订单改期</strong>
      <p>今晚 18:00 → 明早 10:00 下单 · 11:00 送达</p>
    </div>
    <button type="button" disabled={confirmed || busy} onClick={onConfirm}>
      {confirmed && <Check size={14} aria-hidden="true"/>}
      {confirmed ? '已更换' : busy ? '更换中…' : '确认更换'}
    </button>
    {error && <p className="zy-demo-order-error" role="alert">{error}</p>}
  </section>;
}
