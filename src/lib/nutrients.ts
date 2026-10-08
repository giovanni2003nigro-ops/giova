import type { Food, GoalType, Goals, ISODate, Macros, MealEntry, NutritionPreferences, Profile } from '../types';
import { dateRange } from './dates';
import { fmt } from './stats';

/**
 * Nährstoffe: was du für dein Ziel brauchst (wie viel und warum) und
 * was dir laut Tagebuch in den letzten Tagen gefehlt hat.
 */

export type NutrientKey = 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'satFat' | 'salt' | 'water' | 'iron' | 'calcium' | 'vitd' | 'magnesium' | 'omega3' | 'b12' | 'creatine';

export interface NutrientTip {
  key: NutrientKey;
  label: string;
  /** Empfohlene Menge, z. B. „163 g pro Tag“ */
  amount: string;
  /** Warum gerade bei deinem Ziel */
  why: string;
  /** Gute Quellen – zuerst aus deiner Bibliothek */
  sources: string[];
  /** Wird über das Tagebuch erfasst (sonst nur Hinweis) */
  tracked: boolean;
  group: 'makros' | 'qualitaet' | 'mikro';
}

export interface GuideInput {
  goals: Goals;
  profile: Profile | null;
  weight: number | null;
  /** Geplante Trainingsstunden pro Woche */
  trainingHours: number;
  /** Ausdauersport im Plan (Laufen, Rad, Schwimmen …) */
  endurance: boolean;
  prefs: NutritionPreferences;
  foods: Food[];
}

const WHY_PROTEIN: Record<GoalType, string> = {
  defizit: 'Im Kaloriendefizit schützt viel Protein deine Muskeln – du verlierst Fett statt Muskulatur. Es sättigt außerdem am längsten.',
  erhalt: 'Erhält deine Muskulatur und hilft bei der Regeneration nach dem Training.',
  aufbau: 'Baustoff für neue Muskeln. Am besten auf 3–5 Mahlzeiten mit je 25–40 g verteilen.',
  kraft: 'Repariert die Muskulatur nach schweren Einheiten – ohne genug Protein stagniert die Kraft.',
  recomp: 'Für Muskelaufbau bei gleichzeitigem Fettverlust brauchst du besonders viel – das ist der wichtigste Hebel.',
};

const WHY_CARBS: Record<GoalType, string> = {
  defizit: 'Nicht streichen: Sie sind der Treibstoff fürs Training. Lieber an Ruhetagen weniger und vor harten Einheiten mehr.',
  erhalt: 'Energie fürs Training – an Trainingstagen mehr, an Ruhetagen weniger.',
  aufbau: 'Füllen die Glykogenspeicher, damit du hart trainieren kannst, und liefern die Extra-Energie für den Aufbau.',
  kraft: 'Volle Speicher = mehr Leistung bei schweren Sätzen. Vor dem Training eine kohlenhydratreiche Mahlzeit.',
  recomp: 'Rund ums Training einplanen – dort bringen sie am meisten, an Ruhetagen reichen weniger.',
};

/** Lebensmittel aus der Bibliothek mit der höchsten Dichte eines Nährstoffs pro 100 kcal. */
export function bestFoods(foods: Food[], pick: (f: Food) => number | undefined, n = 3): string[] {
  return foods
    .filter((f) => f.per100.kcal > 0 && (pick(f) ?? 0) > 0)
    .sort((a, b) => (pick(b)! / b.per100.kcal) - (pick(a)! / a.per100.kcal))
    .slice(0, n)
    .map((f) => f.name);
}

const withDefaults = (own: string[], defaults: string[], n = 4) => [...own, ...defaults.filter((d) => !own.some((o) => o.toLowerCase().includes(d.split(' ')[0].toLowerCase())))].slice(0, n);

