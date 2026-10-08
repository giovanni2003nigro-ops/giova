import { InfoBang } from './InfoBang';
import { useRef, useState } from 'react';
import type { NewActivity } from '../activities';
import { useObjectUrl } from '../hooks';
import { toISODate } from '../lib/dates';
import { compressImage } from '../lib/image';
import { POINTS_RULES, activityPoints } from '../lib/points';
import { formatClock, parseClock, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { HyroxData, Sport, Visibility } from '../types';
import { SPORTS, VISIBILITY_LABELS } from '../types';
import { IconCamera, IconTrash } from './icons';
import { NumField, Seg, toast } from './ui';
import { SportIcon } from './SportIcon';

export type ActivityDraft = NewActivity;

const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Formular für neue, importierte oder aufgezeichnete Aktivitäten. */
export function ActivityEditor({
  initial,
  onSubmit,
  submitLabel = 'Speichern',
  hasTrack = false,
  lockSport = false,
}: {
  initial: ActivityDraft;
  onSubmit: (draft: ActivityDraft) => Promise<void> | void;
  submitLabel?: string;
  hasTrack?: boolean;
  lockSport?: boolean;
}) {
  const [d, setD] = useState<ActivityDraft>(initial);
  const [duration, setDuration] = useState(initial.durationSec ? formatClock(initial.durationSec) : '');
  const [time, setTime] = useState(timeOf(initial.startTime));
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoUrl = useObjectUrl(d.photo);
  const def = SPORT_DEFS[d.sport];
  const swim = d.sport === 'schwimmen';
  const set = (patch: Partial<ActivityDraft>) => setD((x) => ({ ...x, ...patch }));

  const durationSec = parseClock(duration) ?? 0;
  const preview = activityPoints({ ...d, durationSec });

  const submit = async () => {
    if (!durationSec) return toast('Bitte eine Dauer angeben, z. B. 45:00 oder 1:05:00.');
    if (def.distance && !d.distanceM && d.sport !== 'hyrox') {
      if (!confirm('Ohne Distanz gibt es nur Punkte nach Zeit. Trotzdem speichern?')) return;
    }
    const [h, m] = time.split(':').map(Number);
    const start = new Date(`${d.date}T12:00:00`);
    start.setHours(h || 0, m || 0, 0, 0);
    setBusy(true);
    try {
      await onSubmit({ ...d, durationSec, startTime: start.getTime(), date: toISODate(start), title: d.title.trim() || def.noun });
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      set({ photo: await compressImage(file, 1600, 0.82) });
    } catch {
      toast('Das Foto konnte nicht gelesen werden.');
    }
  };

  return (
    <div className="stack lg">
      {!lockSport && (
        <div className="sport-grid" role="group" aria-label="Sportart">
          {SPORTS.map((s) => (
            <button key={s} type="button" className="sport-pick" aria-pressed={d.sport === s} onClick={() => set({ sport: s as Sport })}>
              <SportIcon sport={s} />
              {SPORT_DEFS[s].label}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>Titel</span>
        <input className="input" value={d.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder={def.noun} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Datum</span>
          <input className="input" type="date" value={d.date} max={toISODate(new Date())} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </label>
        <label className="field">
          <span>Startzeit</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>
            Dauer <span className="muted">(h:mm:ss)</span>
          </span>
          <input className="input tnum" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="45:00" />
        </label>
        {def.distance && (
          <NumField
            label="Distanz"
            suffix={swim ? 'm' : 'km'}
            value={d.distanceM ? (swim ? d.distanceM : d.distanceM / 1000) : ''}
            onChange={(v) => set({ distanceM: v === '' ? undefined : Math.round(swim ? v : v * 1000) })}
          />
        )}
        {(d.sport === 'wandern' || d.sport === 'radfahren' || d.sport === 'laufen') && (
          <NumField label="Höhenmeter" suffix="m" value={d.elevationGainM ?? ''} onChange={(v) => set({ elevationGainM: v === '' ? undefined : Math.round(v) })} />
        )}
        <NumField label="Ø Puls" suffix="bpm" value={d.avgHr ?? ''} onChange={(v) => set({ avgHr: v === '' ? undefined : Math.round(v) })} />
      </div>

      {d.sport === 'hyrox' && (
        <div className="stack">
          <Seg
            label="Hyrox-Art"
            value={d.hyrox?.race ? 'race' : 'training'}
            onChange={(v) => set({ hyrox: { ...(d.hyrox ?? {}), race: v === 'race' } as HyroxData })}
            options={[
              { value: 'training', label: 'Training' },
              { value: 'race', label: 'Wettkampf / Simulation' },
            ]}
          />
          {d.hyrox?.race && (
            <select
              className="input"
              aria-label="Division"
              value={d.hyrox.division ?? 'open'}
              onChange={(e) => set({ hyrox: { ...d.hyrox!, division: e.target.value as HyroxData['division'] } })}
            >
              <option value="open">Open</option>
              <option value="pro">Pro</option>
              <option value="doubles">Doubles</option>
              <option value="relay">Staffel</option>
            </select>
          )}
        </div>
      )}

      <label className="field">
        <span>
          Anstrengung <span className="muted">(1 = sehr leicht, 10 = maximal)</span>
        </span>
        <div className="seg">
          {[2, 4, 6, 8, 10].map((v) => (
            <button key={v} type="button" aria-pressed={d.rpe === v} onClick={() => set({ rpe: d.rpe === v ? undefined : v })}>
              {v}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>Beschreibung</span>
        <textarea className="input" rows={3} maxLength={2000} value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder="Wie lief’s?" />
      </label>

      <div className="stack">
        <span className="small text-2" style={{ fontWeight: 550 }}>
          Foto
        </span>
        {photoUrl ? (
          <div className="row">
            <img src={photoUrl} alt="" className="thumb" style={{ width: 72, height: 72 }} />
            <button type="button" className="btn small danger" onClick={() => set({ photo: undefined })}>
              <IconTrash /> Entfernen
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <IconCamera /> Foto hinzufügen
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
      </div>

      <div className="stack">
        <span className="small text-2" style={{ fontWeight: 550 }}>
          Wer sieht die Aktivität?
        </span>
        <Seg
          label="Sichtbarkeit"
          value={d.visibility ?? 'public'}
          onChange={(v) => set({ visibility: v as Visibility })}
          options={(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))}
        />
        {hasTrack && (
          <label className="check">
            <input type="checkbox" checked={d.hideEnds ?? true} onChange={(e) => set({ hideEnds: e.target.checked })} />
            Start und Ziel auf der Karte für andere ausblenden (je 200 m)
          </label>
        )}
      </div>

      <div className="hint-box tnum row between">
        <span>
          <strong>+{fmt(preview)} Punkte</strong> · {POINTS_RULES[d.sport]}
        </span>
        {preview === 0 && durationSec > 0 && (
          <InfoBang title="Keine Punkte" tone="warn">
            <p>Die Werte wirken unrealistisch (z. B. zu schnell) – dafür gibt es keine Punkte.</p>
          </InfoBang>
        )}
      </div>

      <button className="btn primary block" onClick={submit} disabled={busy}>
        {busy ? 'Speichere …' : submitLabel}
      </button>
    </div>
  );
}

export function emptyDraft(sport: Sport = 'laufen'): ActivityDraft {
  const now = Date.now() - 3600_000;
  return {
    sport,
    title: '',
    date: toISODate(new Date(now)),
    startTime: now,
    durationSec: 0,
    source: 'manuell',
  };
}
