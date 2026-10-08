import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { parseTrainingPlan } from '../ai/trainingPlan';
import { IconCamera, IconFile, IconPlus, IconSparkle, IconTrash } from '../components/icons';
import { Card, ErrorBox, NumField, Seg, toast } from '../components/ui';
import { setKV, useKV } from '../db';
import { navigate, useApiKey, useToday } from '../hooks';
import { DEFAULT_DAY, DEFAULT_SCHEDULE } from '../lib/dailyNeeds';
import { formatDateShort } from '../lib/dates';
import { newUid, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import { DEFAULT_PREFS, useWeekNeeds } from '../needs';
import type { DayKind, Intensity, NutritionPreferences, PlannedSession, ScheduleDay, Sport, TrainingPlan, WeekSchedule, Weekday } from '../types';
import { DAY_KIND_LABELS, INTENSITY_LABELS, SPORTS, WEEKDAY_LABELS, WEEKDAY_SHORT } from '../types';
import { SportIcon } from '../components/SportIcon';

type Tab = 'woche' | 'training' | 'alltag' | 'vorlieben';

export function PlanView() {
  const [tab, setTab] = useState<Tab>('woche');
  return (
    <div className="content">
      <p className="small text-2">
        Aus deinem Trainingsplan, deinem Alltag und deinen <a href="#/ziele">Zielen</a> berechnet die App deinen Bedarf für jeden Tag. Die KI plant dazu
        Mahlzeiten aus deinen Lebensmitteln (unter <a href="#/essen">Essen</a>).
      </p>
      <Seg
        label="Bereich"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'woche', label: 'Woche' },
          { value: 'training', label: 'Training' },
          { value: 'alltag', label: 'Alltag' },
          { value: 'vorlieben', label: 'Essen' },
        ]}
      />
      {tab === 'woche' && <WeekOverview />}
      {tab === 'training' && <TrainingPlanEditor />}
      {tab === 'alltag' && <ScheduleEditor />}
      {tab === 'vorlieben' && <PrefsEditor />}
    </div>
  );
}