/** Was du für dein Ziel brauchst – mit Menge, Grund und Quellen. */
export function nutrientGuide(i: GuideInput): NutrientTip[] {
  const g = i.goals;
  const kg = i.weight ?? 75;
  const w = i.profile?.sex === 'w';
  const veg = i.prefs.diet === 'vegan' || i.prefs.diet === 'vegetarisch';
  const vegan = i.prefs.diet === 'vegan';
  const tips: NutrientTip[] = [];

  tips.push({
    key: 'protein',
    label: 'Protein',
    amount: `${fmt(g.protein)} g pro Tag (${fmt(g.protein / kg, 1)} g/kg)`,
    why: WHY_PROTEIN[g.type],
    sources: withDefaults(bestFoods(i.foods, (f) => f.per100.protein), vegan ? ['Tofu', 'Linsen', 'Sojajoghurt', 'Seitan'] : veg ? ['Magerquark', 'Skyr', 'Eier', 'Linsen'] : ['Magerquark', 'Hähnchenbrust', 'Skyr', 'Eier']),
    tracked: true,
    group: 'makros',
  });
  tips.push({
    key: 'carbs',
    label: 'Kohlenhydrate',
    amount: `Ø ${fmt(g.carbs)} g pro Tag (${fmt(g.carbs / kg, 1)} g/kg) – an Trainingstagen mehr`,
    why: WHY_CARBS[g.type] + (i.endurance ? ' Bei Ausdauereinheiten über 60 min zusätzlich 30–60 g pro Stunde während der Einheit.' : ''),
    sources: withDefaults(bestFoods(i.foods, (f) => f.per100.carbs), ['Haferflocken', 'Reis', 'Kartoffeln', 'Bananen']),
    tracked: true,
    group: 'makros',
  });
  tips.push({
    key: 'fat',
    label: 'Fett',
    amount: `${fmt(g.fat)} g pro Tag, mindestens ${fmt(kg * 0.6)} g`,
    why: 'Wichtig für Hormone (auch für Muskelaufbau und Zyklus) und um die Vitamine A, D, E und K aufzunehmen. Zu wenig Fett im Defizit bremst die Regeneration.',
    sources: ['Olivenöl', 'Nüsse', 'Avocado', vegan ? 'Leinöl' : 'Lachs'],
    tracked: true,
    group: 'makros',
  });
  tips.push({
    key: 'fiber',
    label: 'Ballaststoffe',
    amount: 'mindestens 30 g pro Tag',
    why: g.type === 'defizit' || g.type === 'recomp' ? 'Machen satt bei wenig Kalorien – der beste Freund im Defizit. Dazu gut für Verdauung und Blutzucker.' : 'Gut für Verdauung, Darm und einen stabilen Blutzucker. Direkt vor dem Training eher wenig davon.',
    sources: withDefaults(bestFoods(i.foods, (f) => f.per100.fiber), ['Haferflocken', 'Linsen', 'Vollkornbrot', 'Beeren']),
    tracked: true,
    group: 'qualitaet',
  });
  tips.push({
    key: 'sugar',
    label: 'Zucker',
    amount: `höchstens ${fmt((g.kcal * 0.1) / 4)} g pro Tag (10 % der Kalorien)`,
    why: g.type === 'defizit' ? 'Liefert Kalorien, aber kaum Sättigung – im Defizit besonders sparsam einsetzen.' : 'Rund ums Training okay (schnelle Energie), sonst sparsam.',
    sources: ['Obst statt Süßigkeiten', 'Wasser statt Softdrinks'],
    tracked: true,
    group: 'qualitaet',
  });
  tips.push({
    key: 'salt',
    label: 'Salz',
    amount: 'höchstens 6 g pro Tag',
    why: i.trainingHours >= 5 ? 'Bei viel Schwitzen verlierst du Natrium – nach langen Einheiten darf es etwas mehr sein, sonst sparsam.' : 'Zu viel belastet den Blutdruck. Fertiggerichte und Brot enthalten das meiste.',
    sources: ['selbst kochen', 'Kräuter statt Salz'],
    tracked: true,
    group: 'qualitaet',
  });
  tips.push({
    key: 'water',
    label: 'Flüssigkeit',
    amount: `ca. ${fmt((kg * 35) / 1000 + (i.trainingHours / 7) * 0.7, 1)} l pro Tag`,
    why: 'Schon 2 % Flüssigkeitsverlust senken die Leistung. Pro Trainingsstunde etwa 0,5–1 l zusätzlich.',
    sources: ['Wasser', 'ungesüßter Tee', 'Schorle nach langen Einheiten'],
    tracked: false,
    group: 'qualitaet',
  });

  if (i.endurance || w)
    tips.push({
      key: 'iron',
      label: 'Eisen',
      amount: `${w ? '15' : '11'} mg pro Tag`,
      why: `Transportiert Sauerstoff zu den Muskeln.${i.endurance ? ' Ausdauersport erhöht den Bedarf (Schweiß, Laufen).' : ''}${w ? ' Frauen brauchen mehr.' : ''} Pflanzliches Eisen mit Vitamin C kombinieren.`,
      sources: veg ? ['Linsen + Paprika', 'Haferflocken', 'Kürbiskerne', 'Tofu'] : ['Rindfleisch', 'Linsen + Paprika', 'Haferflocken', 'Kürbiskerne'],
      tracked: false,
      group: 'mikro',
    });
  tips.push({
    key: 'calcium',
    label: 'Calcium',
    amount: '1.000 mg pro Tag',
    why: 'Für stabile Knochen – wichtig bei Laufen und Krafttraining und wenn du wenig Milchprodukte isst.',
    sources: vegan ? ['calciumreiches Mineralwasser', 'Grünkohl', 'Tofu (mit Calcium)'] : ['Skyr', 'Käse', 'calciumreiches Mineralwasser'],
    tracked: false,
    group: 'mikro',
  });
  tips.push({
    key: 'vitd',
    label: 'Vitamin D',
    amount: '20 µg pro Tag ohne Sonne',
    why: 'Von Oktober bis März bildet die Haut in Deutschland kaum Vitamin D – wichtig für Knochen, Muskeln und Abwehr. Den Spiegel kann der Arzt messen.',
    sources: ['Sonne (Frühling–Herbst)', 'fetter Fisch', 'Eier'],
    tracked: false,
    group: 'mikro',
  });
  tips.push({
    key: 'magnesium',
    label: 'Magnesium',
    amount: `${w ? '300' : '350'} mg pro Tag`,
    why: 'Für Muskeln und Nerven – geht beim Schwitzen verloren.',
    sources: ['Nüsse', 'Haferflocken', 'Vollkorn', 'Hülsenfrüchte'],
    tracked: false,
    group: 'mikro',
  });
  tips.push({
    key: 'omega3',
    label: 'Omega-3-Fette',
    amount: vegan ? 'täglich 1 EL Leinöl oder Walnüsse' : '1–2× Fisch pro Woche',
    why: 'Wirken entzündungshemmend und unterstützen die Regeneration.',
    sources: vegan ? ['Leinöl', 'Walnüsse', 'Algenöl'] : ['Lachs', 'Hering', 'Walnüsse', 'Leinöl'],
    tracked: false,
    group: 'mikro',
  });
  if (vegan)
    tips.push({
      key: 'b12',
      label: 'Vitamin B12',
      amount: 'als Ergänzung (z. B. Tablette)',
      why: 'Kommt fast nur in tierischen Lebensmitteln vor – bei veganer Ernährung immer ergänzen.',
      sources: ['B12-Präparat', 'angereicherte Pflanzendrinks'],
      tracked: false,
      group: 'mikro',
    });
  if (g.type === 'kraft' || g.type === 'aufbau' || g.type === 'recomp')
    tips.push({
      key: 'creatine',
      label: 'Kreatin (optional)',
      amount: '3–5 g pro Tag',
      why: 'Eines der am besten untersuchten Mittel für mehr Kraft bei kurzen, schweren Sätzen. Kein Muss – Ernährung und Training zählen zuerst.',
      sources: ['Kreatin-Monohydrat', 'in kleinen Mengen in Fleisch und Fisch'],
      tracked: false,
      group: 'mikro',
    });
  return tips;
}

