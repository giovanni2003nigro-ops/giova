import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db';
import { useObjectUrl } from '../hooks';
import { scaleMacros } from '../lib/nutrition';
import { fmt } from '../lib/stats';
import type { Food, Macros, MealType } from '../types';
import { MEAL_LABELS, MEAL_TYPES } from '../types';
import { LabelScanner } from './LabelScanner';
import { NumField, Seg, Sheet, toast } from './ui';

type Tab = 'bibliothek' | 'manuell' | 'foto';

export function macroText(m: Macros) {
  return `${fmt(m.kcal)} kcal · P ${fmt(m.protein, 1)} · KH ${fmt(m.carbs, 1)} · F ${fmt(m.fat, 1)}`;
}

export function FoodThumb({ food }: { food: Food }) {
  const url = useObjectUrl(food.photo);
  return url ? <img src={url} alt="" className="thumb" /> : <div className="thumb" aria-hidden />;
}

export function AddFoodSheet({
  date,
  meal: initialMeal,
  initialTab = 'bibliothek',
  initialFood,
  onClose,
}: {
  date: string;
  meal: MealType;
  initialTab?: Tab;
  initialFood?: Food;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [meal, setMeal] = useState<MealType>(initialMeal);
  const [chosen, setChosen] = useState<Food | undefined>(initialFood);

  return (
    <Sheet title="Essen hinzufügen" onClose={onClose}>
      <label className="field">
        <span>Mahlzeit</span>
        <select className="input" value={meal} onChange={(e) => setMeal(e.target.value as MealType)}>
          {MEAL_TYPES.map((m) => (
            <option key={m} value={m}>
              {MEAL_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {chosen ? (
        <AmountPicker food={chosen} date={date} meal={meal} onBack={() => setChosen(undefined)} onDone={onClose} />
      ) : (
        <>
          <Seg
            value={tab}
            onChange={setTab}
            label="Quelle"
            options={[
              { value: 'bibliothek', label: 'Bibliothek' },
              { value: 'manuell', label: 'Manuell' },
              { value: 'foto', label: 'Foto scannen' },
            ]}
          />
          {tab === 'bibliothek' && <LibraryPicker onPick={setChosen} onScan={() => setTab('foto')} />}
          {tab === 'manuell' && <ManualEntry date={date} meal={meal} onDone={onClose} />}
          {tab === 'foto' && <LabelScanner onSaved={setChosen} />}
        </>
      )}
    </Sheet>
  );
}

function LibraryPicker({ onPick, onScan }: { onPick: (f: Food) => void; onScan: () => void }) {
  const foods = useLiveQuery(() => db.foods.orderBy('createdAt').reverse().toArray(), []);
  const recentMeals = useLiveQuery(() => db.meals.orderBy('id').reverse().limit(200).toArray(), []);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    if (!foods) return [];
    // Häufig gegessene Lebensmittel zuerst
    const freq = new Map<number, number>();
    for (const m of recentMeals ?? []) if (m.foodId) freq.set(m.foodId, (freq.get(m.foodId) ?? 0) + 1);
    const needle = q.trim().toLowerCase();
    return foods
      .filter((f) => !needle || `${f.brand ?? ''} ${f.name}`.toLowerCase().includes(needle))
      .sort((a, b) => (freq.get(b.id!) ?? 0) - (freq.get(a.id!) ?? 0));
  }, [foods, recentMeals, q]);

  if (foods && foods.length === 0)
    return (
      <div className="empty stack">
        <span>Deine Bibliothek ist noch leer.</span>
        <button className="btn primary" onClick={onScan}>
          Erstes Produkt fotografieren
        </button>
      </div>
    );

  return (
    <div className="stack">
      <input className="input" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Lebensmittel suchen" />
      <div className="list">
        {list.map((f) => (
          <button
            key={f.id}
            className="list-item"
            style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onPick(f)}
          >
            <FoodThumb food={f} />
            <div className="main">
              <div className="title">{f.name}</div>
              <div className="meta tnum">
                {f.brand ? `${f.brand} · ` : ''}pro 100 {f.unit}: {macroText(f.per100)}
              </div>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="empty">Nichts gefunden.</div>}
      </div>
    </div>
  );
}

function AmountPicker({ food, date, meal, onBack, onDone }: { food: Food; date: string; meal: MealType; onBack: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<number | ''>(food.servingSize ?? 100);
  const macros = amount === '' ? null : scaleMacros(food.per100, amount);
  const presets = [
    ...(food.servingSize ? [{ label: food.servingLabel || '1 Portion', value: food.servingSize }] : []),
    ...[50, 100, 150, 200, 250].map((v) => ({ label: `${v} ${food.unit}`, value: v })),
  ];
  const add = async () => {
    if (!macros || amount === '' || amount <= 0) return toast('Bitte eine Menge angeben.');
    await db.meals.add({ date, meal, name: food.name, amount, unit: food.unit, foodId: food.id, ...macros, createdAt: Date.now() });
    toast(`${food.name} eingetragen (${fmt(macros.kcal)} kcal)`);
    onDone();
  };
  return (
    <div className="stack lg">
      <div className="row">
        <FoodThumb food={food} />
        <div className="grow">
          <h3>{food.name}</h3>
          <div className="small muted tnum">
            pro 100 {food.unit}: {macroText(food.per100)}
          </div>
        </div>
      </div>
      <NumField label="Menge" suffix={food.unit} value={amount} onChange={setAmount} />
      <div className="chips">
        {presets.map((p) => (
          <button key={p.label} className="chip" type="button" onClick={() => setAmount(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      {macros && (
        <div className="grid-2">
          <div className="stat stat-tile">
            <span className="label">Kalorien</span>
            <span className="value">
              {fmt(macros.kcal)} <small>kcal</small>
            </span>
          </div>
          <div className="stat stat-tile">
            <span className="label">Protein · KH · Fett</span>
            <span className="value" style={{ fontSize: '1rem' }}>
              {fmt(macros.protein, 1)} · {fmt(macros.carbs, 1)} · {fmt(macros.fat, 1)} g
            </span>
          </div>
        </div>
      )}
      <div className="grid-2">
        <button className="btn" onClick={onBack}>
          Zurück
        </button>
        <button className="btn primary" onClick={add}>
          Eintragen
        </button>
      </div>
    </div>
  );
}

function ManualEntry({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [kcal, setKcal] = useState<number | ''>('');
  const [protein, setProtein] = useState<number | ''>('');
  const [carbs, setCarbs] = useState<number | ''>('');
  const [fat, setFat] = useState<number | ''>('');
  const [per100, setPer100] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState(false);

  const add = async () => {
    if (!name.trim() || kcal === '') return toast('Bitte Name und Kalorien angeben.');
    const values: Macros = { kcal, protein: protein || 0, carbs: carbs || 0, fat: fat || 0 };
    const amt = amount === '' ? (per100 ? 100 : 1) : amount;
    const total = per100 ? scaleMacros(values, amt) : values;
    let foodId: number | undefined;
    if (per100 && saveToLibrary)
      foodId = await db.foods.add({ name: name.trim(), unit: 'g', per100: values, source: 'manuell', createdAt: Date.now() });
    await db.meals.add({
      date,
      meal,
      name: name.trim(),
      amount: amt,
      unit: amount === '' && !per100 ? 'Portion' : 'g',
      foodId,
      ...total,
      createdAt: Date.now(),
    });
    toast(`${name.trim()} eingetragen`);
    onDone();
  };

  return (
    <div className="stack lg">
      <label className="field">
        <span>Was hast du gegessen?</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Döner" />
      </label>
      <Seg
        value={per100 ? 'per100' : 'total'}
        onChange={(v) => setPer100(v === 'per100')}
        label="Werte beziehen sich auf"
        options={[
          { value: 'total', label: 'Werte gesamt' },
          { value: 'per100', label: 'Werte pro 100 g' },
        ]}
      />
      <NumField label="Menge" suffix="g" value={amount} onChange={setAmount} placeholder={per100 ? '100' : 'optional'} />
      <div className="grid-2">
        <NumField label="Kalorien" suffix="kcal" value={kcal} onChange={setKcal} />
        <NumField label="Protein" suffix="g" value={protein} onChange={setProtein} />
        <NumField label="Kohlenhydrate" suffix="g" value={carbs} onChange={setCarbs} />
        <NumField label="Fett" suffix="g" value={fat} onChange={setFat} />
      </div>
      {per100 && (
        <label className="row small">
          <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
          Auch in der Bibliothek speichern
        </label>
      )}
      <p className="tiny muted">Tipp: Der Coach-Chat kann Werte für dich schätzen und direkt eintragen.</p>
      <button className="btn primary block" onClick={add}>
        Eintragen
      </button>
    </div>
  );
}
