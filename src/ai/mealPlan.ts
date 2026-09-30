import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { formatDateLong } from '../lib/dates';
import type { DayNeeds } from '../lib/dailyNeeds';
import { scaleMacros, sumMacros } from '../lib/nutrition';
import { formatDurationSec, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { DayPlan, Food, Macros, MealEntry, NutritionPreferences, PlannedMeal, PlannedMealItem } from '../types';
import { DAY_KIND_LABELS, INTENSITY_LABELS } from '../types';
import { createClient, FALLBACK_BETA, MODEL, RefusalError } from './client';

const Per100 = z.object({ kcal: z.number(), protein: z.number(), kohlenhydrate: z.number(), fett: z.number() });

const MealPlanSchema = z.object({
  mahlzeiten: z.array(
    z.object({
      slot: z.string().describe('Name des Zeitfensters genau wie vorgegeben, z. B. "Frühstück"'),
      uhrzeit: z.string().describe('"HH:MM"'),
      titel: z.string().describe('Name des Gerichts'),
      rezept: z.string().describe('Zubereitung in 2–5 kurzen Schritten, als Markdown-Liste'),
      zubereitung_min: z.number(),
      zutaten: z.array(
        z.object({
          lebensmittel_id: z.number().nullable().describe('ID aus der Bibliothek, sonst null'),
          name: z.string(),
          menge: z.number().describe('Menge in g bzw. ml'),
          einheit: z.enum(['g', 'ml']),
          pro_100: Per100.nullable().describe('Nur für Zutaten ohne lebensmittel_id: realistische Nährwerte pro 100 g/ml'),
        }),
      ),
    }),
  ),
  hinweise: z.string().describe('1–3 kurze Tipps für den Tag (Timing, Meal-Prep, Einkauf); Markdown'),
});

const SYSTEM = `Du bist Ernährungscoach für Ausdauer- und Kraftsportler in der App Giova Fit. Du planst die Mahlzeiten für einen konkreten Tag auf Deutsch.

Regeln:
- Triff die vorgegebenen Tagesziele (kcal, Protein, Kohlenhydrate, Fett) möglichst genau; jede Mahlzeit ungefähr mit ihrem Anteil. Protein gleichmäßig verteilen (≥ 25 g pro Hauptmahlzeit).
- Nutze vor allem Lebensmittel aus der Bibliothek des Nutzers (mit lebensmittel_id) – das sind Produkte, die er oft isst und zu Hause hat. Ergänze nur, was für ein richtiges Gericht fehlt (Gemüse, Obst, Grundzutaten, Gewürze), dann mit realistischen deutschen Durchschnitts-Nährwerten in pro_100.
- Rechne nicht selbst die Summen aus – die App berechnet alle Nährwerte aus Mengen und pro-100-Werten.
- Beachte Ernährungsform, Abneigungen und die verfügbare Kochzeit.
- Zeitfenster „zum Mitnehmen“: Gerichte, die kalt schmecken oder sich in der Box aufwärmen lassen (Meal-Prep).
- Vor dem Training: leicht verdaulich, kohlenhydratreich, wenig Fett und Ballaststoffe. Nach dem Training: Protein + Kohlenhydrate.
- Realistische Mengen und Gerichte, die man wirklich kocht. Keine medizinischen Aussagen.`;

function describeFood(f: Food): string {
  const p = f.per100;
  return `#${f.id} ${f.name}${f.brand ? ` (${f.brand})` : ''} – pro 100 ${f.unit}: ${fmt(p.kcal)} kcal, P ${fmt(p.protein, 1)}, KH ${fmt(p.carbs, 1)}, F ${fmt(p.fat, 1)}${f.servingSize ? `; Portion ${fmt(f.servingSize)} ${f.unit}${f.servingLabel ? ` (${f.servingLabel})` : ''}` : ''}`;
}

const m = (x: Macros) => `${fmt(x.kcal)} kcal · P ${fmt(x.protein)} g · KH ${fmt(x.carbs)} g · F ${fmt(x.fat)} g`;

export function buildMealPrompt(needs: DayNeeds, foods: Food[], prefs: NutritionPreferences, eaten: MealEntry[], now: string | null): string {
  const d = needs.day;
  const eatenSum = sumMacros(eaten);
  const remaining: Macros = {
    kcal: needs.targets.kcal - eatenSum.kcal,
    protein: needs.targets.protein - eatenSum.protein,
    carbs: needs.targets.carbs - eatenSum.carbs,
    fat: needs.targets.fat - eatenSum.fat,
  };
  const slots = needs.slots.filter((s) => !now || s.time >= now);
  const lines = [
    `Tag: ${formatDateLong(needs.date)}`,
    `Alltag: ${DAY_KIND_LABELS[d.kind]}${d.start && d.end && d.kind !== 'frei' ? ` von ${d.start} bis ${d.end}` : ''}, Aufstehen ${d.wake}, Schlafen ${d.sleep}, ${d.canCook ? 'Küche verfügbar' : 'tagsüber keine Küche'}`,
    `Training: ${
      [
        ...needs.done.map((a) => `${SPORT_DEFS[a.sport].label} „${a.title}“ (erledigt, ${formatDurationSec(a.durationSec)})`),
        ...needs.sessions.map((s) => `${SPORT_DEFS[s.sport].label} „${s.title}“ ${s.time ? `um ${s.time}` : ''} (${s.durationMin} min, ${INTENSITY_LABELS[s.intensity]})`),
      ].join('; ') || 'Ruhetag'
    }`,
    `Tagesziel: ${m(needs.targets)}`,
  ];
  if (eaten.length) {
    lines.push(`Schon gegessen: ${eaten.map((e) => `${e.name} ${fmt(e.amount)} ${e.unit}`).join(', ')} → ${m(eatenSum)}`);
    lines.push(`Noch zu planen: ${m(remaining)}`);
  }
  lines.push('', 'Zeitfenster (Anteil am noch offenen Bedarf):');
  const shareSum = slots.reduce((s, x) => s + x.share, 0) || 1;
  for (const s of slots) lines.push(`- ${s.time} ${s.slot}: ca. ${fmt((remaining.kcal * s.share) / shareSum)} kcal${s.hint ? ` – ${s.hint}` : ''}`);
  lines.push(
    '',
    `Vorlieben: Ernährung ${prefs.diet}, max. ${prefs.cookingMinutes} min Kochzeit pro Mahlzeit${prefs.dislikes.trim() ? `, mag nicht: ${prefs.dislikes.trim()}` : ''}.`,
    '',
    'Lebensmittel-Bibliothek:',
    foods.length ? foods.map(describeFood).join('\n') : '(leer – nutze gängige Lebensmittel mit Durchschnittswerten)',
    '',
    'Plane jetzt die Mahlzeiten für diese Zeitfenster.',
  );
  return lines.join('\n');
}

/** Übernimmt die KI-Zutaten und rechnet die Nährwerte selbst (Bibliothek = Quelle der Wahrheit). */
export function resolveItems(items: z.infer<typeof MealPlanSchema>['mahlzeiten'][number]['zutaten'], foods: Food[]): PlannedMealItem[] {
  const byId = new Map(foods.map((f) => [f.id, f]));
  return items.map((it) => {
    const food = it.lebensmittel_id != null ? byId.get(it.lebensmittel_id) : undefined;
    const per100: Macros = food
      ? food.per100
      : { kcal: it.pro_100?.kcal ?? 0, protein: it.pro_100?.protein ?? 0, carbs: it.pro_100?.kohlenhydrate ?? 0, fat: it.pro_100?.fett ?? 0 };
    const amount = Math.max(0, Math.round(it.menge));
    return {
      name: food ? food.name : it.name,
      amount,
      unit: food ? food.unit : it.einheit,
      ...(food?.id != null ? { foodId: food.id } : {}),
      macros: scaleMacros(per100, amount),
      per100,
    } as PlannedMealItem & { per100: Macros };
  });
}

/** Rundet auf gut abwiegbare Mengen (5 g bzw. 10 g ab 100 g). */
const niceAmount = (v: number) => (v >= 100 ? Math.round(v / 10) * 10 : Math.max(5, Math.round(v / 5) * 5));

/**
 * Feinabstimmung: skaliert die Mengen einer Mahlzeit, damit sie ihren Kalorienanteil trifft
 * (höchstens −25 % / +30 %, damit das Gericht stimmig bleibt).
 */
export function tuneMeal(items: (PlannedMealItem & { per100: Macros })[], targetKcal: number): PlannedMealItem[] {
  const total = items.reduce((s, i) => s + i.macros.kcal, 0);
  const f = total > 0 ? Math.min(1.3, Math.max(0.75, targetKcal / total)) : 1;
  return items.map(({ per100, ...i }) => {
    // Kleinstmengen (Gewürze, Öl-Spritzer < 10 g) nicht verändern
    const amount = i.amount < 10 ? i.amount : niceAmount(i.amount * f);
    return { ...i, amount, macros: scaleMacros(per100, amount) };
  });
}

export async function generateDayPlan(
  apiKey: string,
  needs: DayNeeds,
  foods: Food[],
  prefs: NutritionPreferences,
  eaten: MealEntry[],
  now: string | null,
  signal?: AbortSignal,
): Promise<DayPlan> {
  const client = createClient(apiKey);
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(MealPlanSchema) },
      messages: [{ role: 'user', content: buildMealPrompt(needs, foods, prefs, eaten, now) }],
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') throw new RefusalError();
  const out = response.parsed_output;
  if (response.stop_reason === 'max_tokens' || !out) throw new Error('Der Plan war zu lang oder unvollständig. Bitte nochmal versuchen.');

  const eatenKcal = sumMacros(eaten).kcal;
  const remainingKcal = Math.max(0, needs.targets.kcal - eatenKcal);
  const slots = needs.slots.filter((s) => !now || s.time >= now);
  const shareSum = slots.reduce((s, x) => s + x.share, 0) || 1;
  const meals: PlannedMeal[] = out.mahlzeiten.map((meal) => {
    const slot = slots.find((s) => s.slot === meal.slot);
    const raw = resolveItems(meal.zutaten, foods) as (PlannedMealItem & { per100: Macros })[];
    const items = slot ? tuneMeal(raw, (remainingKcal * slot.share) / shareSum) : raw.map(({ per100: _p, ...i }) => i);
    return {
      time: slot?.time ?? meal.uhrzeit,
      slot: meal.slot,
      title: meal.titel,
      recipe: meal.rezept,
      prepMinutes: Math.round(meal.zubereitung_min),
      items,
      total: sumMacros(items.map((i) => i.macros)),
    };
  });
  return { date: needs.date, createdAt: Date.now(), targets: needs.targets, meals: meals.sort((a, b) => a.time.localeCompare(b.time)), notes: out.hinweise };
}
