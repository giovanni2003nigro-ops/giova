import type { CSSProperties } from 'react';
import { TIERS } from '../lib/leagues';

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#8a4fd8', '#d4a017', '#d03b3b', '#2b9fa8'];

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  if (url) return <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

export function TierBadge({ tier, large = false }: { tier: number; large?: boolean }) {
  const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))];
  return (
    <span className={`tier-badge ${large ? 'large' : ''}`} style={{ '--tier': t.color } as CSSProperties}>
      <span aria-hidden="true">{t.emoji}</span> {t.label}
    </span>
  );
}
