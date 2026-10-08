import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openCoach } from '../coachBus';
import { NumField, Seg, toast } from '../components/ui';
import { db, getKV, setKV } from '../db';
import { navigate, useToday } from '../hooks';
import { resolveGoals } from '../lib/autoGoals';
import { DEFAULT_SCHEDULE, weekNeeds, type NeedsInput } from '../lib/dailyNeeds';
import { bmr, GOAL_CONFIG, KCAL_PER_KG_WEEK_PER_DAY } from '../lib/goals';
import { enforceGoals, limits } from '../lib/guardrails';
import { SPORT_DEFS } from '../lib/sports';
import { fmt, fmtSigned } from '../lib/stats';
import { activityFactor, starterPlan, type TimeOfDay } from '../lib/starterPlan';
import type { DayKind, GoalType, Goals, Profile, Sport, TrainingPlan, WeekSchedule } from '../types';
import { DAY_KIND_LABELS, DEFAULT_GOALS, GOAL_LABELS, INTENSITY_LABELS, SPORTS, WEEKDAY_SHORT } from '../types';
import { SPORT_PATHS, SportIcon } from '../components/SportIcon';

type Num = number | '';
type PlanMode = 'start' | 'behalten' | 'ohne';

interface Draft {
  sex: 'm' | 'w';
  age: Num;
  height: Num;
  weight: Num;
  type: GoalType;
  rate: number;
  sports: Sport[];
  days: number;
  time: TimeOfDay;
  kind: DayKind;
  start: string;
  end: string;
  wake: string;
  sleep: string;
  activeMinutes: number;
  canCook: boolean;
  planMode: PlanMode;
}

const STEPS = ['willkommen', 'koerper', 'ziel', 'sport', 'alltag', 'plan', 'zusammenhang', 'fertig'] as const;
type Step = (typeof STEPS)[number];

/** Linien-Icons (24er-Raster) für Ziele und das Schaubild – keine Emojis. */
const ICON: Record<string, string[]> = {
  defizit: ['M3 7l6 6 4-4 8 8', 'M15 17h6v-6'],
  erhalt: ['M4 9h16', 'M4 15h16'],
  aufbau: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  kraft: ['M2 12h20', 'M5 8.5v7', 'M8 6.5v11', 'M16 6.5v11', 'M19 8.5v7'],
  recomp: ['M4 12a8 8 0 0 1 13.7-5.6L20 9', 'M20 4v5h-5', 'M20 12a8 8 0 0 1-13.7 5.6L4 15', 'M4 20v-5h5'],
  ziel: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18', 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9', 'M12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2'],
  training: SPORT_PATHS.laufen,
  alltag: ['M4 21V6l8-3 8 3v15', 'M9 21v-4h6v4', 'M8.5 8.5h1.5', 'M14 8.5h1.5', 'M8.5 12.5h1.5', 'M14 12.5h1.5'],
  koerper: ['M12 4v16', 'M7 20h10', 'M5 8h14', 'M5 8l-2.5 6a2.5 2.5 0 0 0 5 0Z', 'M19 8l-2.5 6a2.5 2.5 0 0 0 5 0Z'],
  essen: ['M7 3v8', 'M4.5 3v5a2.5 2.5 0 0 0 5 0V3', 'M7 11v10', 'M16 3c-1.7 1-2.5 3-2.5 6s1 4 2.5 4.5V21'],
};

function LineIcon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Geführte Einrichtung: führt Schritt für Schritt durch Körper, Ziel, Sport, Alltag und Plan
 * und zeigt mit Animationen, wie daraus der Tagesbedarf entsteht.
 */
