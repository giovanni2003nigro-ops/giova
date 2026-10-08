import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { LineChart } from '../components/charts';
import { IconPlus, IconTrash } from '../components/icons';
import { InfoBang } from '../components/InfoBang';
import { Card, Meter, NumField, Seg, Stat, toast } from '../components/ui';
import { db, setKV, useKV } from '../db';
import { useAnalysis, useAppData, useToday } from '../hooks';
import { movingAverage } from '../lib/body';
import { addDays, formatDateShort } from '../lib/dates';
import { resolveGoals } from '../lib/autoGoals';
import { isAuto, weekNeeds, type NeedsInput } from '../lib/dailyNeeds';
import { ACTIVITY_LEVELS, GOAL_CONFIG, KCAL_PER_KG_WEEK_PER_DAY, kcalOfTargets } from '../lib/goals';
import { checkRules, enforceGoals, limits } from '../lib/guardrails';
import { loadNeedsInput } from '../needs';
import { fmt, fmtSigned } from '../lib/stats';
import type { GoalType, Goals, Profile, StrengthGoal } from '../types';
import { DEFAULT_GOALS, GOAL_LABELS, WEEKDAY_SHORT } from '../types';

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
  const base = useLiveQuery(() => loadNeedsInput(t), [t]);
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];

  const [goals, setGoals] = useState<Goals>({ ...initialGoals, auto: initialGoals.auto !== false });
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

  const weight = base?.weight ?? analysis?.weight?.avg7 ?? null;
  const profile: Profile | null = age !== '' && height !== '' ? { sex, age, height, activity } : null;

  // Live-Vorschau: Mit jeder Eingabe (Rate, Ziel, Profil) neu berechnet – mit Alltag, Plan und gemessenem Verbrauch
  const preview = useMemo(() => {
    if (!base) return null;
    const input: NeedsInput = { ...base, goals, profile, weight };
    const resolved = resolveGoals(input, t);
    const week = weekNeeds(t, { ...input, goals: resolved });
    const lim = limits(profile, weight);
    return { resolved, week, lim, rules: checkRules(resolved, base.plan, lim), auto: isAuto(input) };
  }, [base, goals, profile?.sex, profile?.age, profile?.height, profile?.activity, weight, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeRate = (v: Num) => {
    const rate = v === '' ? 0 : v;
    // Manuell: Kalorien wandern mit der Rate mit (1 kg/Woche ≈ 1.100 kcal/Tag), Kohlenhydrate gleichen aus
    if (goals.auto === false) {
      const shift = Math.round(((rate - goals.weeklyRate) * KCAL_PER_KG_WEEK_PER_DAY) / 10) * 10;
      update({ weeklyRate: rate, kcal: goals.kcal + shift, carbs: Math.max(0, goals.carbs + Math.round(shift / 4)) });
    } else update({ weeklyRate: rate });
  };

  const changeType = (type: GoalType) => {
    if (weight) {
      const weeklyRate = Math.round(weight * GOAL_CONFIG[type].rateFraction * 20) / 20;
      update({ type, weeklyRate });
      toast(`Wochenrate auf ${fmtSigned(weeklyRate, 2)} kg gesetzt – kannst du unten anpassen.`);
    } else update({ type });
  };

  const takeOver = () => {
    if (!preview?.auto) return toast('Für die Berechnung brauche ich Alter, Größe und dein Gewicht.');
    const r = preview.resolved;
    update({ kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat });
    toast('Berechnete Werte übernommen');
  };

  const save = async () => {
    let next: Goals = goals;
    if (preview?.auto && goals.auto !== false) {
      // Letzte berechnete Werte mitspeichern – Startwerte, falls später auf „Manuell“ gewechselt wird
      const r = preview.resolved;
      next = { ...goals, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat };
    }
    // Rahmenbedingungen gelten immer – Abweichungen werden angepasst und erklärt
    const { goals: safe, changes } = enforceGoals(next, limits(profile, weight));
    await setKV('goals', safe);
    if (profile) await setKV('profile', profile);
    setGoals(safe);
    setDirty(false);
    toast(changes.length ? `Gespeichert – angepasst: ${changes.join(' · ')}` : 'Ziele gespeichert');
  };

  const macroKcal = kcalOfTargets(goals);
  const auto = goals.auto !== false;
  const r = preview?.resolved;
  const week = preview?.week ?? [];
  const max = Math.max(1, ...week.map((d) => d.targets.kcal));
  const todayNeeds = week.find((d) => d.date === t);
  const broken = preview?.rules.filter((x) => !x.ok) ?? [];

  return (
    <div className="content">
      <Card title="Dein Ziel">
        <select className="input" value={goals.type} onChange={(e) => changeType(e.target.value as GoalType)} aria-label="Zieltyp">
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
        {base?.configured ? (
          <p className="tiny muted">
            Aktivität rechne ich genau aus deinem <a href="#/plan">Alltag & Trainingsplan</a> – kein Pauschalfaktor nötig.
          </p>
        ) : (
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
            <span className="tiny muted">
              Genauer wird’s mit <a href="#/plan">Alltag & Trainingsplan</a> – dann rechne ich jeden Tag einzeln.
            </span>
          </label>
        )}
      </Card>

      <Card title="Körper, Schlaf & Training">
        <div className="grid-2">
          <NumField label="Änderung" suffix="kg/Woche" value={goals.weeklyRate} onChange={changeRate} />
          <NumField
            label="Zielgewicht"
            suffix="kg"
            value={goals.targetWeight ?? ''}
            onChange={(v) => update({ targetWeight: v === '' ? undefined : v })}
          />
          <NumField label="Schlafziel" suffix="h" value={goals.sleepHours} onChange={num('sleepHours')} />
          <NumField label="Trainings/Woche" value={goals.trainingDays} onChange={num('trainingDays')} />
        </div>
        <p className="tiny muted">
          Negative Änderung = abnehmen (z. B. −0,5). {fmtSigned(goals.weeklyRate, 2)} kg/Woche = {fmtSigned(Math.round(goals.weeklyRate * KCAL_PER_KG_WEEK_PER_DAY))} kcal pro Tag
          {auto && r ? ` → Tagesziel Ø ${fmt(r.kcal)} kcal` : goals.auto === false ? ` → Tagesziel ${fmt(goals.kcal)} kcal` : ''}.
        </p>
      </Card>

      <Card
        title="Tagesziele"
        action={
          <Seg
            value={auto ? 'auto' : 'manuell'}
            onChange={(v) => update({ auto: v === 'auto' })}
            label="Berechnung"
            options={[
              { value: 'auto', label: 'Automatisch' },
              { value: 'manuell', label: 'Manuell' },
            ]}
          />
        }
      >
        {auto ? (
          preview?.auto && r ? (
            <>
              <div className="grid-2">
                <Stat tile label="Kalorien Ø" value={fmt(r.kcal)} unit="kcal" />
                <Stat tile label="Protein" value={fmt(r.protein)} unit="g" />
                <Stat tile label="Kohlenhydrate Ø" value={fmt(r.carbs)} unit="g" />
                <Stat tile label="Fett" value={fmt(r.fat)} unit="g" />
              </div>
              <div className="week-bars" aria-label="Kalorien je Wochentag">
                {week.map((d) => (
                  <div key={d.date} className={`week-bar ${d.date === t ? 'today' : ''}`}>
                    <span className="tiny muted">{WEEKDAY_SHORT[d.weekday]}</span>
                    <span className="bar" style={{ height: `${Math.round((d.targets.kcal / max) * 100)}%` }} />
                    <span className="tiny tnum">{fmt(d.targets.kcal)}</span>
                  </div>
                ))}
              </div>
              {todayNeeds && (
                <details className="table-view">
                  <summary>So rechne ich heute</summary>
                  <table className="data-table">
                    <tbody>
                      <tr>
                        <td>Grundumsatz × 1,2</td>
                        <td className="tnum">{fmt(todayNeeds.breakdown.base)} kcal</td>
                      </tr>
                      <tr>
                        <td>Arbeit / Uni</td>
                        <td className="tnum">{fmtSigned(todayNeeds.breakdown.work)} kcal</td>
                      </tr>
                      <tr>
                        <td>Wege & Alltag</td>
                        <td className="tnum">{fmtSigned(todayNeeds.breakdown.active)} kcal</td>
                      </tr>
                      <tr>
                        <td>Training</td>
                        <td className="tnum">{fmtSigned(todayNeeds.breakdown.exercise)} kcal</td>
                      </tr>
                      {todayNeeds.breakdown.calibration !== 0 && (
                        <tr>
                          <td>Kalibrierung (Essen & Gewicht)</td>
                          <td className="tnum">{fmtSigned(todayNeeds.breakdown.calibration)} kcal</td>
                        </tr>
                      )}
                      <tr>
                        <td>Ziel ({fmtSigned(goals.weeklyRate, 2)} kg/Woche)</td>
                        <td className="tnum">{fmtSigned(todayNeeds.breakdown.adjustment)} kcal</td>
                      </tr>
                      <tr>
                        <td>
                          <strong>Heute</strong>
                        </td>
                        <td className="tnum">
                          <strong>{fmt(todayNeeds.targets.kcal)} kcal</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </details>
              )}
              <p className="tiny muted">Passt sich automatisch an Wochenrate, Trainingsplan, Alltag und deinen gemessenen Verbrauch an.</p>
            </>
          ) : (
            <p className="small text-2">Für die Automatik brauche ich Alter, Größe und dein Gewicht (unten eintragen).</p>
          )
        ) : (
          <>
            <div className="grid-2">
              <NumField label="Kalorien Ø" suffix="kcal" value={goals.kcal} onChange={num('kcal')} />
              <NumField label="Protein" suffix="g" value={goals.protein} onChange={num('protein')} />
              <NumField label="Kohlenhydrate" suffix="g" value={goals.carbs} onChange={num('carbs')} />
              <NumField label="Fett" suffix="g" value={goals.fat} onChange={num('fat')} />
            </div>
            <div className="row">
              <p className="small muted grow">
                Makros = {fmt(macroKcal)} kcal{weight ? ` · Protein ${fmt(goals.protein / weight, 1)} g/kg` : ''}
              </p>
              {Math.abs(macroKcal - goals.kcal) > 100 && (
                <InfoBang title="Makros passen nicht" tone="warn">
                  Deine Makros ergeben {fmt(macroKcal)} kcal, dein Kalorienziel ist {fmt(goals.kcal)} kcal. Passe Kohlenhydrate oder Fett an.
                </InfoBang>
              )}
            </div>
            <button className="btn block" onClick={takeOver}>
              Berechnete Werte übernehmen
            </button>
            <p className="tiny muted">Dein Kalorienziel ist der Wochenschnitt – Trainingstage bekommen mehr, Ruhetage weniger.</p>
          </>
        )}
      </Card>

      {preview && (
        <Card
          title="Rahmenbedingungen"
          action={
            broken.length > 0 ? (
              <InfoBang title={`${broken.length} Regel${broken.length > 1 ? 'n' : ''} verletzt`} tone="warn">
                <ul className="bang-list">
                  {broken.map((x) => (
                    <li key={x.id}>
                      <strong>{x.label}:</strong> {x.fix}
                    </li>
                  ))}
                </ul>
                Beim Speichern passe ich Ziele automatisch an die Regeln an.
              </InfoBang>
            ) : undefined
          }
        >
          <p className="tiny muted">Das MUSS immer gelten – alles andere passt sich an deine Pläne an. Auch der Coach hält sich daran.</p>
          <ul className="rules">
            {preview.rules.map((x) => (
              <li key={x.id} className={x.ok ? 'ok' : 'bad'}>
                <span className="rule-dot" aria-hidden="true">
                  {x.ok ? '✓' : '!'}
                </span>
                <span className="grow">
                  <strong className="small">{x.label}</strong>
                  <span className="tiny muted">{x.requirement}</span>
                </span>
                <span className="tiny tnum">{x.current}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

export function WeightCard({ today, goals }: { today: string; goals: Goals }) {
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
