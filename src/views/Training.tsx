import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { BarChart, LineChart } from '../components/charts';
import { IconPlus, IconRepeat, IconTrash } from '../components/icons';
import { InfoBang } from '../components/InfoBang';
import { Card, DateNav, Seg, Stat, Stepper, toast } from '../components/ui';
import { activityFromTraining, estimateStrengthDuration, saveActivity, updateActivity, useShareDefault } from '../activities';
import { db, ensureExercise } from '../db';
import { navigate } from '../hooks';
import { liftOf } from '../lib/medals';
import { formatDurationSec, parseClock } from '../lib/sports';
import { useAnalysis, useAppData, useToday } from '../hooks';
import type { Visibility } from '../types';
import { VISIBILITY_LABELS } from '../types';
import { addDays, formatDateShort, formatDayMonth, relativeDay } from '../lib/dates';
import { fmt, pctSigned } from '../lib/stats';
import {
  estimate1RM,
  exerciseTrend,
  formatMetric,
  isPersonalRecord,
  progressionSuggestion,
  sessionsByExercise,
  setsPerMuscleGroup,
  TREND_LABELS,
  weeklyVolume,
  type TrendStatus,
} from '../lib/training';
import { MUSCLE_GROUPS, type MuscleGroup, type WorkoutSet } from '../types';

type Mode = 'eintragen' | 'verlauf' | 'analyse';

export function TrainingView() {
  const t = useToday();
  const [mode, setMode] = useState<Mode>('eintragen');
  const [date, setDate] = useState(t);
  return (
    <div className="content">
      <Seg
        value={mode}
        onChange={setMode}
        label="Ansicht"
        options={[
          { value: 'eintragen', label: 'Eintragen' },
          { value: 'verlauf', label: 'Verlauf' },
          { value: 'analyse', label: 'Analyse' },
        ]}
      />
      {mode === 'eintragen' && <LogView date={date} setDate={setDate} />}
      {mode === 'verlauf' && (
        <HistoryView
          onOpen={(d) => {
            setDate(d);
            setMode('eintragen');
          }}
        />
      )}
      {mode === 'analyse' && <AnalysisView />}
    </div>
  );
}

// ------------------------------------------------------------------ Eintragen