export function OnboardingView() {
  const t = useToday();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stored, setStored] = useState<{ goals: Goals; plan: TrainingPlan | null } | null>(null);
  const [step, setStep] = useState<Step>('willkommen');

  // Vorhandene Daten vorausfüllen – wer die Einrichtung wiederholt, fängt nicht bei null an
  useEffect(() => {
    void (async () => {
      const [profile, goals, schedule, plan, last] = await Promise.all([
        getKV<Profile | null>('profile', null),
        getKV<Goals>('goals', DEFAULT_GOALS),
        getKV<WeekSchedule | null>('schedule', null),
        getKV<TrainingPlan | null>('trainingPlan', null),
        db.weights.orderBy('date').last(),
      ]);
      const mo = (schedule ?? DEFAULT_SCHEDULE)[0];
      const planSports = [...new Set(plan?.sessions.map((s) => s.sport) ?? [])];
      setStored({ goals, plan });
      setDraft({
        sex: profile?.sex ?? 'm',
        age: profile?.age ?? '',
        height: profile?.height ?? '',
        weight: last?.weight ?? '',
        type: goals.type,
        rate: goals.weeklyRate,
        sports: planSports.length ? planSports : ['laufen'],
        days: plan ? new Set(plan.sessions.map((s) => s.weekday)).size : goals.trainingDays,
        time: 'abends',
        kind: mo.kind === 'frei' ? 'buero' : mo.kind,
        start: mo.start ?? '08:00',
        end: mo.end ?? '16:30',
        wake: mo.wake,
        sleep: mo.sleep,
        activeMinutes: mo.activeMinutes,
        canCook: mo.canCook,
        planMode: plan?.sessions.length ? 'behalten' : 'start',
      });
    })();
  }, []);

  const model = useMemo(() => (draft && stored ? buildModel(draft, stored, t) : null), [draft, stored, t]);
  if (!draft || !stored || !model) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const idx = STEPS.indexOf(step);
  const go = (d: number) => {
    setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + d))]);
    window.scrollTo(0, 0);
  };
  const missingBody = draft.age === '' || draft.height === '' || draft.weight === '';
  const canNext = step === 'koerper' ? !missingBody : step === 'sport' ? draft.sports.length > 0 : true;

  const finish = async () => {
    await save(draft, stored, model, t);
    go(1);
  };
  const skip = async () => {
    await setKV('onboarded', true);
    navigate('ich');
  };

  return (
    <div className="content onboarding">
      {step !== 'willkommen' && (
        <div className="ob-progress" aria-label={`Schritt ${idx} von ${STEPS.length - 1}`}>
          {STEPS.slice(1).map((s, i) => (
            <span key={s} className={i < idx ? 'on' : ''} />
          ))}
        </div>
      )}

      {step === 'willkommen' && (
        <Panel key="w">
          <FlowDiagram />
          <h1 className="ob-title">Alles hängt zusammen</h1>
          <p className="text-2">
            Dein <strong>Ziel</strong>, dein <strong>Training</strong>, dein <strong>Alltag</strong> und dein <strong>Körper</strong> bestimmen, wie viel Energie du jeden Tag
            brauchst. Daraus macht Giova deinen Tagesbedarf, Rezepte und Tipps – jeden Tag neu.
          </p>
          <p className="small muted">In 2 Minuten führe ich dich durch alles. Du kannst später jederzeit etwas ändern.</p>
        </Panel>
      )}

      {step === 'koerper' && (
        <Panel key="k" title="Über dich" why="Daraus berechne ich deinen Grundumsatz – die Energie, die dein Körper in Ruhe braucht.">
          <Seg
            value={draft.sex}
            onChange={(v) => set({ sex: v })}
            label="Geschlecht"
            options={[
              { value: 'm', label: 'Männlich' },
              { value: 'w', label: 'Weiblich' },
            ]}
          />
          <div className="grid-3">
            <NumField label="Alter" suffix="J." value={draft.age} onChange={(v) => set({ age: v })} />
            <NumField label="Größe" suffix="cm" value={draft.height} onChange={(v) => set({ height: v })} />
            <NumField label="Gewicht" suffix="kg" value={draft.weight} onChange={(v) => set({ weight: v })} />
          </div>
          {model.bmr > 0 && (
            <div className="ob-number">
              <span className="small muted">Grundumsatz</span>
              <CountUp value={model.bmr} suffix=" kcal" />
            </div>
          )}
        </Panel>
      )}

      {step === 'ziel' && (
        <Panel key="z" title="Dein Ziel" why="Das Ziel legt fest, wie viel du pro Woche ab- oder zunehmen willst – und damit, wie viel du täglich mehr oder weniger isst.">
          <div className="goal-cards">
            {(Object.keys(GOAL_LABELS) as GoalType[]).map((g) => (
              <button
                key={g}
                type="button"
                className="goal-card"
                aria-pressed={draft.type === g}
                onClick={() => {
                  const w = Number(draft.weight) || 75;
                  set({ type: g, rate: clampRate(Math.round(w * GOAL_CONFIG[g].rateFraction * 20) / 20, model.lim) });
                }}
              >
                <span className="goal-icon">
                  <LineIcon name={g} />
                </span>
                <strong>{GOAL_LABELS[g]}</strong>
                <span className="tiny muted">{GOAL_CONFIG[g].description}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              Tempo: <strong>{fmtSigned(draft.rate, 2)} kg/Woche</strong> = {fmtSigned(Math.round(draft.rate * KCAL_PER_KG_WEEK_PER_DAY))} kcal pro Tag
            </span>
            <input
              type="range"
              className="range"
              min={-model.lim.maxLossPerWeek}
              max={model.lim.maxGainPerWeek}
              step={0.05}
              value={draft.rate}
              onChange={(e) => set({ rate: Number(e.target.value) })}
            />
            <span className="tiny muted">
              Rahmen: höchstens {fmt(model.lim.maxLossPerWeek, 2)} kg abnehmen bzw. {fmt(model.lim.maxGainPerWeek, 2)} kg zunehmen pro Woche – schneller kostet Muskeln.
            </span>
          </label>
        </Panel>
      )}

      {step === 'sport' && (
        <Panel key="s" title="Dein Sport" why="Jede Einheit verbraucht Energie. An Trainingstagen brauchst du mehr – vor allem Kohlenhydrate.">
          <div className="chips wrap">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={draft.sports.includes(s)}
                onClick={() => set({ sports: draft.sports.includes(s) ? draft.sports.filter((x) => x !== s) : [...draft.sports, s] })}
              >
                <SportIcon sport={s} /> {SPORT_DEFS[s].label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              Trainingstage pro Woche: <strong>{draft.days}</strong>
            </span>
            <input type="range" className="range" min={1} max={6} step={1} value={draft.days} onChange={(e) => set({ days: Number(e.target.value) })} />
            <span className="tiny muted">Mindestens 1 Ruhetag ist Pflicht – Fortschritt entsteht in der Erholung.</span>
          </label>
          <Seg
            value={draft.time}
            onChange={(v) => set({ time: v })}
            label="Trainingszeit"
            options={[
              { value: 'morgens', label: 'Morgens' },
              { value: 'mittags', label: 'Mittags' },
              { value: 'abends', label: 'Abends' },
            ]}
          />
        </Panel>
      )}

      {step === 'alltag' && (
        <Panel key="a" title="Dein Alltag (Mo–Fr)" why="Wer im Stehen arbeitet oder viel läuft, verbraucht täglich mehrere hundert kcal mehr als im Büro.">
          <div className="kind-grid">
            {(Object.keys(DAY_KIND_LABELS) as DayKind[]).map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={draft.kind === k} onClick={() => set({ kind: k })}>
                {DAY_KIND_LABELS[k].split(' (')[0]}
              </button>
            ))}
          </div>
          {draft.kind !== 'frei' && (
            <div className="grid-2">
              <label className="field">
                <span>Beginn</span>
                <input className="input" type="time" value={draft.start} onChange={(e) => set({ start: e.target.value })} />
              </label>
              <label className="field">
                <span>Ende</span>
                <input className="input" type="time" value={draft.end} onChange={(e) => set({ end: e.target.value })} />
              </label>
            </div>
          )}
          <label className="field">
            <span>
              Wege zu Fuß / Rad pro Tag: <strong>{draft.activeMinutes} min</strong>
            </span>
            <input type="range" className="range" min={0} max={120} step={5} value={draft.activeMinutes} onChange={(e) => set({ activeMinutes: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.canCook} onChange={(e) => set({ canCook: e.target.checked })} />
            Tagsüber warm essen möglich (Küche, Mensa, Kantine)
          </label>
          <p className="tiny muted">Wochenende zählt als frei. Einzelne Tage kannst du später unter Plan & Alltag anpassen.</p>
        </Panel>
      )}

      {step === 'plan' && (
        <Panel key="p" title="Dein Trainingsplan" why="Der Plan sagt mir, an welchen Tagen du mehr Energie brauchst – so passt der Bedarf zu jedem einzelnen Tag.">
          <div className="stack">
            {stored.plan?.sessions.length ? (
              <PlanOption mode="behalten" draft={draft} set={set} title="Meinen Plan behalten" sub={`${stored.plan.sessions.length} Einheiten · ${stored.plan.name}`} />
            ) : null}
            <PlanOption mode="start" draft={draft} set={set} title="Startplan erstellen" sub={`${draft.days} Einheiten aus deinen Sportarten – jederzeit änderbar`} />
            {!stored.plan?.sessions.length && <PlanOption mode="ohne" draft={draft} set={set} title="Später" sub="Plan selbst eintragen oder als Foto/PDF hochladen" />}
          </div>
          {model.plan && (
            <div className="ob-plan">
              {model.plan.sessions
                .slice()
                .sort((a, b) => a.weekday - b.weekday)
                .map((s, i) => (
                  <div key={s.id} className="ob-plan-row" style={{ animationDelay: `${i * 90}ms` }}>
                    <span className="wd-label">{WEEKDAY_SHORT[s.weekday]}</span>
                    <span className="grow">
                      <SportIcon sport={s.sport} /> {s.title}
                    </span>
                    <span className="tiny muted">
                      {s.durationMin} min · {INTENSITY_LABELS[s.intensity]}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Panel>
      )}

      {step === 'zusammenhang' && <Explain model={model} draft={draft} />}

      {step === 'fertig' && (
        <Panel key="f">
          <div className="ob-done" aria-hidden="true">
            ✓
          </div>
          <h1 className="ob-title">Alles eingerichtet</h1>
          <p className="text-2">
            Dein Tagesbedarf passt sich ab jetzt automatisch an: an jedes Training, an deinen Alltag und an deinen echten Verbrauch, sobald du ein paar Wochen Essen
            und Gewicht einträgst.
          </p>
          <div className="stack">
            <button className="btn primary block" onClick={() => navigate('ich')}>
              Zu meiner Übersicht
            </button>
            <button
              className="btn block"
              onClick={() => {
                navigate('ich');
                setTimeout(() => openCoach('Geh mit mir meine Ziele, meinen Alltag und meinen Trainingsplan durch und schlag mir Verbesserungen vor.'), 60);
              }}
            >
              Mit dem Coach feinjustieren
            </button>
          </div>
        </Panel>
      )}

      {step !== 'fertig' && (
        <div className="ob-actions">
          {idx === 0 ? (
            <button className="btn ghost" onClick={skip}>
              Überspringen
            </button>
          ) : (
            <button className="btn" onClick={() => go(-1)}>
              Zurück
            </button>
          )}
          {step === 'zusammenhang' ? (
            <button className="btn primary grow" onClick={finish}>
              Übernehmen
            </button>
          ) : (
            <button className="btn primary grow" onClick={() => go(1)} disabled={!canNext}>
              {idx === 0 ? 'Los geht’s' : 'Weiter'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Modell & Speichern

function clampRate(rate: number, lim: { maxLossPerWeek: number; maxGainPerWeek: number }) {
  return Math.min(lim.maxGainPerWeek, Math.max(-lim.maxLossPerWeek, rate));
}

function schedule(d: Draft): WeekSchedule {
  const work = { kind: d.kind, ...(d.kind !== 'frei' ? { start: d.start, end: d.end } : {}), wake: d.wake, sleep: d.sleep, activeMinutes: d.activeMinutes, canCook: d.canCook };
  const free = { kind: 'frei' as const, wake: '08:30', sleep: '23:30', activeMinutes: d.activeMinutes, canCook: true };
  return [work, work, work, work, work, free, free].map((x) => ({ ...x }));
}

type Model = ReturnType<typeof buildModel>;

function buildModel(d: Draft, stored: { goals: Goals; plan: TrainingPlan | null }, today: string) {
  const weight = Number(d.weight) || null;
  const profile: Profile | null = d.age !== '' && d.height !== '' ? { sex: d.sex, age: Number(d.age), height: Number(d.height), activity: activityFactor(d.days) } : null;
  const lim = limits(profile, weight);
  const plan = d.planMode === 'start' ? starterPlan(d.sports, d.days, d.time) : d.planMode === 'behalten' ? stored.plan : null;
  const goals: Goals = { ...stored.goals, type: d.type, weeklyRate: clampRate(d.rate, lim), auto: true, trainingDays: Math.min(6, d.days) };
  const input: NeedsInput = { goals, profile, weight, schedule: schedule(d), plan, activities: [], detailed: true };
  const resolved = resolveGoals(input, today);
  const week = weekNeeds(today, { ...input, goals: resolved });
  const avg = (k: 'base' | 'work' | 'active' | 'exercise' | 'adjustment') => Math.round(week.reduce((s, x) => s + x.breakdown[k], 0) / 7);
  return {
    profile,
    weight,
    lim,
    plan,
    goals: resolved,
    week,
    bmr: profile && weight ? Math.round(bmr(profile, weight)) : 0,
    parts: { base: avg('base'), daily: avg('work') + avg('active'), training: avg('exercise'), goal: avg('adjustment') },
  };
}

async function save(d: Draft, stored: { goals: Goals; plan: TrainingPlan | null }, m: Model, today: string) {
  if (m.profile) await setKV('profile', m.profile);
  if (m.weight) {
    const existing = await db.weights.where('date').equals(today).first();
    if (existing?.id != null) await db.weights.update(existing.id, { weight: m.weight });
    else await db.weights.add({ date: today, weight: m.weight });
  }
  const { goals } = enforceGoals({ ...stored.goals, type: d.type, weeklyRate: m.goals.weeklyRate, auto: true, trainingDays: Math.min(6, d.days), kcal: m.goals.kcal, protein: m.goals.protein, carbs: m.goals.carbs, fat: m.goals.fat }, m.lim);
  await setKV('goals', goals);
  await setKV('schedule', schedule(d));
  if (d.planMode === 'start' && m.plan) await setKV('trainingPlan', m.plan);
  await setKV('onboarded', true);
  toast('Eingerichtet – dein Tagesbedarf ist berechnet');
}

// ------------------------------------------------------------------ Bausteine

function Panel({ title, why, children }: { title?: string; why?: string; children: ReactNode }) {
  return (
    <section className="ob-panel">
      {title && <h1 className="ob-title">{title}</h1>}
      {why && (
        <p className="ob-why">
          <strong>Warum? </strong>
          {why}
        </p>
      )}
      {children}
    </section>
  );
}

function PlanOption({ mode, draft, set, title, sub }: { mode: PlanMode; draft: Draft; set: (p: Partial<Draft>) => void; title: string; sub: string }) {
  return (
    <button type="button" className="plan-option" aria-pressed={draft.planMode === mode} onClick={() => set({ planMode: mode })}>
      <strong>{title}</strong>
      <span className="tiny muted">{sub}</span>
    </button>
  );
}

/** Zählt eine Zahl hoch (ohne Animation, wenn weniger Bewegung gewünscht ist). */
function CountUp({ value, suffix = '', delay = 0 }: { value: number; suffix?: string; delay?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / 900));
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay]);
  return (
    <span className="count-up tnum">
      {fmt(shown)}
      {suffix}
    </span>
  );
}

/** Animiertes Schaubild: Ziel, Training, Alltag und Körper fließen in den Tagesbedarf. */
function FlowDiagram() {
  const nodes = [
    { x: 60, y: 46, icon: 'ziel', label: 'Ziel' },
    { x: 260, y: 46, icon: 'training', label: 'Training' },
    { x: 60, y: 186, icon: 'alltag', label: 'Alltag' },
    { x: 260, y: 186, icon: 'koerper', label: 'Körper' },
  ];
  return (
    <svg className="flow" viewBox="0 0 320 300" role="img" aria-label="Ziel, Training, Alltag und Körper ergeben zusammen den Tagesbedarf, daraus entstehen Essen und Rezepte">
      {nodes.map((n, i) => (
        <line key={`l${i}`} className="flow-line" x1={n.x} y1={n.y} x2={160} y2={116} style={{ animationDelay: `${300 + i * 150}ms, ${1200 + i * 150}ms` }} />
      ))}
      <line className="flow-line" x1={160} y1={116} x2={160} y2={262} style={{ animationDelay: '1000ms, 1900ms' }} />
      {nodes.map((n, i) => (
        <g key={n.label} className="flow-node" style={{ animationDelay: `${i * 150}ms` }}>
          <circle cx={n.x} cy={n.y} r={30} />
          <g className="flow-icon" transform={`translate(${n.x - 14} ${n.y - 14}) scale(${28 / 24})`}>
            {ICON[n.icon].map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <text x={n.x} y={n.y + 48} textAnchor="middle" className="flow-label">
            {n.label}
          </text>
        </g>
      ))}
      <g className="flow-node flow-center" style={{ animationDelay: '700ms' }}>
        <circle cx={160} cy={116} r={50} />
        <g className="flow-icon accent" transform="translate(146 88) scale(1.1667)">
          {ICON.essen.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <text x={160} y={136} textAnchor="middle" className="flow-label strong small-label">
          Tagesbedarf
        </text>
      </g>
      <g className="flow-node" style={{ animationDelay: '1100ms' }}>
        <rect x={84} y={248} width={152} height={40} rx={20} className="flow-pill" />
        <text x={160} y={273} textAnchor="middle" className="flow-label strong on-accent">
          Essen · Rezepte · Coach
        </text>
      </g>
    </svg>
  );
}

/** Wasserfall: Grundumsatz + Alltag + Training ± Ziel = Tagesbedarf – Balken wachsen nacheinander. */
function Explain({ model, draft }: { model: Model; draft: Draft }) {
  const { base, daily, training, goal } = model.parts;
  const total = model.goals.kcal;
  const max = Math.max(base + daily + training, total) * 1.05;
  const pct = (v: number) => `${(Math.abs(v) / max) * 100}%`;
  const rows: { label: string; value: number; offset: number; cls: string; note: string }[] = [
    { label: 'Grundumsatz × 1,2', value: base, offset: 0, cls: 'seg-base', note: 'Körper in Ruhe + Verdauung' },
    { label: 'Alltag', value: daily, offset: base, cls: 'seg-daily', note: `${DAY_KIND_LABELS[draft.kind].split(' (')[0]}, ${draft.activeMinutes} min Wege` },
    { label: 'Training', value: training, offset: base + daily, cls: 'seg-training', note: `Ø pro Tag bei ${model.plan?.sessions.length ?? 0} Einheiten` },
    {
      label: 'Ziel',
      value: goal,
      offset: goal < 0 ? base + daily + training + goal : base + daily + training,
      cls: 'seg-goal',
      note: `${fmtSigned(model.goals.weeklyRate, 2)} kg/Woche`,
    },
  ];
  const wmax = Math.max(...model.week.map((d) => d.targets.kcal));
  return (
    <section className="ob-panel">
      <h1 className="ob-title">So entsteht dein Tagesbedarf</h1>
      <div className="waterfall" role="img" aria-label={`Grundumsatz ${base}, Alltag ${daily}, Training ${training}, Ziel ${goal}, Tagesbedarf ${total} kcal`}>
        {rows.map((r, i) => (
          <div key={r.label} className="wf-row">
            <div className="wf-head">
              <span>{r.label}</span>
              <strong className="tnum">
                {i === 0 ? '' : r.value >= 0 ? '+' : '−'}
                {fmt(Math.abs(r.value))} kcal
              </strong>
            </div>
            <div className="wf-track">
              <span className={`wf-bar ${r.cls}`} style={{ marginLeft: pct(r.offset), width: pct(r.value), animationDelay: `${i * 450}ms` }} />
            </div>
            <span className="tiny muted">{r.note}</span>
          </div>
        ))}
        <div className="wf-row total">
          <div className="wf-head">
            <span>= Tagesbedarf (Ø)</span>
            <strong>
              <CountUp value={total} suffix=" kcal" delay={1800} />
            </strong>
          </div>
          <div className="wf-track">
            <span className="wf-bar seg-total" style={{ width: pct(total), animationDelay: '1800ms' }} />
          </div>
        </div>
      </div>

      <h2 className="ob-sub">Jeder Tag ist anders</h2>
      <div className="ob-week" role="img" aria-label="Tagesbedarf je Wochentag">
        {model.week.map((d, i) => (
          <div key={d.date} className="ob-day">
            <span className="tiny tnum">{fmt(d.targets.kcal)}</span>
            <span className="ob-day-bar" style={{ height: `${(d.targets.kcal / wmax) * 100}%`, animationDelay: `${2300 + i * 80}ms` }} />
            <span className="tiny">{WEEKDAY_SHORT[d.weekday]}</span>
            <span className="tiny" aria-hidden="true">
              {d.sessions.map((s) => <SportIcon key={s.id} sport={s.sport} size={13} />)}
              {!d.sessions.length && '·'}
            </span>
          </div>
        ))}
      </div>

      <ul className="ob-facts">
        <li style={{ animationDelay: '2900ms' }}>
          <strong>Mehr Training → mehr Energie:</strong> An Trainingstagen gibt es mehr, vor allem Kohlenhydrate. Ruhetage bekommen weniger.
        </li>
        <li style={{ animationDelay: '3100ms' }}>
          <strong>Ziel {fmtSigned(model.goals.weeklyRate, 2)} kg/Woche</strong> = {fmtSigned(Math.round(model.goals.weeklyRate * KCAL_PER_KG_WEEK_PER_DAY))} kcal jeden Tag.
        </li>
        <li style={{ animationDelay: '3300ms' }}>
          <strong>Protein {fmt(model.goals.protein)} g und Fett {fmt(model.goals.fat)} g</strong> bleiben jeden Tag gleich – die Kohlenhydrate gleichen aus.
        </li>
        <li style={{ animationDelay: '3500ms' }}>
          <strong>Rahmen:</strong> nie unter {fmt(model.lim.minKcal)} kcal, mind. 1 Ruhetag, höchstens 3 harte Einheiten – darauf achten App und Coach immer.
        </li>
        <li style={{ animationDelay: '3700ms' }}>
          <strong>Wird genauer:</strong> Mit 3 Wochen Essen & Gewicht gleiche ich die Rechnung mit deinem echten Verbrauch ab.
        </li>
      </ul>
    </section>
  );
}
