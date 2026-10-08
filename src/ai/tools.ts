import type { BetaTool, BetaToolResultBlockParam, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { db } from '../db';
import { dayNeeds } from '../lib/dailyNeeds';
import { ACTION_LABELS, ACTION_TOOLS, executeAction, isAction } from './actions';
import { today as getToday } from '../lib/dates';
import { combine, sumMacros } from '../lib/nutrition';
import { fmt } from '../lib/stats';
import type { Food, Macros, MealEntry } from '../types';
import { MEAL_LABELS, MEAL_TYPES } from '../types';
import {
  buildSnapshot,
  describeActivities,
  describeAnalysis,
  describeRules,
  describePlanAndDay,
  describeGoals,
  describeNutrition,
  describeNutrients,
  describeSleep,
  describeToday,
  describeTraining,
  describeWeight,
  loadAppData,
  needsInputOf,
  runAnalysis,
} from './context';

const macrosSchema = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number', description: 'Gramm' },
    kohlenhydrate: { type: 'number', description: 'Gramm' },
    fett: { type: 'number', description: 'Gramm' },
  },
  required: ['kcal', 'protein', 'kohlenhydrate', 'fett'],
  additionalProperties: false,
} as const;

const Macros100 = z.object({
  kcal: z.number().min(0),
  protein: z.number().min(0),
  kohlenhydrate: z.number().min(0),
  fett: z.number().min(0),
});

const BEREICHE = ['heute', 'ernaehrung_14_tage', 'naehrstoffe', 'training', 'aktivitaeten', 'plan_und_bedarf', 'schlaf', 'gewicht', 'ziele', 'rahmenbedingungen', 'auswertung', 'alles'] as const;

