import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { LineChart } from '../components/charts';
import { IconPlus, IconTrash } from '../components/icons';
import { Card, Meter, NumField, Seg, Stat, toast } from '../components/ui';
import { db, setKV, useKV } from '../db';
import { useAnalysis, useAppData, useToday } from '../hooks';
import { movingAverage } from '../lib/body';
import { addDays, formatDateShort } from '../lib/dates';
import { ACTIVITY_LEVELS, GOAL_CONFIG, kcalOfTargets, suggestTargets } from '../lib/goals';
import { fmt, fmtSigned } from '../lib/stats';
import type { GoalType, Goals, Profile, StrengthGoal } from '../types';
import { DEFAULT_GOALS, GOAL_LABELS } from '../types';

type Num = number | '';

export function GoalsView() {
  const storedGoals = useKV<Goals>('goals', DEFAULT_GOALS);
  const storedProfile = useKV<Profile | null>('profile', null);
  if (storedGoals === undefined || storedProfile === undefined) return null;
  return <GoalsForm initialGoals={storedGoals} initialProfile={storedProfile} />;
}

function GoalsForm({ initialGoals, initialProfile }: { initialGoals: Goals; initialProfile: Profile | null }) {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];

  const [goals, setGoals] = useState<Goals>(initialGoals);
  const [sex, setSex] = useState<'m' | 'w'>(initialProfile?.sex ?? 'm');
  const [age, setAge] = useState<Num>(initialProfile?.age ?? '');
  const [height, setHeight] = useState<Num>(initialProfile?.height ?? '');
  const [activity, setActivity] = useState(initialProfile?.activity ?? 1.6);
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<Goals>) => {
    setGoals((g) => ({ ...g, ...patch }));
    setDirty(true);
  };
  const num = (k: keyof Goals) => (v: Num) => update({ [k]: v === '' ? 0 : v } as Partial<Goals>);

  const weight = analysis?.weight?.avg7 ?? null;
  const profile: Profile | null = age !== '' && height !== '' ? { sex, age, height, activity } : null;

  const suggest = () => {
    if (!profile) return toast('Bitte Alter und Größe eintragen.');
    if (!weight) return toast('Bitte zuerst dein Gewicht unten eintragen.');
    const s = suggestTargets(profile, weight, goals.type, analysis?.actualTdee);
    update({ kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat, weeklyRate: s.weeklyRate });
    toast(`Vorschlag berechnet (Verbrauch ~${fmt(s.tdee)} kcal${analysis?.actualTdee ? ', aus deinen Daten' : ''})`);
  };

  const save = async () => {
    await setKV('goals', goals);
    if (profile) await setKV('profile', profile);
    setDirty(false);
    toast('Ziele gespeichert');
  };

  const macroKcal = kcalOfTargets(goals);

  return (
    <div className="content">
      <Card title="Dein Ziel">
        <select className="input" value={goals.type} onChange={(e) => update({ type: e.target.value as GoalType })} aria-label="Zieltyp">
          {(Object.keys(GOAL_LABELS) as GoalType[]).map((k) => (
            <option key={k} value={k}>
              {GOAL_LABELS[k]}
            </option>
          ))}
        </select>
        <p className="small text-2">{GOAL_CONFIG[goals.type].description}.</p>
      </Card>

      <Card title="Profil (für Berechnungen)">
        <Seg
          value={sex}
          onChange={(v) => {
            setSex(v);
            setDirty(true);
          }}
          label="Geschlecht"
          options={[
            { value: 'm', label: 'Männlich' },
            { value: 'w', label: 'Weiblich' },
          ]}
        />
        <div className="grid-2">
          <NumField label="Alter" suffix="Jahre" value={age} onChange={(v) => (setAge(v), setDirty(true))} />
          <NumField label="Größe" suffix="cm" value={height} onChange={(v) => (setHeight(v), setDirty(true))} />
        </div>
        <label className="field">
          <span>Aktivität inkl. Training</span>
          <select
            className="input"
            value={activity}
            onChange={(e) => {
              setActivity(Number(e.target.value));
              setDirty(true);
            }}
          >
            {ACTIVITY_LEVELS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn block" onClick={suggest}>
          Kalorien & Makros vorschlagen
        </button>
        {analysis?.actualTdee && (
          <p className="small text-2">
            Aus deinen Daten geschätzter Verbrauch: <strong>{fmt(analysis.actualTdee)} kcal/Tag</strong> – für deine Wunschrate wären das{' '}
            <strong>{fmt(analysis.recommendedKcal!)} kcal</strong>.
          </p>
        )}
      </Card>

      <Card title="Tagesziele Ernährung">
        <div className="grid-2">
          <NumField label="Kalorien" suffix="kcal" value={goals.kcal} onChange={num('kcal')} />
          <NumField label="Protein" suffix="g" value={goals.protein} onChange={num('protein')} />
          <NumField label="Kohlenhydrate" suffix="g" value={goals.carbs} onChange={num('carbs')} />
          <NumField label="Fett" suffix="g" value={goals.fat} onChange={num('fat')} />
        </div>
        <p className={`small ${Math.abs(macroKcal - goals.kcal) > 100 ? '' : 'muted'}`}>
          {Math.abs(macroKcal - goals.kcal) > 100 ? '⚠ ' : ''}Deine Makros ergeben {fmt(macroKcal)} kcal
          {weight ? ` · Protein ${fmt(goals.protein / weight, 1)} g/kg` : ''}.
        </p>
      </Card>

      <Card title="Körper, Schlaf & Training">
        <div className="grid-2">
          <NumField label="Änderung" suffix="kg/Woche" value={goals.weeklyRate} onChange={num('weeklyRate')} />
          <NumField
            label="Zielgewicht"
            suffix="kg"
            value={goals.targetWeight ?? ''}
            onChange={(v) => update({ targetWeight: v === '' ? undefined : v })}
          />
          <NumField label="Schlafziel" suffix="h" value={goals.sleepHours} onChange={num('sleepHours')} />
          <NumField label="Trainings/Woche" value={goals.trainingDays} onChange={num('trainingDays')} />
        </div>
        <p className="tiny muted">Negative Gewichtsänderung = abnehmen (z. B. −0,5). Richtwert Defizit: 0,5–1 % des Körpergewichts pro Woche.</p>
      </Card>

      <StrengthGoalsCard
        goals={goals.strengthGoals}
        exercises={exercises.map((e) => e.name)}
        status={analysis?.strength ?? []}
        onChange={(strengthGoals) => update({ strengthGoals })}
      />

      <button className="btn primary block" onClick={save} disabled={!dirty} style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px)', zIndex: 5 }}>
        {dirty ? 'Ziele speichern' : 'Gespeichert ✓'}
      </button>

      <WeightCard today={t} goals={goals} />
    </div>
  );
}

