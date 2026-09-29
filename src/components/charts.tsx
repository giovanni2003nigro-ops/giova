import { useCallback, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { diffDays, formatDateShort, formatDayMonth } from '../lib/dates';
import { fmt } from '../lib/stats';
import type { ISODate } from '../types';

const PAD = { left: 40, right: 14, top: 14, bottom: 24 };

function useWidth() {
  const [width, setWidth] = useState(320);
  const observer = useRef<ResizeObserver | null>(null);
  // Callback-Ref: beobachtet auch Elemente, die erst später gerendert werden
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setWidth(el.clientWidth || 320);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 320));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

/** Runde Achsenwerte (1, 2, 5, 10 …) */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function tickDigits(ticks: number[]): number {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

function compact(v: number, digits: number) {
  return Math.abs(v) >= 10000 ? `${fmt(v / 1000, 1)}k` : fmt(v, digits);
}

// ------------------------------------------------------------------ Line chart

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: { x: ISODate; y: number }[];
  dots?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  ariaLabel: string;
  height?: number;
  target?: { value: number; label: string };
  unit?: string;
  digits?: number;
  zeroBased?: boolean;
}

export function LineChart({ series, ariaLabel, height = 180, target, unit = '', digits = 1, zeroBased = false }: LineChartProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<ISODate | null>(null);

  const allX = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(), [series]);
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (target) allY.push(target.value);
  if (!allX.length) return <div className="empty">Noch keine Daten</div>;

  const x0 = allX[0];
  const span = Math.max(1, diffDays(x0, allX[allX.length - 1]));
  const yTicks = niceTicks(zeroBased ? 0 : Math.min(...allY), Math.max(...allY));
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const sx = (d: ISODate) => PAD.left + (allX.length === 1 ? innerW / 2 : (diffDays(x0, d) / span) * innerW);
  const sy = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const td = tickDigits(yTicks);

  const xTickCount = Math.min(allX.length, width < 360 ? 3 : 5);
  const xTicks =
    allX.length <= xTickCount
      ? allX
      : Array.from({ length: xTickCount }, (_, i) => allX[Math.round((i * (allX.length - 1)) / (xTickCount - 1))]);

  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = allX[0];
    let bestDist = Infinity;
    for (const d of allX) {
      const dist = Math.abs(sx(d) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    setHover(best);
  };

  const hoverX = hover ? sx(hover) : 0;

  return (
    <div className="stack">
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <span className="line-key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart" ref={ref}>
        <svg height={height} role="img" aria-label={ariaLabel}>
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={PAD.left - 6} y={sy(t) + 4} textAnchor="end">
                {compact(t, td)}
              </text>
            </g>
          ))}
          <line className="axis-line" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} />
          {xTicks.map((d, i) => (
            <text
              key={d}
              className="tick"
              x={sx(d)}
              y={height - 6}
              textAnchor={xTicks.length > 1 && i === 0 ? 'start' : i === xTicks.length - 1 && xTicks.length > 1 ? 'end' : 'middle'}
            >
              {formatDayMonth(d)}
            </text>
          ))}
          {target && (
            <g>
              <line className="target-line" x1={PAD.left} x2={width - PAD.right} y1={sy(target.value)} y2={sy(target.value)} />
              <text className="target-label" x={PAD.left + 4} y={sy(target.value) - 5} textAnchor="start">
                {target.label}
              </text>
            </g>
          )}
          {series.map((s) => {
            const pts = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {(s.dots || pts.length === 1) &&
                  pts.map((p) => (
                    <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  ))}
              </g>
            );
          })}
          {hover && (
            <g pointerEvents="none">
              <line className="crosshair" x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hover);
                return p ? <circle key={s.key} cx={hoverX} cy={sy(p.y)} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
              })}
            </g>
          )}
          <rect
            x={PAD.left - 10}
            y={0}
            width={innerW + 20}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover && (
          <div className="chart-tooltip" style={{ left: Math.min(Math.max(0, hoverX - 70), width - 150) }}>
            <div className="tt-date">{formatDateShort(hover)}</div>
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hover);
              return p ? (
                <div className="tt-row" key={s.key}>
                  <span className="line-key" style={{ background: s.color }} />
                  <strong>
                    {fmt(p.y, digits)}
                    {unit}
                  </strong>
                  <span className="muted">{s.label}</span>
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Als Tabelle anzeigen</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th>Datum</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...allX].reverse().map((d) => (
              <tr key={d}>
                <td>{formatDateShort(d)}</td>
                {series.map((s) => {
                  const p = s.points.find((q) => q.x === d);
                  return <td key={s.key}>{p ? `${fmt(p.y, digits)}${unit}` : '–'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ Bar chart

export interface BarDatum {
  x: string;
  y: number | null;
}

interface BarChartProps {
  bars: BarDatum[];
  ariaLabel: string;
  color?: string;
  height?: number;
  target?: { value: number; label: string };
  unit?: string;
  digits?: number;
  formatX?: (x: string) => string;
  formatTooltipX?: (x: string) => string;
  valueLabel?: string;
}

export function BarChart({
  bars,
  ariaLabel,
  color = 'var(--series-1)',
  height = 170,
  target,
  unit = '',
  digits = 0,
  formatX = formatDayMonth,
  formatTooltipX = formatDateShort,
  valueLabel = 'Wert',
}: BarChartProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const values = bars.map((b) => b.y ?? 0);
  if (target) values.push(target.value);
  const yTicks = niceTicks(0, Math.max(1, ...values));
  const yMax = yTicks[yTicks.length - 1];
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, bars.length);
  const bw = Math.max(3, Math.min(24, band - 2));
  const sy = (v: number) => PAD.top + innerH - (v / (yMax || 1)) * innerH;
  const base = PAD.top + innerH;
  const td = tickDigits(yTicks);
  const labelEvery = Math.ceil(bars.length / (width < 360 ? 5 : 8));

  return (
    <div className="stack">
      <div className="chart" ref={ref}>
        <svg height={height} role="img" aria-label={ariaLabel}>
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={PAD.left - 6} y={sy(t) + 4} textAnchor="end">
                {compact(t, td)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = PAD.left + band * i + band / 2;
            const showLabel = (bars.length - 1 - i) % labelEvery === 0;
            const h = b.y ? base - sy(b.y) : 0;
            const r = Math.min(4, bw / 2, h);
            const x = cx - bw / 2;
            const top = base - h;
            const d = h
              ? `M${x},${base}L${x},${top + r}Q${x},${top} ${x + r},${top}L${x + bw - r},${top}Q${x + bw},${top} ${x + bw},${top + r}L${x + bw},${base}Z`
              : '';
            return (
              <g key={b.x}>
                {d && <path d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
                {showLabel && (
                  <text className="tick" x={cx} y={height - 6} textAnchor="middle">
                    {formatX(b.x)}
                  </text>
                )}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={innerH + 6}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatTooltipX(b.x)}: ${b.y == null ? 'keine Daten' : `${fmt(b.y, digits)}${unit}`}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line className="axis-line" x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} />
          {target && (
            <g pointerEvents="none">
              <line className="target-line" x1={PAD.left} x2={width - PAD.right} y1={sy(target.value)} y2={sy(target.value)} />
              <text className="target-label" x={PAD.left + 4} y={sy(target.value) - 5} textAnchor="start">
                {target.label}
              </text>
            </g>
          )}
        </svg>
        {hover !== null && bars[hover] && (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(Math.max(0, PAD.left + band * hover + band / 2 - 60), width - 130) }}
          >
            <div className="tt-date">{formatTooltipX(bars[hover].x)}</div>
            <div className="tt-row">
              <strong>{bars[hover].y == null ? 'keine Daten' : `${fmt(bars[hover].y!, digits)}${unit}`}</strong>
              <span className="muted">{valueLabel}</span>
            </div>
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Als Tabelle anzeigen</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th>Zeitraum</th>
              <th>{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {[...bars].reverse().map((b) => (
              <tr key={b.x}>
                <td>{formatTooltipX(b.x)}</td>
                <td>{b.y == null ? '–' : `${fmt(b.y, digits)}${unit}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