function WeekOverview() {
  const t = useToday();
  const week = useWeekNeeds(t);
  if (!week) return null;
  const max = Math.max(...week.map((d) => d.targets.kcal));
  return (
    <>
      <Card title="Dein Bedarf diese Woche">
        <div className="week-bars">
          {week.map((d) => (
            <a key={d.date} href="#/essen" className={`week-bar ${d.date === t ? 'today' : ''}`}>
              <span className="tiny muted">{WEEKDAY_SHORT[d.weekday]}</span>
              <span className="bar" style={{ height: `${Math.round((d.targets.kcal / max) * 100)}%` }} />
              <span className="tiny tnum">{fmt(d.targets.kcal)}</span>
              <span className="tiny" aria-hidden="true">
                {[...d.done.map((a) => a.sport), ...d.sessions.map((s) => s.sport)].map((sp, j) => <SportIcon key={j} sport={sp} size={13} />)}
                {!d.done.length && !d.sessions.length && '·'}
              </span>
            </a>
          ))}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>kcal</th>
              <th>Protein</th>
              <th>KH</th>
              <th>Fett</th>
            </tr>
          </thead>
          <tbody>
            {week.map((d) => (
              <tr key={d.date} style={d.date === t ? { fontWeight: 650 } : undefined}>
                <td>{formatDateShort(d.date)}</td>
                <td>{fmt(d.targets.kcal)}</td>
                <td>{fmt(d.targets.protein)} g</td>
                <td>{fmt(d.targets.carbs)} g</td>
                <td>{fmt(d.targets.fat)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted">
          Der Wochenschnitt entspricht deinem Kalorienziel. An Trainingstagen und Tagen mit körperlicher Arbeit gibt es mehr (vor allem Kohlenhydrate),
          an ruhigen Tagen weniger. Schon aufgezeichnete Aktivitäten ersetzen die geplanten.
        </p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Trainingsplan

function TrainingPlanEditor() {
  const apiKey = useApiKey();
  const stored = useKV<TrainingPlan | null>('trainingPlan', null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  if (stored === undefined) return null;
  const plan: TrainingPlan = stored ?? { name: 'Mein Plan', sessions: [], updatedAt: Date.now(), source: 'manuell' };
  const save = (p: TrainingPlan) => setKV('trainingPlan', { ...p, updatedAt: Date.now() });

  const parse = async (source: { kind: 'text'; text: string } | { kind: 'file'; file: File }) => {
    if (!apiKey) return navigate('einstellungen');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await parseTrainingPlan(apiKey, source, ctrl.signal);
      if (plan.sessions.length && !confirm(`${res.plan.sessions.length} Einheiten erkannt. Den bisherigen Plan ersetzen?`)) return;
      await save(res.plan);
      setNote(res.note);
      setText('');
      toast(`Plan übernommen: ${res.plan.sessions.length} Einheiten`);
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const update = (id: string, patch: Partial<PlannedSession>) => save({ ...plan, sessions: plan.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const add = (weekday: Weekday) =>
    save({ ...plan, sessions: [...plan.sessions, { id: newUid(), weekday, sport: 'laufen', title: 'Lauf', durationMin: 45, intensity: 'mittel' }] });

  return (
    <>
      <Card
        title={
          <div className="row">
            <IconSparkle width={20} height={20} />
            <h2>Plan hochladen</h2>
          </div>
        }
      >
        <p className="small text-2">Foto, Screenshot oder PDF deines Trainingsplans – oder Text einfügen. Die KI überträgt ihn in eine Wochenübersicht.</p>
        <div className="grid-2">
          <button className="btn" onClick={() => cameraRef.current?.click()} disabled={busy}>
            <IconCamera /> Foto
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconFile /> Datei / PDF
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && parse({ kind: 'file', file: e.target.files[0] })} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,.txt,.csv,.md" hidden onChange={(e) => e.target.files?.[0] && parse({ kind: 'file', file: e.target.files[0] })} />
        <textarea className="input" rows={3} placeholder="…oder Plan als Text einfügen (z. B. aus Runna, Strava, Excel)" value={text} onChange={(e) => setText(e.target.value)} />
        {text.trim() && (
          <button className="btn primary" onClick={() => parse({ kind: 'text', text })} disabled={busy}>
            Text übernehmen
          </button>
        )}
        {busy && (
          <div className="row">
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
            <span className="small muted">Die KI liest deinen Plan …</span>
            <button className="btn ghost small" onClick={() => abortRef.current?.abort()}>
              Abbrechen
            </button>
          </div>
        )}
        {!apiKey && <p className="tiny muted">Dafür wird ein KI-Schlüssel benötigt (Einstellungen). Manuell eintragen geht immer.</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        {note && <div className="hint-box">{note}</div>}
      </Card>

      <Card title={plan.sessions.length ? plan.name : 'Trainingswoche'}>
        {WEEKDAY_LABELS.map((label, wd) => {
          const list = plan.sessions.filter((s) => s.weekday === wd).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
          return (
            <div key={label} className="stack" style={{ gap: 6 }}>
              <div className="row between">
                <h3>{label}</h3>
                <button className="btn ghost small" onClick={() => add(wd as Weekday)} aria-label={`Einheit am ${label} hinzufügen`}>
                  <IconPlus /> Einheit
                </button>
              </div>
              {list.length === 0 && <div className="tiny muted">Ruhetag</div>}
              {list.map((s) => (
                <SessionRow key={s.id} s={s} onChange={(p) => update(s.id, p)} onDelete={() => save({ ...plan, sessions: plan.sessions.filter((x) => x.id !== s.id) })} />
              ))}
            </div>
          );
        })}
      </Card>
    </>
  );
}

function SessionRow({ s, onChange, onDelete }: { s: PlannedSession; onChange: (p: Partial<PlannedSession>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="session">
      <button className="session-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <SportIcon sport={s.sport} />
        <span className="grow">
          <span className="title">{s.title}</span>
          <span className="tiny muted">
            {s.time ? `${s.time} · ` : ''}
            {s.durationMin} min · {INTENSITY_LABELS[s.intensity]}
            {s.distanceKm ? ` · ${fmt(s.distanceKm, 1)} km` : ''}
          </span>
        </span>
      </button>
      {open && (
        <div className="stack" style={{ padding: '8px 0' }}>
          <div className="grid-2">
            <label className="field">
              <span>Sportart</span>
              <select className="input" value={s.sport} onChange={(e) => onChange({ sport: e.target.value as Sport })}>
                {SPORTS.map((x) => (
                  <option key={x} value={x}>
                    <SportIcon sport={x} /> {SPORT_DEFS[x].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Titel</span>
              <input className="input" value={s.title} onChange={(e) => onChange({ title: e.target.value })} />
            </label>
            <label className="field">
              <span>Uhrzeit</span>
              <input className="input" type="time" value={s.time ?? ''} onChange={(e) => onChange({ time: e.target.value || undefined })} />
            </label>
            <NumField label="Dauer" suffix="min" value={s.durationMin} onChange={(v) => onChange({ durationMin: v === '' ? 0 : v })} />
            {SPORT_DEFS[s.sport].distance && <NumField label="Distanz" suffix="km" value={s.distanceKm ?? ''} onChange={(v) => onChange({ distanceKm: v === '' ? undefined : v })} />}
          </div>
          <Seg
            label="Intensität"
            value={s.intensity}
            onChange={(v) => onChange({ intensity: v as Intensity })}
            options={(Object.keys(INTENSITY_LABELS) as Intensity[]).map((k) => ({ value: k, label: INTENSITY_LABELS[k] }))}
          />
          {s.note && <p className="tiny muted">{s.note}</p>}
          <button className="btn small danger" onClick={onDelete}>
            <IconTrash /> Entfernen
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Alltag

function ScheduleEditor() {
  const stored = useKV<WeekSchedule | null>('schedule', null);
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  useEffect(() => {
    if (stored !== undefined && !week) setWeek(stored ?? DEFAULT_SCHEDULE);
  }, [stored, week]);
  if (!week) return null;
  const set = (i: number, patch: Partial<ScheduleDay>) => setWeek(week.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const copyToWeekdays = (i: number) => setWeek(week.map((d, j) => (j < 5 ? { ...week[i] } : d)));

  return (
    <>
      {week.map((d, i) => (
        <Card key={WEEKDAY_LABELS[i]} className="tight" title={WEEKDAY_LABELS[i]} action={i < 5 && <button className="btn ghost small" onClick={() => copyToWeekdays(i)}>Für Mo–Fr übernehmen</button>}>
          <select className="input" value={d.kind} onChange={(e) => set(i, { kind: e.target.value as DayKind, ...(e.target.value !== 'frei' && !d.start ? { start: DEFAULT_DAY.start, end: DEFAULT_DAY.end } : {}) })} aria-label="Art des Tages">
            {(Object.keys(DAY_KIND_LABELS) as DayKind[]).map((k) => (
              <option key={k} value={k}>
                {DAY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <div className="grid-2">
            {d.kind !== 'frei' && (
              <>
                <label className="field">
                  <span>Von</span>
                  <input className="input" type="time" value={d.start ?? ''} onChange={(e) => set(i, { start: e.target.value })} />
                </label>
                <label className="field">
                  <span>Bis</span>
                  <input className="input" type="time" value={d.end ?? ''} onChange={(e) => set(i, { end: e.target.value })} />
                </label>
              </>
            )}
            <label className="field">
              <span>Aufstehen</span>
              <input className="input" type="time" value={d.wake} onChange={(e) => set(i, { wake: e.target.value })} />
            </label>
            <label className="field">
              <span>Schlafen</span>
              <input className="input" type="time" value={d.sleep} onChange={(e) => set(i, { sleep: e.target.value })} />
            </label>
            <NumField label="Wege zu Fuß/Rad" suffix="min" value={d.activeMinutes} onChange={(v) => set(i, { activeMinutes: v === '' ? 0 : v })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={d.canCook} onChange={(e) => set(i, { canCook: e.target.checked })} />
            Tagsüber warm essen möglich (Küche, Kantine, Mensa)
          </label>
        </Card>
      ))}
      <button
        className="btn primary block"
        style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px)' }}
        onClick={async () => {
          await setKV('schedule', week);
          toast('Alltag gespeichert');
        }}
      >
        Alltag speichern
      </button>
    </>
  );
}

// ------------------------------------------------------------------ Vorlieben

function PrefsEditor() {
  const stored = useKV<NutritionPreferences>('nutritionPrefs', DEFAULT_PREFS);
  const [p, setP] = useState<NutritionPreferences | null>(null);
  useEffect(() => {
    if (stored && !p) setP(stored);
  }, [stored, p]);
  if (!p) return null;
  return (
    <Card title="Vorlieben für Rezepte">
      <label className="field">
        <span>Ernährungsform</span>
        <select className="input" value={p.diet} onChange={(e) => setP({ ...p, diet: e.target.value as NutritionPreferences['diet'] })}>
          <option value="alles">Alles</option>
          <option value="pescetarisch">Pescetarisch</option>
          <option value="vegetarisch">Vegetarisch</option>
          <option value="vegan">Vegan</option>
        </select>
      </label>
      <div className="grid-2">
        <NumField label="Mahlzeiten pro Tag" value={p.mealsPerDay} onChange={(v) => setP({ ...p, mealsPerDay: v === '' ? 3 : Math.max(2, Math.min(7, Math.round(v))) })} />
        <NumField label="Max. Kochzeit" suffix="min" value={p.cookingMinutes} onChange={(v) => setP({ ...p, cookingMinutes: v === '' ? 20 : v })} />
      </div>
      <label className="field">
        <span>Mag ich nicht / vertrage ich nicht</span>
        <input className="input" value={p.dislikes} onChange={(e) => setP({ ...p, dislikes: e.target.value })} placeholder="z. B. Pilze, Laktose" />
      </label>
      <button
        className="btn primary"
        onClick={async () => {
          await setKV('nutritionPrefs', p);
          toast('Gespeichert');
        }}
      >
        Speichern
      </button>
    </Card>
  );
}
