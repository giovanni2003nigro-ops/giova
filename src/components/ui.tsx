import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Recommendation } from '../lib/analysis';
import { SEVERITY_LABELS } from '../lib/analysis';
import { addDays, relativeDay, today } from '../lib/dates';
import { fmt } from '../lib/stats';
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconInfo, IconOctagon } from './icons';

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Meter({
  label,
  value,
  target,
  unit = '',
  digits = 0,
  compact = false,
}: {
  label: string;
  value: number;
  target: number;
  unit?: string;
  digits?: number;
  /** Label und Wert untereinander – für schmale Spalten */
  compact?: boolean;
}) {
  const ratio = target > 0 ? value / target : 0;
  const over = ratio > 1.1;
  const rest = target - value;
  return (
    <div className={`meter ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="tnum">
          <span className="v">{fmt(value, digits)}</span>
          <span className="muted">
            {' '}
            / {fmt(target, digits)}
            {unit}
          </span>
        </span>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.round(value)}
        aria-label={label}
      >
        <div className="meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="tiny muted">
        {over
          ? `${fmt(-rest, digits)}${unit} über Ziel`
          : rest > 0
            ? `noch ${fmt(rest, digits)}${unit}`
            : 'Ziel erreicht'}
      </div>
    </div>
  );
}

export function Stat({ label, value, unit, delta, tile = false }: { label: string; value: ReactNode; unit?: string; delta?: ReactNode; tile?: boolean }) {
  // „7,76 km“ → große Zahl, kleine Einheit (passt auch bei breiten Schriften in die Kachel)
  const split = !unit && typeof value === 'string' ? /^([+−-]?[\d.,:]+)\s(\S.{0,8})$/.exec(value) : null;
  if (split) {
    value = split[1];
    unit = split[2];
  }
  return (
    <div className={`stat ${tile ? 'stat-tile' : ''}`}>
      <span className="label">{label}</span>
      <span className="value">
        {value}
        {unit && <small> {unit}</small>}
      </span>
      {delta && <span className="delta">{delta}</span>}
    </div>
  );
}

let openSheets = 0;

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Neueste onClose-Funktion merken, ohne den Effekt bei jedem Rendern neu zu starten
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    openSheets++;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      // Erst wenn das letzte Fenster zu ist, darf die Seite wieder scrollen
      if (--openSheets === 0) document.body.style.overflow = '';
    };
  }, []);
  // Immer direkt in <body> rendern: In der Kopfzeile (backdrop-filter) oder in Karten würde „position: fixed“
  // sonst am Elternelement hängen bleiben – das Fenster wäre abgeschnitten und die Seite blockiert.
  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Zahleneingabe mit großen +/– Tasten – praktisch mit verschwitzten Fingern im Gym. */
export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  label,
  decimals = 1,
}: {
  value: number | '';
  onChange: (v: number | '') => void;
  step: number;
  min?: number;
  label: string;
  decimals?: number;
}) {
  const bump = (d: number) => {
    const cur = value === '' ? 0 : value;
    const next = Math.max(min, Math.round((cur + d) * 10 ** decimals) / 10 ** decimals);
    onChange(next);
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => bump(-step)} aria-label={`${label} verringern`}>
        −
      </button>
      <input
        className="input big tnum"
        inputMode="decimal"
        aria-label={label}
        value={value === '' ? '' : String(value).replace('.', ',')}
        onChange={(e) => {
          const raw = e.target.value.replace(',', '.').trim();
          if (raw === '') return onChange('');
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      <button type="button" onClick={() => bump(step)} aria-label={`${label} erhöhen`}>
        +
      </button>
    </div>
  );
}

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const isToday = date === today();
  return (
    <div className="row between">
      <button className="icon-btn" onClick={() => onChange(addDays(date, -1))} aria-label="Vorheriger Tag">
        <IconChevronLeft />
      </button>
      <label className="row" style={{ gap: 6, cursor: 'pointer', position: 'relative' }}>
        <strong>{relativeDay(date)}</strong>
        {!isToday && <span className="muted small">{date.split('-').reverse().join('.')}</span>}
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          aria-label="Datum wählen"
        />
      </label>
      <button className="icon-btn" onClick={() => onChange(addDays(date, 1))} disabled={isToday} aria-label="Nächster Tag" style={{ opacity: isToday ? 0.3 : 1 }}>
        <IconChevronRight />
      </button>
    </div>
  );
}

const SEVERITY_ICON = { ok: IconCheck, info: IconInfo, warn: IconAlert, alert: IconOctagon };

export function RecommendationItem({ rec }: { rec: Recommendation }) {
  const Icon = SEVERITY_ICON[rec.severity];
  return (
    <div className={`rec ${rec.severity}`}>
      <Icon className="rec-icon" aria-label={SEVERITY_LABELS[rec.severity]} />
      <div className="grow">
        <h3>{rec.title}</h3>
        <p>{rec.detail}</p>
        {rec.actions.length > 0 && (
          <ul>
            {rec.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="error-box" role="alert">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ Toasts
type ToastListener = (msg: string) => void;
const listeners = new Set<ToastListener>();

export function toast(msg: string) {
  listeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    const l: ToastListener = (msg) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs, { id, msg }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/** Wandelt eine Eingabe mit Komma in eine Zahl um. */
export function parseNum(v: string): number | '' {
  const raw = v.replace(',', '.').trim();
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isNaN(n) ? '' : n;
}

export function NumField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | '';
  onChange: (v: number | '') => void;
  suffix?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === '' ? '' : String(value).replace('.', ','));
  useEffect(() => {
    // Nur synchronisieren, wenn sich der Wert von außen geändert hat (nicht bei Teileingaben wie "-" oder "1,")
    const parsed = parseNum(text);
    const same = parsed === value || (parsed === '' && (value === '' || value === 0));
    if (!same) setText(value === '' ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span>
        {label}
        {suffix && <span className="muted"> ({suffix})</span>}
      </span>
      <input
        className="input tnum"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNum(e.target.value));
        }}
      />
    </label>
  );
}
