import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { AddFoodSheet, macroText } from '../components/AddFoodSheet';
import { BarChart } from '../components/charts';
import { DayPlanCard } from '../components/DayPlanCard';
import { FoodLibrarySheet } from '../components/FoodLibrarySheet';
import { IconBook, IconCamera, IconPlus, IconTrash } from '../components/icons';
import { Card, DateNav, Meter, Sheet } from '../components/ui';
import { LabelScanner } from '../components/LabelScanner';
import { db, useKV } from '../db';
import { useToday } from '../hooks';
import { addDays, dateRange } from '../lib/dates';
import { dailyTotals, sumMacros } from '../lib/nutrition';
import { fmt } from '../lib/stats';
import { useDayNeeds } from '../needs';
import type { Food, Goals, MealType } from '../types';
import { DEFAULT_GOALS, MEAL_LABELS, MEAL_TYPES } from '../types';

type SheetState =
  | { kind: 'add'; meal: MealType; tab?: 'bibliothek' | 'manuell' | 'foto'; food?: Food }
  | { kind: 'library' }
  | { kind: 'scan' }
  | null;

function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 11) return 'fruehstueck';
  if (h < 15) return 'mittag';
  if (h < 17) return 'snack';
  return 'abend';
}

export function NutritionView() {
  const t = useToday();
  const [date, setDate] = useState(t);
  const [sheet, setSheet] = useState<SheetState>(null);
  const goals = useKV<Goals>('goals', DEFAULT_GOALS) ?? DEFAULT_GOALS;
  const entries = useLiveQuery(() => db.meals.where('date').equals(date).toArray(), [date]) ?? [];
  const recent = useLiveQuery(() => db.meals.where('date').between(addDays(t, -13), t, true, true).toArray(), [t]) ?? [];
  const total = sumMacros(entries);
  const needs = useDayNeeds(date);
  // Tagesziel nach Training & Alltag, sonst das allgemeine Ziel
  const target = needs?.targets ?? goals;

  const history = useMemo(() => {
    const totals = dailyTotals(recent);
    return dateRange(addDays(t, -13), t).map((d) => ({ date: d, totals: totals.get(d) ?? null }));
  }, [recent, t]);

  return (
    <div className="content">
      <DateNav date={date} onChange={setDate} />

      <Card title="Tagesbilanz">
        <Meter label="Kalorien" value={total.kcal} target={target.kcal} unit=" kcal" />
        <div className="grid-3">
          <Meter compact label="Protein" value={total.protein} target={target.protein} unit=" g" />
          <Meter compact label="Kohlenh." value={total.carbs} target={target.carbs} unit=" g" />
          <Meter compact label="Fett" value={total.fat} target={target.fat} unit=" g" />
        </div>
      </Card>

      {needs && <DayPlanCard date={date} needs={needs} />}

      <div className="grid-2">
        <button className="btn primary" onClick={() => setSheet({ kind: 'scan' })}>
          <IconCamera /> Scannen
        </button>
        <button className="btn" onClick={() => setSheet({ kind: 'library' })}>
          <IconBook /> Bibliothek
        </button>
      </div>

      {MEAL_TYPES.map((meal) => {
        const list = entries.filter((e) => e.meal === meal).sort((a, b) => a.createdAt - b.createdAt);
        const sum = sumMacros(list);
        return (
          <Card
            key={meal}
            className="tight"
            title={
              <div>
                <h2>{MEAL_LABELS[meal]}</h2>
                {list.length > 0 && <div className="tiny muted tnum">{macroText(sum)}</div>}
              </div>
            }
            action={
              <button className="btn small" onClick={() => setSheet({ kind: 'add', meal })} aria-label={`${MEAL_LABELS[meal]} hinzufügen`}>
                <IconPlus /> Hinzufügen
              </button>
            }
          >
            {list.length > 0 && (
              <div className="list">
                {list.map((e) => (
                  <div className="list-item" key={e.id}>
                    <div className="main">
                      <div className="title">{e.name}</div>
                      <div className="meta tnum">
                        {fmt(e.amount)} {e.unit} · {macroText(e)}
                      </div>
                    </div>
                    <button className="icon-btn sm" onClick={() => e.id && db.meals.delete(e.id)} aria-label={`${e.name} löschen`}>
                      <IconTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Card title="Kalorien – letzte 14 Tage">
        <BarChart
          ariaLabel="Kalorien pro Tag"
          bars={history.map((h) => ({ x: h.date, y: h.totals?.kcal ?? null }))}
          target={{ value: goals.kcal, label: `Ziel ${fmt(goals.kcal)}` }}
          unit=" kcal"
          valueLabel="Kalorien"
        />
      </Card>
      <Card title="Protein – letzte 14 Tage">
        <BarChart
          ariaLabel="Protein pro Tag"
          bars={history.map((h) => ({ x: h.date, y: h.totals?.protein ?? null }))}
          target={{ value: goals.protein, label: `Ziel ${fmt(goals.protein)} g` }}
          unit=" g"
          valueLabel="Protein"
        />
      </Card>

      {sheet?.kind === 'add' && (
        <AddFoodSheet date={date} meal={sheet.meal} initialTab={sheet.tab} initialFood={sheet.food} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'library' && (
        <FoodLibrarySheet
          onClose={() => setSheet(null)}
          onAdd={(food) => setSheet({ kind: 'add', meal: defaultMeal(), food })}
          onScan={() => setSheet({ kind: 'scan' })}
        />
      )}
      {sheet?.kind === 'scan' && (
        <Sheet title="Nährwerte fotografieren" onClose={() => setSheet(null)}>
          <LabelScanner onSaved={(food) => setSheet({ kind: 'add', meal: defaultMeal(), food })} />
        </Sheet>
      )}
    </div>
  );
}