// ------------------------------------------------------------------ Was hat zuletzt gefehlt?

export interface Extras {
  fiber: number;
  sugar: number;
  salt: number;
  satFat: number;
}

/** Ballaststoffe & Co. eines Eintrags – aus dem Lebensmittel der Bibliothek berechnet (falls bekannt). */
export function extrasOf(entry: MealEntry, foods: Map<number, Food>): Partial<Extras> | null {
  if (entry.foodId == null || entry.unit === 'Portion') return null;
  const f = foods.get(entry.foodId);
  if (!f) return null;
  const k = entry.amount / 100;
  const out: Partial<Extras> = {};
  if (f.per100.fiber != null) out.fiber = f.per100.fiber * k;
  if (f.per100.sugar != null) out.sugar = f.per100.sugar * k;
  if (f.per100.salt != null) out.salt = f.per100.salt * k;
  if (f.per100.satFat != null) out.satFat = f.per100.satFat * k;
  return out;
}

export type GapStatus = 'zu-wenig' | 'zu-viel' | 'ok' | 'unklar';

export interface Gap {
  key: NutrientKey | 'kcal';
  label: string;
  status: GapStatus;
  /** Kurzbefund, z. B. „Ø 112 g von 163 g – an 5 von 6 Tagen zu wenig“ */
  detail: string;
  /** Was du konkret tun kannst */
  fix: string;
}