export const CHAT_TOOLS: BetaTool[] = [
  {
    name: 'lebensmittel_suchen',
    description:
      'Durchsucht die Lebensmittel-Bibliothek des Nutzers (eigene, oft per Foto gespeicherte Produkte mit Nährwerten pro 100 g/ml). Nutze das, bevor du mit Durchschnittswerten rechnest, wenn der Nutzer ein Produkt nennt.',
    input_schema: {
      type: 'object',
      properties: { suchbegriff: { type: 'string', description: 'Name oder Teil des Namens, z. B. "Skyr"' } },
      required: ['suchbegriff'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'naehrwerte_berechnen',
    description:
      'Berechnet exakt die Nährwerte einer Kombination mehrerer Lebensmittel in bestimmten Mengen und vergleicht sie mit dem heute noch offenen Tagesziel. Lebensmittel aus der Bibliothek werden automatisch über den Namen gefunden; für andere gib pro_100 mit realistischen Durchschnittswerten an. Nutze dieses Werkzeug immer statt Kopfrechnen, wenn Werte kombiniert werden.',
    input_schema: {
      type: 'object',
      properties: {
        positionen: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              menge: { type: 'number', description: 'Menge in g bzw. ml' },
              einheit: { type: 'string', enum: ['g', 'ml'] },
              pro_100: { ...macrosSchema, description: 'Nährwerte pro 100 g/ml – weglassen, wenn aus der Bibliothek' },
            },
            required: ['name', 'menge'],
            additionalProperties: false,
          },
        },
      },
      required: ['positionen'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'mahlzeit_eintragen',
    description:
      'Trägt Lebensmittel ins Ernährungstagebuch ein. Nur verwenden, wenn der Nutzer ausdrücklich darum bittet, etwas einzutragen/zu loggen. Werte sind die Gesamtwerte der jeweiligen Menge (nicht pro 100 g) – berechne sie vorher mit naehrwerte_berechnen.',
    input_schema: {
      type: 'object',
      properties: {
        datum: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' },
        mahlzeit: { type: 'string', enum: MEAL_TYPES },
        positionen: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              menge: { type: 'number' },
              einheit: { type: 'string', enum: ['g', 'ml', 'Portion'] },
              ...macrosSchema.properties,
            },
            required: ['name', 'menge', 'einheit', 'kcal', 'protein', 'kohlenhydrate', 'fett'],
            additionalProperties: false,
          },
        },
      },
      required: ['mahlzeit', 'positionen'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'lebensmittel_speichern',
    description:
      'Speichert ein Lebensmittel mit Nährwerten pro 100 g/ml in der Bibliothek des Nutzers. Nur verwenden, wenn der Nutzer das möchte.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        marke: { type: 'string' },
        einheit: { type: 'string', enum: ['g', 'ml'] },
        pro_100: macrosSchema,
        portion_groesse: { type: 'number', description: 'Typische Portion in g/ml' },
      },
      required: ['name', 'einheit', 'pro_100'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'daten_abrufen',
    description:
      'Liefert den AKTUELLEN Datenstand der App (der Datenstand im Systemprompt stammt vom Gesprächsbeginn). Bereiche: heute (Essen/Training/Schlaf heute + offene Makros), ernaehrung_14_tage, naehrstoffe (was in den letzten 7 Tagen gefehlt hat), training (Kraftsätze der letzten 3 Wochen oder Verlauf einer Übung mit "uebung"), aktivitaeten (Läufe, Radfahrten, Schwimmen, Hyrox … der letzten 4 Wochen), plan_und_bedarf (Trainingsplan mit IDs, Alltag, Tagesbedarf & Mahlzeiten-Timing heute), schlaf, gewicht, ziele, rahmenbedingungen (Pflicht-Regeln und ob sie eingehalten sind), auswertung (automatischer Zielabgleich & Trends), alles.',
    input_schema: {
      type: 'object',
      properties: {
        bereich: { type: 'string', enum: BEREICHE },
        uebung: { type: 'string', description: 'Nur für bereich=training: Name der Übung für den Einzelverlauf' },
      },
      required: ['bereich'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  ...ACTION_TOOLS,
];

export const TOOL_LABELS: Record<string, string> = {
  ...ACTION_LABELS,
  lebensmittel_suchen: 'Bibliothek durchsucht',
  naehrwerte_berechnen: 'Nährwerte berechnet',
  mahlzeit_eintragen: 'Ins Tagebuch eingetragen',
  lebensmittel_speichern: 'Lebensmittel gespeichert',
  daten_abrufen: 'Aktuelle Daten abgerufen',
};

const inputs = {
  lebensmittel_suchen: z.object({ suchbegriff: z.string().min(1) }),
  naehrwerte_berechnen: z.object({
    positionen: z
      .array(
        z.object({
          name: z.string().min(1),
          menge: z.number().positive(),
          einheit: z.enum(['g', 'ml']).optional(),
          pro_100: Macros100.optional(),
        }),
      )
      .min(1),
  }),
  mahlzeit_eintragen: z.object({
    datum: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    mahlzeit: z.enum(['fruehstueck', 'mittag', 'abend', 'snack']),
    positionen: z
      .array(
        Macros100.extend({
          name: z.string().min(1),
          menge: z.number().positive(),
          einheit: z.enum(['g', 'ml', 'Portion']),
        }),
      )
      .min(1),
  }),
  lebensmittel_speichern: z.object({
    name: z.string().min(1),
    marke: z.string().optional(),
    einheit: z.enum(['g', 'ml']),
    pro_100: Macros100,
    portion_groesse: z.number().positive().optional(),
  }),
  daten_abrufen: z.object({ bereich: z.enum(BEREICHE), uebung: z.string().optional() }),
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Findet das am besten passende Lebensmittel der Bibliothek. */
export function findFood(foods: Food[], name: string): Food | undefined {
  const q = norm(name);
  if (!q) return undefined;
  const exact = foods.find((f) => norm(f.name) === q || norm(`${f.brand ?? ''} ${f.name}`) === q);
  if (exact) return exact;
  const candidates = foods.filter((f) => {
    const n = norm(`${f.brand ?? ''} ${f.name}`);
    return n.includes(q) || (norm(f.name).length >= 4 && q.includes(norm(f.name)));
  });
  return candidates.sort((a, b) => a.name.length - b.name.length)[0];
}

const macroLine = (x: Macros) =>
  `${fmt(x.kcal)} kcal, Protein ${fmt(x.protein, 1)} g, Kohlenhydrate ${fmt(x.carbs, 1)} g, Fett ${fmt(x.fat, 1)} g`;

const fromTool = (x: z.infer<typeof Macros100>): Macros => ({
  kcal: x.kcal,
  protein: x.protein,
  carbs: x.kohlenhydrate,
  fat: x.fett,
});

async function execute(name: string, raw: unknown): Promise<string> {
  const today = getToday();
  if (isAction(name.toLowerCase())) return executeAction(name.toLowerCase(), raw);
  // Toleranz: gleicher Name mit anderer Groß-/Kleinschreibung
  switch (name.toLowerCase()) {
    case 'lebensmittel_suchen': {
      const { suchbegriff } = inputs.lebensmittel_suchen.parse(raw);
      const foods = await db.foods.toArray();
      const words = norm(suchbegriff).split(' ').filter(Boolean);
      const hits = foods.filter((f) => {
        const n = norm(`${f.brand ?? ''} ${f.name}`);
        return words.every((w) => n.includes(w));
      });
      if (!hits.length) return `Kein Treffer für „${suchbegriff}“ in der Bibliothek (${foods.length} Einträge).`;
      return hits
        .slice(0, 10)
        .map(
          (f) =>
            `${f.name}${f.brand ? ` (${f.brand})` : ''} – pro 100 ${f.unit}: ${macroLine(f.per100)}${
              f.per100.sugar != null ? `, davon Zucker ${fmt(f.per100.sugar, 1)} g` : ''
            }${f.servingSize ? `; Portion ${fmt(f.servingSize)} ${f.unit}${f.servingLabel ? ` (${f.servingLabel})` : ''}` : ''}`,
        )
        .join('\n');
    }

    case 'naehrwerte_berechnen': {
      const { positionen } = inputs.naehrwerte_berechnen.parse(raw);
      const data = await loadAppData();
      const resolved: { name: string; amount: number; per100: Macros; unit: string; source: string }[] = [];
      const missing: string[] = [];
      for (const p of positionen) {
        const food = p.pro_100 ? undefined : findFood(data.foods, p.name);
        if (food) {
          resolved.push({ name: p.name, amount: p.menge, per100: food.per100, unit: food.unit, source: `Bibliothek: ${food.name}` });
        } else if (p.pro_100) {
          resolved.push({ name: p.name, amount: p.menge, per100: fromTool(p.pro_100), unit: p.einheit ?? 'g', source: 'Durchschnittswerte' });
        } else missing.push(p.name);
      }
      if (missing.length)
        return `Nicht in der Bibliothek gefunden: ${missing.join(', ')}. Rufe das Werkzeug erneut auf und gib für diese Positionen pro_100 mit realistischen Durchschnittswerten an.`;
      const res = combine(resolved);
      const eatenToday = sumMacros(data.meals.filter((x) => x.date === today));
      const after = sumMacros([eatenToday, res.total]);
      // Ziel des heutigen Tages (nach Training & Alltag), nicht der Wochenschnitt
      const g = dayNeeds(today, { ...needsInputOf(data, today), goals: data.goals }).targets;
      return [
        ...res.items.map((it, i) => `- ${it.name} ${fmt(it.amount)} ${resolved[i].unit} (${resolved[i].source}): ${macroLine(it.macros)}`),
        `SUMME: ${macroLine(res.total)}`,
        `Kalorienanteile: Protein ${fmt(((res.total.protein * 4) / Math.max(1, res.total.kcal)) * 100)} %, KH ${fmt(((res.total.carbs * 4) / Math.max(1, res.total.kcal)) * 100)} %, Fett ${fmt(((res.total.fat * 9) / Math.max(1, res.total.kcal)) * 100)} %`,
        `Heute bereits gegessen: ${macroLine(eatenToday)}`,
        `Mit dieser Kombination: ${macroLine(after)}`,
        `Tagesziel: ${macroLine(g)} → danach noch offen: ${fmt(g.kcal - after.kcal)} kcal, Protein ${fmt(g.protein - after.protein, 1)} g, KH ${fmt(g.carbs - after.carbs, 1)} g, Fett ${fmt(g.fat - after.fat, 1)} g`,
      ].join('\n');
    }

    case 'mahlzeit_eintragen': {
      const input = inputs.mahlzeit_eintragen.parse(raw);
      const date = input.datum ?? today;
      const now = Date.now();
      const rows: MealEntry[] = input.positionen.map((p, i) => ({
        date,
        meal: input.mahlzeit,
        name: p.name,
        amount: p.menge,
        unit: p.einheit,
        ...fromTool(p),
        createdAt: now + i,
      }));
      await db.meals.bulkAdd(rows);
      const day = sumMacros(await db.meals.where('date').equals(date).toArray());
      const data = await loadAppData();
      const target = dayNeeds(date, { ...needsInputOf(data, today), goals: data.goals }).targets;
      return `Eingetragen am ${date} (${MEAL_LABELS[input.mahlzeit]}): ${rows.map((r) => `${r.name} ${fmt(r.amount)} ${r.unit}`).join(', ')}.\nTagessumme jetzt: ${macroLine(day)} (Tagesziel: ${macroLine(target)}).`;
    }

    case 'lebensmittel_speichern': {
      const input = inputs.lebensmittel_speichern.parse(raw);
      const existing = (await db.foods.toArray()).find((f) => norm(f.name) === norm(input.name));
      const food: Food = {
        name: input.name,
        brand: input.marke,
        unit: input.einheit,
        per100: fromTool(input.pro_100),
        servingSize: input.portion_groesse,
        source: 'chat',
        createdAt: Date.now(),
      };
      if (existing?.id != null) {
        await db.foods.update(existing.id, { ...food, photo: existing.photo });
        return `„${input.name}“ war schon in der Bibliothek und wurde aktualisiert.`;
      }
      await db.foods.add(food);
      return `„${input.name}“ wurde in der Bibliothek gespeichert.`;
    }

    case 'daten_abrufen': {
      const { bereich, uebung } = inputs.daten_abrufen.parse(raw);
      const data = await loadAppData();
      switch (bereich) {
        case 'heute':
          return describeToday(data, today);
        case 'ernaehrung_14_tage':
          return describeNutrition(data, today);
        case 'naehrstoffe':
          return describeNutrients(data, today);
        case 'training':
          return describeTraining(data, today, uebung);
        case 'aktivitaeten':
          return describeActivities(data, today);
        case 'plan_und_bedarf':
          return describePlanAndDay(data, today);
        case 'schlaf':
          return describeSleep(data, today);
        case 'gewicht':
          return describeWeight(data, today);
        case 'ziele':
          return describeGoals(data);
        case 'rahmenbedingungen':
          return describeRules(data);
        case 'auswertung':
          return describeAnalysis(runAnalysis(data, today));
        case 'alles':
          return buildSnapshot(data, today);
      }
    }
  }
  throw new Error(`Unbekanntes Werkzeug „${name}“. Verfügbar: ${Object.keys(inputs).join(', ')}`);
}

/** Führt einen Tool-Aufruf aus und verpackt Ergebnis oder Fehler als tool_result. */
export async function runTool(block: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
  try {
    const content = await execute(block.name, block.input);
    return { type: 'tool_result', tool_use_id: block.id, content };
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? `Ungültige Eingabe: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { type: 'tool_result', tool_use_id: block.id, content: message, is_error: true };
  }
}
