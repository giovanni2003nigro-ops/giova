import { InfoBang } from './InfoBang';
import type { LabelScan } from '../ai/labelScan';
import { macrosPlausible, kcalFromMacros } from '../lib/nutrition';
import { fmt } from '../lib/stats';
import type { Food } from '../types';
import { NumField, Seg } from './ui';

type Num = number | '';

export interface FoodDraft {
  name: string;
  brand: string;
  unit: 'g' | 'ml';
  kcal: Num;
  protein: Num;
  carbs: Num;
  fat: Num;
  sugar: Num;
  fiber: Num;
  salt: Num;
  satFat: Num;
  servingSize: Num;
  servingLabel: string;
}

export const EMPTY_DRAFT: FoodDraft = {
  name: '',
  brand: '',
  unit: 'g',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
  sugar: '',
  fiber: '',
  salt: '',
  satFat: '',
  servingSize: '',
  servingLabel: '',
};

const opt = (v: Num) => (v === '' ? undefined : v);
const orEmpty = (v: number | null | undefined): Num => (v == null ? '' : v);

export function foodToDraft(f: Food): FoodDraft {
  return {
    name: f.name,
    brand: f.brand ?? '',
    unit: f.unit,
    kcal: f.per100.kcal,
    protein: f.per100.protein,
    carbs: f.per100.carbs,
    fat: f.per100.fat,
    sugar: orEmpty(f.per100.sugar),
    fiber: orEmpty(f.per100.fiber),
    salt: orEmpty(f.per100.salt),
    satFat: orEmpty(f.per100.satFat),
    servingSize: orEmpty(f.servingSize),
    servingLabel: f.servingLabel ?? '',
  };
}

export function scanToDraft(s: LabelScan): FoodDraft {
  return {
    name: s.name,
    brand: s.marke ?? '',
    unit: s.bezug === '100ml' ? 'ml' : 'g',
    kcal: s.kcal,
    protein: s.protein,
    carbs: s.kohlenhydrate,
    fat: s.fett,
    sugar: orEmpty(s.zucker),
    fiber: orEmpty(s.ballaststoffe),
    salt: orEmpty(s.salz),
    satFat: orEmpty(s.gesaettigte_fettsaeuren),
    servingSize: orEmpty(s.portion_groesse),
    servingLabel: s.portion_bezeichnung ?? '',
  };
}

/** Prüft den Entwurf und baut daraus ein Lebensmittel (ohne id/Foto). */
export function draftToFood(d: FoodDraft, source: Food['source']): Food | string {
  if (!d.name.trim()) return 'Bitte einen Namen eingeben.';
  if (d.kcal === '' || d.protein === '' || d.carbs === '' || d.fat === '')
    return 'Bitte kcal, Protein, Kohlenhydrate und Fett angeben.';
  return {
    name: d.name.trim(),
    brand: d.brand.trim() || undefined,
    unit: d.unit,
    per100: {
      kcal: d.kcal,
      protein: d.protein,
      carbs: d.carbs,
      fat: d.fat,
      sugar: opt(d.sugar),
      fiber: opt(d.fiber),
      salt: opt(d.salt),
      satFat: opt(d.satFat),
    },
    servingSize: opt(d.servingSize),
    servingLabel: d.servingLabel.trim() || undefined,
    source,
    createdAt: Date.now(),
  };
}

export function FoodForm({ draft, onChange }: { draft: FoodDraft; onChange: (d: FoodDraft) => void }) {
  const set = <K extends keyof FoodDraft>(k: K) => (v: FoodDraft[K]) => onChange({ ...draft, [k]: v });
  const complete = draft.kcal !== '' && draft.protein !== '' && draft.carbs !== '' && draft.fat !== '';
  const plausible =
    !complete ||
    macrosPlausible({ kcal: draft.kcal as number, protein: draft.protein as number, carbs: draft.carbs as number, fat: draft.fat as number });
  return (
    <div className="stack lg">
      <label className="field">
        <span>Name</span>
        <input className="input" value={draft.name} onChange={(e) => set('name')(e.target.value)} placeholder="z. B. Skyr Natur" />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>
            Marke <span className="muted">(optional)</span>
          </span>
          <input className="input" value={draft.brand} onChange={(e) => set('brand')(e.target.value)} />
        </label>
        <label className="field">
          <span>Angaben pro</span>
          <Seg
            value={draft.unit}
            onChange={set('unit')}
            label="Einheit"
            options={[
              { value: 'g', label: '100 g' },
              { value: 'ml', label: '100 ml' },
            ]}
          />
        </label>
      </div>
      <div className="grid-2">
        <NumField label="Kalorien" suffix="kcal" value={draft.kcal} onChange={set('kcal')} />
        <NumField label="Protein" suffix="g" value={draft.protein} onChange={set('protein')} />
        <NumField label="Kohlenhydrate" suffix="g" value={draft.carbs} onChange={set('carbs')} />
        <NumField label="Fett" suffix="g" value={draft.fat} onChange={set('fat')} />
        <NumField label="davon Zucker" suffix="g" value={draft.sugar} onChange={set('sugar')} />
        <NumField label="gesättigte Fettsäuren" suffix="g" value={draft.satFat} onChange={set('satFat')} />
        <NumField label="Ballaststoffe" suffix="g" value={draft.fiber} onChange={set('fiber')} />
        <NumField label="Salz" suffix="g" value={draft.salt} onChange={set('salt')} />
      </div>
      {!plausible && (
        <div className="row between">
          <span className="small muted">Makros und Kalorien passen nicht zusammen</span>
          <InfoBang title="Werte prüfen" tone="warn">
            <p>
              Die Makros ergeben ca. {fmt(kcalFromMacros({ protein: draft.protein as number, carbs: draft.carbs as number, fat: draft.fat as number }))} kcal –
              bitte die Werte prüfen.
            </p>
          </InfoBang>
        </div>
      )}
      <div className="grid-2">
        <NumField label="Portionsgröße" suffix={draft.unit} value={draft.servingSize} onChange={set('servingSize')} placeholder="optional" />
        <label className="field">
          <span>Portion heißt</span>
          <input className="input" value={draft.servingLabel} onChange={(e) => set('servingLabel')(e.target.value)} placeholder="z. B. 1 Becher" />
        </label>
      </div>
    </div>
  );
}