export interface CheckInput {
  meals: MealEntry[];
  foods: Food[];
  goals: Goals;
  weight: number | null;
  /** Tagesziel je Datum (nach Training & Alltag) */
  targetFor: (date: ISODate) => Macros;
  /** War an dem Tag Training (geplant oder gemacht)? */
  trainingOn: (date: ISODate) => boolean;
  from: ISODate;
  to: ISODate;
}

export interface CheckResult {
  days: number;
  gaps: Gap[];
  /** Anteil der Kalorien, für den Ballaststoffe & Co. bekannt sind */
  extrasCoverage: number;
}

/** Vergleicht die erfassten Tage mit den Tageszielen und findet, was gefehlt hat (oder zu viel war). */
export function nutrientCheck(i: CheckInput): CheckResult {
  const foods = new Map(i.foods.filter((f) => f.id != null).map((f) => [f.id!, f]));
  const byDay = new Map<ISODate, MealEntry[]>();
  for (const m of i.meals) if (m.date >= i.from && m.date <= i.to) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);
  const days = dateRange(i.from, i.to).filter((d) => byDay.has(d));
  const gaps: Gap[] = [];
  if (!days.length) return { days: 0, gaps, extrasCoverage: 0 };

  const kg = i.weight ?? 75;
  const totals = days.map((d) => {
    const list = byDay.get(d)!;
    const sum = list.reduce((s, m) => ({ kcal: s.kcal + m.kcal, protein: s.protein + m.protein, carbs: s.carbs + m.carbs, fat: s.fat + m.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    let known = 0;
    const ex: Extras = { fiber: 0, sugar: 0, salt: 0, satFat: 0 };
    for (const m of list) {
      const e = extrasOf(m, foods);
      if (!e) continue;
      known += m.kcal;
      ex.fiber += e.fiber ?? 0;
      ex.sugar += e.sugar ?? 0;
      ex.salt += e.salt ?? 0;
      ex.satFat += e.satFat ?? 0;
    }
    return { date: d, sum, target: i.targetFor(d), training: i.trainingOn(d), known, ex };
  });
  const avg = (f: (t: (typeof totals)[number]) => number) => totals.reduce((s, t) => s + f(t), 0) / totals.length;
  const n = totals.length;
  const daysTxt = (k: number) => `an ${k} von ${n} Tag${n > 1 ? 'en' : ''}`;

  // Kalorien: grob unvollständig erfasste Tage verzerren alles – dann zuerst darauf hinweisen
  const kcalRatio = avg((t) => t.sum.kcal) / Math.max(1, avg((t) => t.target.kcal));
  if (kcalRatio < 0.6)
    gaps.push({
      key: 'kcal',
      label: 'Kalorien',
      status: 'zu-wenig',
      detail: `Ø ${fmt(avg((t) => t.sum.kcal))} von ${fmt(avg((t) => t.target.kcal))} kcal`,
      fix: 'Entweder isst du deutlich zu wenig (das bremst Training und Regeneration) oder es fehlen Einträge. Trag möglichst alles ein – sonst sind die Werte unten zu niedrig.',
    });
  else if (kcalRatio > 1.15)
    gaps.push({
      key: 'kcal',
      label: 'Kalorien',
      status: 'zu-viel',
      detail: `Ø ${fmt(avg((t) => t.sum.kcal))} von ${fmt(avg((t) => t.target.kcal))} kcal`,
      fix: 'Etwas über dem Ziel. Die einfachsten Stellschrauben: Getränke, Snacks zwischendurch, Öl beim Kochen.',
    });

  // Protein
  const pLow = totals.filter((t) => t.sum.protein < t.target.protein * 0.9).length;
  const pAvg = avg((t) => t.sum.protein);
  const pTarget = avg((t) => t.target.protein);
  gaps.push(
    pLow > n / 2
      ? {
          key: 'protein',
          label: 'Protein',
          status: 'zu-wenig',
          detail: `Ø ${fmt(pAvg)} von ${fmt(pTarget)} g – ${daysTxt(pLow)} zu wenig`,
          fix: `Dir fehlen im Schnitt ${fmt(pTarget - pAvg)} g pro Tag. Machbar mit ${proteinIdeas(i.foods, pTarget - pAvg)}.`,
        }
      : { key: 'protein', label: 'Protein', status: 'ok', detail: `Ø ${fmt(pAvg)} von ${fmt(pTarget)} g`, fix: 'Passt – weiter so.' },
  );

  // Kohlenhydrate an Trainingstagen
  const tDays = totals.filter((t) => t.training);
  if (tDays.length) {
    const cAvg = tDays.reduce((s, t) => s + t.sum.carbs, 0) / tDays.length;
    const cTarget = tDays.reduce((s, t) => s + t.target.carbs, 0) / tDays.length;
    gaps.push(
      cAvg < cTarget * 0.8
        ? {
            key: 'carbs',
            label: 'Kohlenhydrate an Trainingstagen',
            status: 'zu-wenig',
            detail: `Ø ${fmt(cAvg)} von ${fmt(cTarget)} g an ${tDays.length} Trainingstag${tDays.length > 1 ? 'en' : ''}`,
            fix: 'Vor dem Training fehlt Energie. 2–3 h vorher eine Portion Reis, Nudeln, Haferflocken oder Brot, kurz vorher eine Banane.',
          }
        : { key: 'carbs', label: 'Kohlenhydrate an Trainingstagen', status: 'ok', detail: `Ø ${fmt(cAvg)} von ${fmt(cTarget)} g`, fix: 'Gut versorgt fürs Training.' },
    );
  }

  // Fett: Untergrenze
  const fMin = kg * 0.6;
  const fAvg = avg((t) => t.sum.fat);
  if (fAvg < fMin)
    gaps.push({
      key: 'fat',
      label: 'Fett',
      status: 'zu-wenig',
      detail: `Ø ${fmt(fAvg)} g – mindestens ${fmt(fMin)} g wären gut`,
      fix: 'Eine Handvoll Nüsse, etwas Olivenöl am Salat oder Lachs bringen dich in den grünen Bereich.',
    });

  // Ballaststoffe, Zucker, Salz – nur, wenn genug davon bekannt ist (Lebensmittel aus der Bibliothek)
  const knownShare = totals.reduce((s, t) => s + t.known, 0) / Math.max(1, totals.reduce((s, t) => s + t.sum.kcal, 0));
  if (knownShare >= 0.5) {
    const scale = 1 / knownShare;
    const fiber = avg((t) => t.ex.fiber) * scale;
    const sugar = avg((t) => t.ex.sugar) * scale;
    const salt = avg((t) => t.ex.salt) * scale;
    const sugarMax = (i.goals.kcal * 0.1) / 4;
    gaps.push(
      fiber < 25
        ? {
            key: 'fiber',
            label: 'Ballaststoffe',
            status: 'zu-wenig',
            detail: `ca. ${fmt(fiber)} g pro Tag – Ziel mindestens 30 g`,
            fix: `Mehr Vollkorn, Hülsenfrüchte, Gemüse und Beeren${fiberIdeas(i.foods)}.`,
          }
        : { key: 'fiber', label: 'Ballaststoffe', status: 'ok', detail: `ca. ${fmt(fiber)} g pro Tag`, fix: 'Gut so.' },
    );
    if (sugar > sugarMax)
      gaps.push({ key: 'sugar', label: 'Zucker', status: 'zu-viel', detail: `ca. ${fmt(sugar)} g pro Tag – höchstens ${fmt(sugarMax)} g`, fix: 'Süße Getränke und Snacks sind meist die Hauptquelle. Obst und Joghurt natur sind gute Alternativen.' });
    if (salt > 6)
      gaps.push({ key: 'salt', label: 'Salz', status: 'zu-viel', detail: `ca. ${fmt(salt, 1)} g pro Tag – höchstens 6 g`, fix: 'Fertiggerichte, Wurst, Käse und Brot sparsamer, mehr selbst kochen.' });
  } else {
    gaps.push({
      key: 'fiber',
      label: 'Ballaststoffe, Zucker & Salz',
      status: 'unklar',
      detail: 'Noch zu wenig Daten',
      fix: 'Diese Werte kenne ich nur bei Lebensmitteln aus deiner Bibliothek (Nährwerttabelle fotografieren). Je mehr du darüber einträgst, desto genauer wird der Check.',
    });
  }

  return { days: n, gaps, extrasCoverage: knownShare };
}

function proteinIdeas(foods: Food[], missing: number): string {
  // Große Lücken auf mehrere Mahlzeiten verteilen – niemand isst 400 g Hähnchen auf einmal
  const meals = missing > 60 ? 3 : missing > 30 ? 2 : 1;
  const per = missing / meals;
  const own = foods
    .filter((f) => f.per100.kcal > 0 && (f.per100.protein * 4) / f.per100.kcal >= 0.35)
    .sort((a, b) => b.per100.protein / b.per100.kcal - a.per100.protein / a.per100.kcal)[0];
  const portion = own
    ? (() => {
        const grams = Math.min(300, Math.max(50, Math.round(((per / own.per100.protein) * 100) / 25) * 25));
        return `${grams} ${own.unit} ${own.name} (+${fmt((own.per100.protein * grams) / 100)} g)`;
      })()
    : per > 25
      ? '150 g Hähnchenbrust (+35 g) oder 250 g Magerquark (+30 g)'
      : '200 g Skyr (+22 g)';
  return meals > 1 ? `${meals} Mahlzeiten mit je etwa ${fmt(per)} g mehr – z. B. ${portion} pro Mahlzeit` : portion;
}

function fiberIdeas(foods: Food[]): string {
  const own = bestFoods(foods, (f) => f.per100.fiber, 2);
  return own.length ? ` – aus deiner Bibliothek z. B. ${own.join(' oder ')}` : '';
}
