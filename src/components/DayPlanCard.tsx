import { InfoBang } from './InfoBang';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { generateDayPlan } from '../ai/mealPlan';
import { db, getKV } from '../db';
import { navigate, useApiKey } from '../hooks';
import { mealTypeAt, type DayNeeds } from '../lib/dailyNeeds';
import { today as getToday } from '../lib/dates';
import { sumMacros } from '../lib/nutrition';
import { fmt, fmtSigned } from '../lib/stats';
import { DEFAULT_PREFS } from '../needs';
import type { MealEntry, NutritionPreferences, PlannedMeal } from '../types';
import { INTENSITY_LABELS, MEAL_LABELS } from '../types';
import { macroText } from './AddFoodSheet';
import { IconCalendar, IconCheck, IconSparkle } from './icons';
import { Markdown } from './Markdown';
import { Card, ErrorBox, toast } from './ui';
import { SportIcon } from './SportIcon';

/** Tagesbedarf nach Training & Alltag + KI-Tagesplan mit Rezepten aus der eigenen Bibliothek. */
export function DayPlanCard({ date, needs }: { date: string; needs: DayNeeds & { configured: boolean } }) {
  const apiKey = useApiKey();
  const plan = useLiveQuery(() => db.dayPlans.get(date), [date]);
  const foodsCount = useLiveQuery(() => db.foods.count(), []) ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (fromNow: boolean) => {
    if (!apiKey) return navigate('einstellungen');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const [foods, prefs, eaten] = await Promise.all([
        db.foods.toArray(),
        getKV<NutritionPreferences>('nutritionPrefs', DEFAULT_PREFS),
        db.meals.where('date').equals(date).toArray(),
      ]);
      const now = fromNow ? new Date().toTimeString().slice(0, 5) : null;
      const result = await generateDayPlan(apiKey, needs, foods, prefs, fromNow ? eaten : [], now, ctrl.signal);
      await db.dayPlans.put(result);
      setOpen(true);
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const logMeal = async (m: PlannedMeal) => {
    const now = Date.now();
    const rows: MealEntry[] = m.items.map((it, i) => ({
      date,
      meal: mealTypeAt(m.time),
      name: it.name,
      amount: it.amount,
      unit: it.unit,
      ...(it.foodId != null ? { foodId: it.foodId } : {}),
      ...it.macros,
      createdAt: now + i,
    }));
    await db.meals.bulkAdd(rows);
    toast(`${m.title} eingetragen (${MEAL_LABELS[mealTypeAt(m.time)]})`);
  };

  const b = needs.breakdown;
  const isToday = date === getToday();
  const planTotal = plan ? sumMacros(plan.meals.map((m) => m.total)) : null;

  return (
    <Card
      title={
        <div className="row">
          <IconCalendar width={20} height={20} />
          <h2>Dein Bedarf {isToday ? 'heute' : 'an diesem Tag'}</h2>
        </div>
      }
      action={
        <div className="row">
          {(needs.notes.length > 0 || !needs.configured) && (
            <InfoBang title="Hinweise für diesen Tag" count={needs.notes.length + (needs.configured ? 0 : 1)}>
              {needs.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
              {!needs.configured && (
                <p>
                  Hinterlege deinen <a href="#/plan">Trainingsplan und Alltag</a> (Arbeit, Uni, Wege) – dann passt sich der Bedarf jedem Tag genau an.
                </p>
              )}
            </InfoBang>
          )}
          <a className="small" href="#/plan">
            Plan & Alltag
          </a>
        </div>
      }
    >
      <div className="row between wrap tnum">
        <span className="hero" style={{ fontSize: '2rem' }}>
          {fmt(needs.targets.kcal)} <small className="small muted">kcal</small>
        </span>
        <span className="small text-2">
          P {fmt(needs.targets.protein)} g · KH {fmt(needs.targets.carbs)} g · F {fmt(needs.targets.fat)} g
        </span>
      </div>
      <div className="chips">
        {needs.done.map((a) => (
          <span key={a.uid} className="badge">
            <SportIcon sport={a.sport} /> {a.title} ✓
          </span>
        ))}
        {needs.sessions.map((s) => (
          <span key={s.id} className="badge">
            <SportIcon sport={s.sport} /> {s.time ? `${s.time} ` : ''}
            {s.title} · {INTENSITY_LABELS[s.intensity]}
          </span>
        ))}
        {!needs.done.length && !needs.sessions.length && <span className="badge">Ruhetag</span>}
        {needs.delta !== 0 && (
          <span className="badge">
            {needs.delta > 0 ? '+' : ''}
            {fmt(needs.delta)} kcal ggü. Ø
          </span>
        )}
      </div>
      <details className="table-view">
        <summary>Wie berechnet?</summary>
        <table className="data-table">
          <tbody>
            {needs.estimatedTdee != null && (
              <tr>
                <td>{needs.configured ? 'Grundbedarf (Grundumsatz × 1,2)' : 'Grundumsatz × Aktivitätsfaktor (pauschal)'}</td>
                <td>{fmt(b.base)} kcal</td>
              </tr>
            )}
            {needs.configured && (
              <>
                <tr>
                  <td>Arbeit / Uni</td>
                  <td>+{fmt(b.work)} kcal</td>
                </tr>
                <tr>
                  <td>Wege zu Fuß / Rad</td>
                  <td>+{fmt(b.active)} kcal</td>
                </tr>
                <tr>
                  <td>Training</td>
                  <td>+{fmt(b.exercise)} kcal</td>
                </tr>
              </>
            )}
            {b.calibration !== 0 && (
              <tr>
                <td>Kalibrierung (gemessen aus Essen & Gewicht)</td>
                <td>{fmtSigned(b.calibration)} kcal</td>
              </tr>
            )}
            {needs.estimatedTdee != null && (
              <tr>
                <td>Geschätzter Verbrauch</td>
                <td>{fmt(needs.estimatedTdee)} kcal</td>
              </tr>
            )}
            <tr>
              <td>Zielanpassung (Wochenrate)</td>
              <td>{fmt(b.adjustment)} kcal</td>
            </tr>
          </tbody>
        </table>
        <p className="tiny muted">
          {needs.auto
            ? 'Automatisch: Verbrauch dieses Tages + Zielanpassung – jeder Tag bekommt genau seinen Mehr- oder Minderbedarf. Protein und Fett bleiben gleich, Kohlenhydrate gleichen aus. Nie unter deinem Grundumsatz.'
            : 'Manuell: Dein Kalorienziel aus „Ziele“ ist der Wochenschnitt. Jeder Tag weicht genau um seine Mehr- oder Minderbelastung davon ab; Protein und Fett bleiben gleich, Kohlenhydrate gleichen aus.'}
        </p>
      </details>

      <div className="section-title" style={{ margin: '4px 0 0' }}>
        Mahlzeiten-Timing
      </div>
      <div className="list">
        {needs.slots.map((s) => (
          <div key={s.slot + s.time} className="list-item">
            <span className="tnum small" style={{ width: 44 }}>
              {s.time}
            </span>
            <div className="main">
              <div className="title">{s.slot}</div>
              <div className="meta">
                ca. {fmt(needs.targets.kcal * s.share)} kcal{s.hint ? ` · ${s.hint}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {busy && (
        <div className="row">
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
          <span className="small muted">Die KI plant deine Mahlzeiten …</span>
        </div>
      )}
      {!plan && !busy && (
        <>
          <button className="btn primary" onClick={() => run(false)}>
            <IconSparkle /> {apiKey ? 'KI-Tagesplan erstellen' : 'KI einrichten (API-Schlüssel)'}
          </button>
          {foodsCount < 5 && (
            <p className="tiny muted">
              Tipp: Je mehr Lebensmittel du fotografierst (unten „Scannen“), desto besser passen die Rezepte zu dem, was du zu Hause hast.
            </p>
          )}
        </>
      )}

      {plan && (
        <div className="stack">
          <div className="row between">
            <strong>KI-Tagesplan</strong>
            <button className="btn ghost small" onClick={() => setOpen((v) => !v)}>
              {open ? 'Einklappen' : `${plan.meals.length} Mahlzeiten anzeigen`}
            </button>
          </div>
          {planTotal && (
            <p className="tiny text-2 tnum">
              Plan: {macroText(planTotal)} · Ziel {fmt(plan.targets.kcal)} kcal / {fmt(plan.targets.protein)} g Protein
            </p>
          )}
          {open &&
            plan.meals.map((m) => (
              <div key={m.slot + m.time} className="planned-meal">
                <div className="row between">
                  <div>
                    <div className="tiny muted">
                      {m.time} · {m.slot} · {m.prepMinutes} min
                    </div>
                    <h3>{m.title}</h3>
                  </div>
                  <button className="btn small" onClick={() => logMeal(m)} aria-label={`${m.title} eintragen`}>
                    <IconCheck /> Eintragen
                  </button>
                </div>
                <ul className="small ingredients">
                  {m.items.map((it) => (
                    <li key={it.name} className="tnum">
                      {fmt(it.amount)} {it.unit} {it.name}
                      {it.foodId != null && <span className="badge">Bibliothek</span>}
                    </li>
                  ))}
                </ul>
                <Markdown text={m.recipe} />
                <div className="tiny muted tnum">{macroText(m.total)}</div>
              </div>
            ))}
          {open && plan.notes && <Markdown text={plan.notes} />}
          <div className="grid-2">
            <button className="btn small" onClick={() => run(false)} disabled={busy}>
              Neu planen
            </button>
            {isToday && (
              <button className="btn small" onClick={() => run(true)} disabled={busy}>
                Rest des Tages planen
              </button>
            )}
          </div>
          <p className="tiny muted">Nährwerte berechnet die App selbst aus deiner Bibliothek; Mengen sind auf dein Ziel abgestimmt.</p>
        </div>
      )}
    </Card>
  );
}