function LogView({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const allSets = useLiveQuery(() => db.sets.toArray(), []) ?? [];
  const daySets = useMemo(
    () => allSets.filter((s) => s.date === date).sort((a, b) => a.createdAt - b.createdAt),
    [allSets, date],
  );

  const recentExercises = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of allSets) seen.set(s.exercise, Math.max(seen.get(s.exercise) ?? 0, s.createdAt));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  }, [allSets]);

  const [exercise, setExercise] = useState('');
  const [weight, setWeight] = useState<number | ''>('');
  const [reps, setReps] = useState<number | ''>(8);
  const [rpe, setRpe] = useState<number | ''>('');
  const [newGroup, setNewGroup] = useState<MuscleGroup>('Sonstiges');

  const known = exercises.find((e) => e.name.toLowerCase() === exercise.trim().toLowerCase());
  const exerciseSets = useMemo(
    () => allSets.filter((s) => s.exercise.toLowerCase() === exercise.trim().toLowerCase()),
    [allSets, exercise],
  );
  const lastSession = useMemo(() => {
    const before = exerciseSets.filter((s) => s.date < date);
    if (!before.length) return undefined;
    const sessions = sessionsByExercise(before).values().next().value;
    return sessions?.[sessions.length - 1];
  }, [exerciseSets, date]);
  const lastSessionSets = lastSession
    ? exerciseSets.filter((s) => s.date === lastSession.date).sort((a, b) => a.createdAt - b.createdAt)
    : [];

  const selectExercise = (name: string) => {
    setExercise(name);
    const prev = allSets
      .filter((s) => s.exercise === name)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (prev) {
      setWeight(prev.weight);
      setReps(prev.reps);
    }
  };

  const save = async () => {
    const name = exercise.trim();
    if (!name || reps === '' || reps <= 0) {
      toast('Bitte Übung und Wiederholungen angeben.');
      return;
    }
    const finalName = await ensureExercise(name, newGroup);
    const w = weight === '' ? 0 : weight;
    const set: WorkoutSet = {
      date,
      exercise: finalName,
      weight: w,
      reps,
      ...(rpe !== '' ? { rpe } : {}),
      createdAt: Date.now(),
    };
    const previous = allSets.filter((s) => s.exercise.toLowerCase() === finalName.toLowerCase());
    await db.sets.add(set);
    if (isPersonalRecord(set, previous)) {
      toast(
        w > 0
          ? `🏆 Neuer Rekord: ${finalName} – geschätztes 1RM ${fmt(estimate1RM(w, reps), 1)} kg`
          : `🏆 Neuer Rekord: ${finalName} – ${reps} Wiederholungen`,
      );
    } else toast(`Satz gespeichert: ${fmt(w, 1)} kg × ${reps}`);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutSet[]>();
    for (const s of daySets) map.set(s.exercise, [...(map.get(s.exercise) ?? []), s]);
    return [...map.entries()];
  }, [daySets]);

  const repeatSet = async (s: WorkoutSet) => {
    await db.sets.add({ ...s, id: undefined, createdAt: Date.now() });
    toast(`Satz wiederholt: ${fmt(s.weight, 1)} kg × ${s.reps}`);
  };

  const suggestion = progressionSuggestion(lastSession);
  const dayVolume = daySets.reduce((a, s) => a + s.weight * s.reps, 0);

  return (
    <>
      <DateNav date={date} onChange={setDate} />
      <Card title="Satz eintragen">
        <label className="field">
          <span>Übung</span>
          <input
            className="input"
            list="exercise-list"
            value={exercise}
            placeholder="z. B. Bankdrücken"
            onChange={(e) => {
              const v = e.target.value;
              const match = exercises.find((x) => x.name === v);
              if (match) selectExercise(match.name);
              else setExercise(v);
            }}
          />
          <datalist id="exercise-list">
            {exercises.map((e) => (
              <option key={e.id} value={e.name}>
                {e.muscleGroup}
              </option>
            ))}
          </datalist>
        </label>
        {recentExercises.length > 0 && (
          <div className="chips" aria-label="Zuletzt genutzte Übungen">
            {recentExercises.map((n) => (
              <button key={n} className="chip" type="button" aria-pressed={n === exercise} onClick={() => selectExercise(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        {exercise.trim() && !known && (
          <label className="field">
            <span>Neue Übung – Muskelgruppe</span>
            <select className="input" value={newGroup} onChange={(e) => setNewGroup(e.target.value as MuscleGroup)}>
              {MUSCLE_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        )}
        {lastSession && (
          <div className="hint-box row between">
            <span>
              <strong>Letztes Mal ({relativeDay(lastSession.date)}):</strong>{' '}
              {lastSessionSets.map((s) => `${fmt(s.weight, 1)}×${s.reps}`).join(', ')}
            </span>
            {suggestion && (
              <InfoBang title="Vorschlag für heute">
                <p>{suggestion}</p>
              </InfoBang>
            )}
          </div>
        )}
        <div className="grid-2">
          <div className="stack">
            <span className="small text-2">Gewicht (kg)</span>
            <Stepper label="Gewicht" value={weight} onChange={setWeight} step={2.5} />
          </div>
          <div className="stack">
            <span className="small text-2">Wiederholungen</span>
            <Stepper label="Wiederholungen" value={reps} onChange={setReps} step={1} decimals={0} />
          </div>
        </div>
        <label className="field">
          <span>
            Anstrengung (RPE) <span className="muted">optional · 10 = kein Wdh. mehr möglich</span>
          </span>
          <div className="seg">
            {[6, 7, 8, 9, 10].map((v) => (
              <button key={v} type="button" aria-pressed={rpe === v} onClick={() => setRpe(rpe === v ? '' : v)}>
                {v}
              </button>
            ))}
          </div>
        </label>
        <button className="btn primary block" onClick={save}>
          <IconPlus /> Satz speichern
        </button>
      </Card>

      <Card
        title={`Training ${relativeDay(date) === 'Heute' ? 'heute' : relativeDay(date)}`}
        action={daySets.length > 0 && <span className="small muted tnum">{fmt(dayVolume)} kg Volumen</span>}
      >
        {grouped.length === 0 && <div className="empty">Noch keine Sätze an diesem Tag.</div>}
        {grouped.map(([name, sets]) => {
          const prevBefore = allSets.filter((s) => s.exercise === name && s.date < date);
          const prevBest = prevBefore.length ? Math.max(...prevBefore.map((s) => estimate1RM(s.weight, s.reps))) : 0;
          return (
            <div key={name} className="stack" style={{ gap: 2 }}>
              <div className="row between">
                <h3>{name}</h3>
                <button className="btn ghost small" onClick={() => repeatSet(sets[sets.length - 1])} aria-label={`Letzten Satz ${name} wiederholen`}>
                  <IconRepeat /> Wiederholen
                </button>
              </div>
              {sets.map((s, i) => (
                <div className="set-row" key={s.id}>
                  <span className="set-no">{i + 1}</span>
                  <span>
                    <strong>{fmt(s.weight, 1)} kg</strong> × {s.reps}
                    {s.rpe ? <span className="muted small"> · RPE {s.rpe}</span> : null}
                    {prevBefore.length > 0 && s.weight > 0 && estimate1RM(s.weight, s.reps) > prevBest + 0.01 && (
                      <span className="pr"> · 🏆 Rekord</span>
                    )}
                  </span>
                  <button className="icon-btn sm" onClick={() => s.id && db.sets.delete(s.id)} aria-label="Satz löschen">
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </Card>
      {daySets.length > 0 && <ShareSessionCard date={date} sets={daySets} />}
    </>
  );
}

/** Krafteinheit eines Tages als Aktivität speichern – für Feed, Punkte und Liga. */
function ShareSessionCard({ date, sets }: { date: string; sets: WorkoutSet[] }) {
  const existing = useLiveQuery(() => db.activities.where('date').equals(date).filter((a) => a.source === 'training').first(), [date]);
  const shareDefault = useShareDefault();
  const lifts = sets.filter((s) => liftOf(s.exercise)).length;
  const [sport, setSport] = useState<'gym' | 'powerlifting'>(lifts >= sets.length / 2 ? 'powerlifting' : 'gym');
  const [duration, setDuration] = useState('');
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const estimated = estimateStrengthDuration(sets);
  const durationSec = parseClock(duration) ?? existing?.durationSec ?? estimated;

  const save = async () => {
    if (existing?.id != null) {
      const fresh = await activityFromTraining(date, existing.sport as 'gym' | 'powerlifting', durationSec);
      await updateActivity(existing.id, { strength: fresh.strength, powerlifting: fresh.powerlifting, durationSec });
      toast('Aktivität aktualisiert');
      return;
    }
    const id = await saveActivity(await activityFromTraining(date, sport, durationSec, { visibility: visibility ?? shareDefault }));
    toast('Als Aktivität gespeichert 🏋️');
    navigate('aktivitaet', id);
  };

  return (
    <Card title={existing ? 'Als Aktivität gespeichert ✓' : 'Einheit abschließen'}>
      {existing ? (
        <p className="small text-2">
          {existing.title} · {formatDurationSec(existing.durationSec)} · +{fmt(existing.points)} Punkte.{' '}
          <a href={`#/aktivitaet/${existing.id}`}>Ansehen</a>
        </p>
      ) : (
        <>
          <p className="small text-2">Speichert die Sätze als Aktivität – mit Punkten für deine Liga und zum Teilen im Feed.</p>
          <Seg
            label="Sportart"
            value={sport}
            onChange={setSport}
            options={[
              { value: 'gym', label: '🏋️ Gym' },
              { value: 'powerlifting', label: '🏋️‍♂️ Powerlifting' },
            ]}
          />
          <Seg
            label="Sichtbarkeit"
            value={visibility ?? shareDefault}
            onChange={setVisibility}
            options={(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))}
          />
        </>
      )}
      <label className="field">
        <span>
          Dauer <span className="muted">(geschätzt {formatDurationSec(estimated)})</span>
        </span>
        <input className="input" inputMode="numeric" placeholder={String(Math.round((existing?.durationSec ?? estimated) / 60))} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </label>
      <button className="btn primary" onClick={save}>
        {existing ? 'Mit neuen Sätzen aktualisieren' : 'Speichern & teilen'}
      </button>
    </Card>
  );
}

// ------------------------------------------------------------------ Verlauf

function HistoryView({ onOpen }: { onOpen: (date: string) => void }) {
  const sets = useLiveQuery(() => db.sets.toArray(), []) ?? [];
  const days = useMemo(() => {
    const byDate = new Map<string, WorkoutSet[]>();
    for (const s of sets) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60);
  }, [sets]);

  if (!days.length) return <div className="empty">Noch keine Trainingseinheiten.</div>;
  return (
    <Card title="Trainingseinheiten">
      <div className="list">
        {days.map(([date, list]) => {
          const byEx = sessionsByExercise(list);
          const volume = list.reduce((a, s) => a + s.weight * s.reps, 0);
          return (
            <button key={date} className="list-item" style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', padding: '10px 0' }} onClick={() => onOpen(date)}>
              <div className="main">
                <div className="row between">
                  <span className="title">{formatDateShort(date)}</span>
                  <span className="small muted tnum">
                    {list.length} Sätze · {fmt(volume)} kg
                  </span>
                </div>
                <div className="meta">
                  {[...byEx.values()]
                    .map(([s]) => (s.metricType === 'e1rm' ? `${s.exercise} ${fmt(s.topWeight, 1)}×${s.topReps}` : `${s.exercise} ${s.maxReps} Wdh.`))
                    .join(' · ')}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Analyse

const STATUS_COLOR: Record<TrendStatus, string> = {
  'zu-wenig-daten': 'var(--muted)',
  'starker-fortschritt': 'var(--good)',
  fortschritt: 'var(--good)',
  stagnation: 'var(--warning)',
  rueckgang: 'var(--critical)',
};

export function TrendBadge({ status }: { status: TrendStatus }) {
  return (
    <span className="badge">
      <span className="status-dot" style={{ background: STATUS_COLOR[status] }} />
      {TREND_LABELS[status]}
    </span>
  );
}

function AnalysisView() {
  const data = useAppData();
  const analysis = useAnalysis(data);
  const today = useToday();
  const byExercise = useMemo(() => sessionsByExercise(data?.sets ?? []), [data]);
  const exerciseNames = useMemo(
    () => [...byExercise.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n),
    [byExercise],
  );
  const [selected, setSelected] = useState<string>('');
  const current = selected && byExercise.has(selected) ? selected : exerciseNames[0];

  if (!data || !analysis) return null;
  if (!exerciseNames.length) return <div className="empty">Trage ein paar Einheiten ein – dann siehst du hier deinen Fortschritt.</div>;

  const sessions = byExercise.get(current) ?? [];
  const trend = exerciseTrend(sessions, today);
  const weeks = weeklyVolume(data.sets, 12, today);
  const groups = [...setsPerMuscleGroup(data.sets, data.exercises, addDays(today, -6), today).entries()].sort((a, b) => b[1] - a[1]);
  const metricType = sessions[sessions.length - 1]?.metricType ?? 'e1rm';

  return (
    <>
      <Card title="Übung analysieren">
        <select className="input" value={current} onChange={(e) => setSelected(e.target.value)} aria-label="Übung">
          {exerciseNames.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        {trend && (
          <>
            <div className="row between wrap">
              <TrendBadge status={trend.status} />
              {trend.status !== 'zu-wenig-daten' && (
                <span className="small text-2 tnum">
                  {pctSigned(trend.pctPerWeek, 1)} pro Woche (8 Wochen)
                </span>
              )}
            </div>
            <div className="grid-3">
              <Stat tile label={metricType === 'e1rm' ? 'Aktuell (e1RM)' : 'Aktuell'} value={formatMetric(trend.current, trend.metricType)} />
              <Stat tile label="Bestwert" value={formatMetric(trend.best, trend.metricType)} delta={formatDayMonth(trend.bestDate)} />
              <Stat tile label="Einheiten" value={trend.totalSessions} />
            </div>
          </>
        )}
        <LineChart
          ariaLabel={`Verlauf ${current}`}
          unit={metricType === 'e1rm' ? ' kg' : ' Wdh.'}
          series={[
            {
              key: 'metric',
              label: metricType === 'e1rm' ? 'Geschätztes 1RM' : 'Max. Wiederholungen',
              color: 'var(--series-1)',
              points: sessions.map((s) => ({ x: s.date, y: s.metric })),
              dots: true,
            },
            ...(metricType === 'e1rm'
              ? [
                  {
                    key: 'top',
                    label: 'Schwerster Satz',
                    color: 'var(--series-2)',
                    points: sessions.map((s) => ({ x: s.date, y: s.topWeight })),
                    dots: true,
                  },
                ]
              : []),
          ]}
          target={(() => {
            const g = data.goals.strengthGoals.find((x) => x.exercise.toLowerCase() === current.toLowerCase());
            return g ? { value: g.target1RM, label: `Ziel ${fmt(g.target1RM, 1)} kg` } : undefined;
          })()}
        />
        <p className="tiny muted">
          e1RM = geschätztes Maximalgewicht für 1 Wiederholung (Epley-Formel) – macht Sätze mit unterschiedlichen Wiederholungszahlen vergleichbar.
        </p>
      </Card>

      <Card title="Alle Übungen (8 Wochen)">
        <div className="list">
          {analysis.trends.map((t) => (
            <button
              key={t.exercise}
              className="list-item"
              style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', padding: '10px 0' }}
              onClick={() => {
                setSelected(t.exercise);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <div className="main">
                <div className="title">{t.exercise}</div>
                <div className="meta tnum">
                  {formatMetric(t.current, t.metricType)}
                  {t.status !== 'zu-wenig-daten' && ` · ${pctSigned(t.pctPerWeek, 1)}/Woche`}
                </div>
              </div>
              <TrendBadge status={t.status} />
            </button>
          ))}
        </div>
      </Card>

      <Card title="Wochenvolumen">
        <div className="grid-3">
          <Stat tile label="Ø pro Woche" value={fmt(analysis.trainingPerWeek, 1)} delta={`Ziel ${data.goals.trainingDays}`} />
          <Stat tile label="Diese Woche" value={weeks[weeks.length - 1].days} unit="Tage" />
          <Stat tile label="Sätze" value={weeks[weeks.length - 1].sets} delta="diese Woche" />
        </div>
        <BarChart
          ariaLabel="Trainingsvolumen pro Woche"
          bars={weeks.map((w) => ({ x: w.week, y: w.volume || null }))}
          unit=" kg"
          valueLabel="Volumen"
          formatX={formatDayMonth}
          formatTooltipX={(x) => `Woche ab ${formatDayMonth(x)}`}
        />
      </Card>

      {groups.length > 0 && (
        <Card title="Sätze pro Muskelgruppe (7 Tage)">
          <table className="data-table">
            <tbody>
              {groups.map(([g, n]) => (
                <tr key={g}>
                  <td>{g}</td>
                  <td>{n} Sätze</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted">Richtwert für Muskelaufbau: ca. 10–20 harte Sätze pro Muskelgruppe und Woche.</p>
        </Card>
      )}
    </>
  );
}