function StrengthGoalsCard({
  goals,
  exercises,
  status,
  onChange,
}: {
  goals: StrengthGoal[];
  exercises: string[];
  status: { exercise: string; current: number | null; target: number; weeksToGoal: number | null }[];
  onChange: (g: StrengthGoal[]) => void;
}) {
  const [exercise, setExercise] = useState('');
  const [target, setTarget] = useState<Num>('');
  const [deadline, setDeadline] = useState('');

  const add = () => {
    if (!exercise.trim() || target === '' || target <= 0) return toast('Bitte Übung und Ziel-1RM angeben.');
    onChange([...goals.filter((g) => g.exercise !== exercise.trim()), { exercise: exercise.trim(), target1RM: target, ...(deadline ? { deadline } : {}) }]);
    setExercise('');
    setTarget('');
    setDeadline('');
  };

  return (
    <Card title="Kraftziele">
      {goals.length === 0 && <p className="small muted">Z. B. „Bankdrücken 100 kg bis Dezember“ – ich berechne, ob du auf Kurs bist.</p>}
      {goals.map((g) => {
        const s = status.find((x) => x.exercise === g.exercise);
        return (
          <div key={g.exercise} className="row">
            <div className="grow">
              <Meter label={`${g.exercise}${g.deadline ? ` · bis ${formatDateShort(g.deadline)}` : ''}`} value={s?.current ?? 0} target={g.target1RM} unit=" kg" digits={1} />
              {s?.weeksToGoal != null && s.weeksToGoal > 0 && (
                <div className="tiny muted">Bei aktuellem Tempo in ca. {fmt(Math.ceil(s.weeksToGoal))} Wochen</div>
              )}
            </div>
            <button className="icon-btn sm" onClick={() => onChange(goals.filter((x) => x !== g))} aria-label={`Kraftziel ${g.exercise} löschen`}>
              <IconTrash />
            </button>
          </div>
        );
      })}
      <hr className="divider" />
      <label className="field">
        <span>Übung</span>
        <input className="input" list="goal-exercises" value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="z. B. Bankdrücken" />
        <datalist id="goal-exercises">
          {exercises.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <div className="grid-2">
        <NumField label="Ziel-1RM" suffix="kg" value={target} onChange={setTarget} />
        <label className="field">
          <span>
            Bis <span className="muted">(optional)</span>
          </span>
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>
      <button className="btn" onClick={add}>
        <IconPlus /> Kraftziel hinzufügen
      </button>
    </Card>
  );
}

function WeightCard({ today, goals }: { today: string; goals: Goals }) {
  const entries = useLiveQuery(() => db.weights.orderBy('date').toArray(), []) ?? [];
  const data = useAppData();
  const analysis = useAnalysis(data);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState<Num>('');
  const existing = entries.find((e) => e.date === date);

  useEffect(() => {
    if (existing) setValue(existing.weight);
    else if (entries.length) setValue(entries[entries.length - 1].weight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, existing?.id, entries.length]);

  const save = async () => {
    if (value === '' || value < 20 || value > 400) return toast('Bitte ein gültiges Gewicht eintragen.');
    if (existing?.id != null) await db.weights.update(existing.id, { weight: value });
    else await db.weights.add({ date, weight: value });
    toast(`Gewicht gespeichert: ${fmt(value, 1)} kg`);
  };

  const recent = useMemo(() => entries.filter((e) => e.date >= addDays(today, -90)), [entries, today]);
  const avg = useMemo(() => movingAverage(recent), [recent]);
  const trend = analysis?.weight;

  return (
    <Card title="Körpergewicht">
      <div className="grid-2">
        <label className="field">
          <span>Datum</span>
          <input className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <NumField label="Gewicht" suffix="kg" value={value} onChange={setValue} />
      </div>
      <button className="btn primary block" onClick={save}>
        {existing ? 'Aktualisieren' : 'Gewicht speichern'}
      </button>
      {trend && (
        <div className="grid-3">
          <Stat tile label="Ø 7 Tage" value={fmt(trend.avg7, 1)} unit="kg" />
          <Stat tile label="Trend" value={trend.ratePerWeek != null ? fmtSigned(trend.ratePerWeek, 2) : '–'} unit="kg/Wo." />
          <Stat tile label="Ziel" value={fmtSigned(goals.weeklyRate, 2)} unit="kg/Wo." />
        </div>
      )}
      {recent.length > 0 && (
        <LineChart
          ariaLabel="Gewichtsverlauf"
          unit=" kg"
          series={[
            { key: 'avg', label: 'Ø 7 Tage', color: 'var(--series-1)', points: avg.map((a) => ({ x: a.date, y: Math.round(a.value * 10) / 10 })) },
            { key: 'raw', label: 'Messung', color: 'var(--series-2)', points: recent.map((e) => ({ x: e.date, y: e.weight })), dots: true },
          ]}
          target={goals.targetWeight ? { value: goals.targetWeight, label: `Ziel ${fmt(goals.targetWeight, 1)} kg` } : undefined}
        />
      )}
      {entries.length > 0 && (
        <details className="table-view">
          <summary>Einträge verwalten</summary>
          <div className="list">
            {[...entries].reverse().slice(0, 30).map((e) => (
              <div className="list-item" key={e.id}>
                <div className="main tnum">
                  {formatDateShort(e.date)} · <strong>{fmt(e.weight, 1)} kg</strong>
                </div>
                <button className="icon-btn sm" onClick={() => e.id && db.weights.delete(e.id)} aria-label="Eintrag löschen">
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
