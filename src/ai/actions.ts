import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { findDuplicate, saveActivity } from '../activities';
import { db, ensureExercise, getKV, setKV } from '../db';
import { DEFAULT_SCHEDULE } from '../lib/dailyNeeds';
import { today as getToday } from '../lib/dates';
import { checkRules, enforceGoals, limits } from '../lib/guardrails';
import { sleepDurationMin } from '../lib/sleep';
import { formatDistance, newUid, SPORT_DEFS } from '../lib/sports';
import { fmt, fmtSigned } from '../lib/stats';
import { DEFAULT_PREFS, loadNeedsInput } from '../needs';
import type { GoalType, Goals, NutritionPreferences, PlannedSession, TrainingPlan, WeekSchedule, Weekday } from '../types';
import { DAY_KIND_LABELS, DEFAULT_GOALS, GOAL_LABELS, INTENSITY_LABELS, SPORTS, WEEKDAY_LABELS } from '../types';

/**
 * Werkzeuge, mit denen der KI-Coach Daten in allen Bereichen der App ändern kann
 * (Ziele, Trainingsplan, Alltag, Aktivitäten, Kraftsätze, Schlaf, Gewicht, Ernährungsvorlieben).
 * Kein Zugriff auf Social Media, Feed, fremde Profile oder Ranglisten.
 * Die Rahmenbedingungen gelten immer: Ziele werden angepasst, Pläne mit Verstoß abgelehnt.
 */

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
const wdIndex = (d: (typeof WD)[number]) => WD.indexOf(d) as Weekday;
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD');
const GOAL_TYPES = Object.keys(GOAL_LABELS) as [GoalType, ...GoalType[]];
const DAY_KINDS = Object.keys(DAY_KIND_LABELS) as [keyof typeof DAY_KIND_LABELS, ...(keyof typeof DAY_KIND_LABELS)[]];

/** Seiten, die der Coach öffnen darf – keine Social-/Ranglisten-Seiten. */
export const COACH_PAGES = ['heute', 'essen', 'training', 'aufzeichnen', 'schlaf', 'ziele', 'plan', 'profil', 'einstellungen'] as const;

const session = {
  type: 'object',
  properties: {
    wochentag: { type: 'string', enum: WD },
    sport: { type: 'string', enum: SPORTS },
    titel: { type: 'string' },
    uhrzeit: { type: 'string', description: 'HH:MM' },
    dauer_min: { type: 'number' },
    intensitaet: { type: 'string', enum: ['locker', 'mittel', 'hart'] },
    distanz_km: { type: 'number' },
    notiz: { type: 'string' },
  },
  required: ['wochentag', 'sport', 'titel', 'dauer_min', 'intensitaet'],
  additionalProperties: false,
} as const;

export const ACTION_TOOLS: BetaTool[] = [
  {
    name: 'ziele_aendern',
    description:
      'Ändert die Ziele unter „Ziele & Körper“: Zieltyp, Wochenrate (kg/Woche, negativ = abnehmen), Zielgewicht, Schlafziel, Trainings pro Woche und ob Kalorien/Makros automatisch berechnet werden. Wer kcal/Makros vorgibt, schaltet auf manuell. Die Rahmenbedingungen werden automatisch durchgesetzt – das Ergebnis nennt jede Anpassung. Nur auf ausdrücklichen Wunsch verwenden.',
    input_schema: {
      type: 'object',
      properties: {
        zieltyp: { type: 'string', enum: GOAL_TYPES },
        wochenrate_kg: { type: 'number' },
        zielgewicht_kg: { type: 'number' },
        schlaf_h: { type: 'number' },
        trainings_pro_woche: { type: 'integer' },
        automatik: { type: 'boolean', description: 'true = Kalorien & Makros automatisch aus Profil, Alltag, Plan und Rate' },
        kcal: { type: 'number' },
        protein: { type: 'number' },
        kohlenhydrate: { type: 'number' },
        fett: { type: 'number' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'trainingsplan_aendern',
    description:
      'Ändert den Trainingsplan: Einheiten hinzufügen, per ID entfernen (IDs stehen im Bereich plan_und_bedarf) oder den ganzen Plan ersetzen. Ein Plan, der die Rahmenbedingungen verletzt (kein Ruhetag, mehr als 3 harte Einheiten), wird NICHT gespeichert. Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        hinzufuegen: { type: 'array', items: session },
        entfernen: { type: 'array', items: { type: 'string' }, description: 'IDs der Einheiten' },
        alles_ersetzen: { type: 'boolean', description: 'true = bisherigen Plan verwerfen, nur „hinzufuegen“ gilt' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'alltag_aendern',
    description:
      'Ändert den Alltag (Arbeit, Uni, Schule) einzelner Wochentage: Art des Tages, Beginn/Ende, Aufstehen/Schlafen, aktive Minuten (Wege zu Fuß/Rad), ob warm gegessen werden kann. Der Tagesbedarf passt sich danach automatisch an. Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        tage: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              wochentag: { type: 'string', enum: WD },
              art: { type: 'string', enum: DAY_KINDS, description: 'buero, uni, stehend, koerperlich, frei' },
              beginn: { type: 'string', description: 'HH:MM' },
              ende: { type: 'string', description: 'HH:MM' },
              aufstehen: { type: 'string', description: 'HH:MM' },
              schlafen: { type: 'string', description: 'HH:MM' },
              aktive_minuten: { type: 'number' },
              kochen_moeglich: { type: 'boolean' },
            },
            required: ['wochentag'],
            additionalProperties: false,
          },
        },
      },
      required: ['tage'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'aktivitaet_eintragen',
    description:
      'Trägt eine absolvierte Aktivität ein (Laufen, Rad, Schwimmen, Wandern, Rudern, Hyrox, Gym, Powerlifting) – Punkte und Kalorien werden berechnet, Teilen folgt den Einstellungen des Nutzers. Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: SPORTS },
        titel: { type: 'string' },
        datum: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' },
        uhrzeit: { type: 'string', description: 'Startzeit HH:MM' },
        dauer_min: { type: 'number' },
        distanz_km: { type: 'number' },
        hoehenmeter: { type: 'number' },
        puls_schnitt: { type: 'number' },
        rpe: { type: 'number', description: 'Anstrengung 1–10' },
        notiz: { type: 'string' },
      },
      required: ['sport', 'dauer_min'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'kraftsaetze_eintragen',
    description: 'Trägt Kraftsätze ins Trainingstagebuch ein (Übung, Gewicht, Wiederholungen, wie oft). Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        datum: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' },
        saetze: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uebung: { type: 'string' },
              gewicht_kg: { type: 'number', description: '0 = Körpergewicht' },
              wiederholungen: { type: 'integer' },
              anzahl: { type: 'integer', description: 'Wie viele gleiche Sätze, Standard 1' },
              rpe: { type: 'number' },
            },
            required: ['uebung', 'gewicht_kg', 'wiederholungen'],
            additionalProperties: false,
          },
        },
      },
      required: ['saetze'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'schlaf_eintragen',
    description: 'Trägt eine Nacht ein (Datum = Tag des Aufwachens). Ein vorhandener Eintrag für das Datum wird ersetzt. Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        datum: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' },
        ins_bett: { type: 'string', description: 'HH:MM' },
        aufgestanden: { type: 'string', description: 'HH:MM' },
        qualitaet: { type: 'integer', description: '1 (sehr schlecht) bis 5 (sehr gut)' },
        notiz: { type: 'string' },
      },
      required: ['ins_bett', 'aufgestanden', 'qualitaet'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'gewicht_eintragen',
    description: 'Trägt das Körpergewicht ein (ersetzt einen Eintrag am selben Tag). Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: { datum: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' }, gewicht_kg: { type: 'number' } },
      required: ['gewicht_kg'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'vorlieben_aendern',
    description: 'Ändert die Ernährungsvorlieben für Plan & Rezepte (Ernährungsform, Mahlzeiten pro Tag, Abneigungen/Allergien, Kochzeit). Nur auf ausdrücklichen Wunsch.',
    input_schema: {
      type: 'object',
      properties: {
        ernaehrungsform: { type: 'string', enum: ['alles', 'vegetarisch', 'vegan', 'pescetarisch'] },
        mahlzeiten_pro_tag: { type: 'integer' },
        abneigungen: { type: 'string' },
        kochzeit_min: { type: 'number' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'seite_oeffnen',
    description: 'Öffnet eine Seite der App, z. B. damit der Nutzer ein Ergebnis direkt sieht. Feed, Profile anderer und Ranglisten sind nicht erreichbar.',
    input_schema: {
      type: 'object',
      properties: { seite: { type: 'string', enum: COACH_PAGES } },
      required: ['seite'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

export const ACTION_LABELS: Record<string, string> = {
  ziele_aendern: '🎯 Ziele geändert',
  trainingsplan_aendern: '🗓️ Trainingsplan geändert',
  alltag_aendern: '🏢 Alltag geändert',
  aktivitaet_eintragen: '🏃 Aktivität eingetragen',
  kraftsaetze_eintragen: '🏋️ Sätze eingetragen',
  schlaf_eintragen: '🌙 Schlaf eingetragen',
  gewicht_eintragen: '⚖️ Gewicht eingetragen',
  vorlieben_aendern: '🥗 Vorlieben geändert',
  seite_oeffnen: '↗️ Seite geöffnet',
};

const sessionInput = z.object({
  wochentag: z.enum(WD),
  sport: z.enum(SPORTS),
  titel: z.string().min(1),
  uhrzeit: TIME.optional(),
  dauer_min: z.number().positive().max(600),
  intensitaet: z.enum(['locker', 'mittel', 'hart']),
  distanz_km: z.number().positive().optional(),
  notiz: z.string().optional(),
});

const inputs = {
  ziele_aendern: z.object({
    zieltyp: z.enum(GOAL_TYPES).optional(),
    wochenrate_kg: z.number().min(-3).max(3).optional(),
    zielgewicht_kg: z.number().min(30).max(300).optional(),
    schlaf_h: z.number().min(3).max(14).optional(),
    trainings_pro_woche: z.number().int().min(0).max(14).optional(),
    automatik: z.boolean().optional(),
    kcal: z.number().min(0).max(10000).optional(),
    protein: z.number().min(0).max(600).optional(),
    kohlenhydrate: z.number().min(0).max(1500).optional(),
    fett: z.number().min(0).max(500).optional(),
  }),
  trainingsplan_aendern: z.object({
    name: z.string().optional(),
    hinzufuegen: z.array(sessionInput).optional(),
    entfernen: z.array(z.string()).optional(),
    alles_ersetzen: z.boolean().optional(),
  }),
  alltag_aendern: z.object({
    tage: z
      .array(
        z.object({
          wochentag: z.enum(WD),
          art: z.enum(DAY_KINDS).optional(),
          beginn: TIME.optional(),
          ende: TIME.optional(),
          aufstehen: TIME.optional(),
          schlafen: TIME.optional(),
          aktive_minuten: z.number().min(0).max(600).optional(),
          kochen_moeglich: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
  aktivitaet_eintragen: z.object({
    sport: z.enum(SPORTS),
    titel: z.string().optional(),
    datum: DATE.optional(),
    uhrzeit: TIME.optional(),
    dauer_min: z.number().positive().max(24 * 60),
    distanz_km: z.number().positive().max(1000).optional(),
    hoehenmeter: z.number().min(0).optional(),
    puls_schnitt: z.number().min(30).max(230).optional(),
    rpe: z.number().min(1).max(10).optional(),
    notiz: z.string().optional(),
  }),
  kraftsaetze_eintragen: z.object({
    datum: DATE.optional(),
    saetze: z
      .array(
        z.object({
          uebung: z.string().min(1),
          gewicht_kg: z.number().min(0).max(600),
          wiederholungen: z.number().int().positive().max(200),
          anzahl: z.number().int().positive().max(20).optional(),
          rpe: z.number().min(1).max(10).optional(),
        }),
      )
      .min(1),
  }),
  schlaf_eintragen: z.object({
    datum: DATE.optional(),
    ins_bett: TIME,
    aufgestanden: TIME,
    qualitaet: z.number().int().min(1).max(5),
    notiz: z.string().optional(),
  }),
  gewicht_eintragen: z.object({ datum: DATE.optional(), gewicht_kg: z.number().min(20).max(400) }),
  vorlieben_aendern: z.object({
    ernaehrungsform: z.enum(['alles', 'vegetarisch', 'vegan', 'pescetarisch']).optional(),
    mahlzeiten_pro_tag: z.number().int().min(1).max(8).optional(),
    abneigungen: z.string().optional(),
    kochzeit_min: z.number().min(0).max(240).optional(),
  }),
  seite_oeffnen: z.object({ seite: z.enum(COACH_PAGES) }),
};

export const isAction = (name: string) => name in inputs;

const kcalLine = (g: Pick<Goals, 'kcal' | 'protein' | 'carbs' | 'fat'>) => `${fmt(g.kcal)} kcal · P ${fmt(g.protein)} g · KH ${fmt(g.carbs)} g · F ${fmt(g.fat)} g`;

function describeSession(s: PlannedSession): string {
  return `[${s.id}] ${WEEKDAY_LABELS[s.weekday]}${s.time ? ` ${s.time}` : ''}: ${SPORT_DEFS[s.sport].label} „${s.title}“, ${s.durationMin} min, ${INTENSITY_LABELS[s.intensity]}${s.distanceKm ? `, ${fmt(s.distanceKm, 1)} km` : ''}`;
}

export async function executeAction(name: string, raw: unknown): Promise<string> {
  const today = getToday();
  switch (name) {
    case 'ziele_aendern': {
      const i = inputs.ziele_aendern.parse(raw);
      const g: Goals = { ...(await getKV<Goals>('goals', DEFAULT_GOALS)) };
      if (i.zieltyp) g.type = i.zieltyp;
      if (i.wochenrate_kg != null) g.weeklyRate = i.wochenrate_kg;
      if (i.zielgewicht_kg != null) g.targetWeight = i.zielgewicht_kg;
      if (i.schlaf_h != null) g.sleepHours = i.schlaf_h;
      if (i.trainings_pro_woche != null) g.trainingDays = i.trainings_pro_woche;
      const manualMacros = i.kcal != null || i.protein != null || i.kohlenhydrate != null || i.fett != null;
      if (manualMacros) {
        g.auto = false;
        if (i.kcal != null) g.kcal = i.kcal;
        if (i.protein != null) g.protein = i.protein;
        if (i.kohlenhydrate != null) g.carbs = i.kohlenhydrate;
        if (i.fett != null) g.fat = i.fett;
      }
      if (i.automatik != null) g.auto = i.automatik;
      const before = await loadNeedsInput(today);
      const { goals, changes } = enforceGoals(g, limits(before.profile, before.weight));
      await setKV('goals', goals);
      const after = await loadNeedsInput(today);
      const lines = [
        `Gespeichert: ${GOAL_LABELS[goals.type]}, ${fmtSigned(goals.weeklyRate, 2)} kg/Woche${goals.targetWeight ? `, Zielgewicht ${fmt(goals.targetWeight, 1)} kg` : ''}, Schlaf ${fmt(goals.sleepHours, 1)} h, ${goals.trainingDays}× Training/Woche.`,
        `Tagesziel (Ø Woche, ${after.goals.auto ? 'automatisch' : 'manuell'}): ${kcalLine(after.goals)}.`,
      ];
      if (goals.auto !== false && !after.goals.auto) lines.push('Automatik braucht Alter, Größe (Ziele → Profil) und ein Gewicht – bis dahin gelten die manuellen Werte.');
      if (changes.length) lines.push(`Wegen der Rahmenbedingungen angepasst: ${changes.join('; ')}.`);
      return lines.join('\n');
    }

    case 'trainingsplan_aendern': {
      const i = inputs.trainingsplan_aendern.parse(raw);
      const cur = await getKV<TrainingPlan | null>('trainingPlan', null);
      let sessions = i.alles_ersetzen ? [] : [...(cur?.sessions ?? [])];
      const removed = sessions.filter((s) => i.entfernen?.includes(s.id));
      const unknown = (i.entfernen ?? []).filter((id) => !sessions.some((s) => s.id === id));
      if (unknown.length) throw new Error(`Unbekannte IDs: ${unknown.join(', ')}. Rufe daten_abrufen mit bereich=plan_und_bedarf auf, um die IDs zu sehen.`);
      sessions = sessions.filter((s) => !i.entfernen?.includes(s.id));
      const added: PlannedSession[] = (i.hinzufuegen ?? []).map((s) => ({
        id: newUid(),
        weekday: wdIndex(s.wochentag),
        sport: s.sport,
        title: s.titel,
        ...(s.uhrzeit ? { time: s.uhrzeit } : {}),
        durationMin: s.dauer_min,
        intensity: s.intensitaet,
        ...(s.distanz_km ? { distanceKm: s.distanz_km } : {}),
        ...(s.notiz ? { note: s.notiz } : {}),
      }));
      sessions.push(...added);
      const plan: TrainingPlan = { name: i.name ?? cur?.name ?? 'Mein Trainingsplan', sessions, updatedAt: Date.now(), source: 'ki' };
      const { profile, weight, goals } = await loadNeedsInput(today);
      const broken = checkRules(goals, plan, limits(profile, weight)).filter((r) => (r.id === 'rest' || r.id === 'hard') && !r.ok);
      if (broken.length)
        throw new Error(
          `NICHT gespeichert – Rahmenbedingung verletzt: ${broken.map((r) => `${r.label} (${r.current}, Pflicht: ${r.requirement}) → ${r.fix}`).join(' ')} Schlage dem Nutzer eine Variante vor, die die Regeln einhält.`,
        );
      await setKV('trainingPlan', plan);
      const lines = [`Plan „${plan.name}“ gespeichert (${sessions.length} Einheiten).`];
      if (added.length) lines.push(`Neu: ${added.map(describeSession).join('; ')}`);
      if (removed.length) lines.push(`Entfernt: ${removed.map(describeSession).join('; ')}`);
      return lines.join('\n');
    }

    case 'alltag_aendern': {
      const i = inputs.alltag_aendern.parse(raw);
      const week: WeekSchedule = [...((await getKV<WeekSchedule | null>('schedule', null)) ?? DEFAULT_SCHEDULE)].map((d) => ({ ...d }));
      for (const t of i.tage) {
        const idx = wdIndex(t.wochentag);
        const d = week[idx];
        if (t.art) d.kind = t.art;
        if (t.beginn) d.start = t.beginn;
        if (t.ende) d.end = t.ende;
        if (t.aufstehen) d.wake = t.aufstehen;
        if (t.schlafen) d.sleep = t.schlafen;
        if (t.aktive_minuten != null) d.activeMinutes = t.aktive_minuten;
        if (t.kochen_moeglich != null) d.canCook = t.kochen_moeglich;
        if (d.kind !== 'frei' && (!d.start || !d.end)) throw new Error(`${WEEKDAY_LABELS[idx]}: Bitte Beginn und Ende angeben (HH:MM).`);
      }
      await setKV('schedule', week);
      return `Alltag gespeichert: ${i.tage
        .map((t) => {
          const d = week[wdIndex(t.wochentag)];
          return `${WEEKDAY_LABELS[wdIndex(t.wochentag)]} ${DAY_KIND_LABELS[d.kind].split(' (')[0]}${d.kind !== 'frei' ? ` ${d.start}–${d.end}` : ''}`;
        })
        .join('; ')}. Der Tagesbedarf ist neu berechnet.`;
    }

    case 'aktivitaet_eintragen': {
      const i = inputs.aktivitaet_eintragen.parse(raw);
      const date = i.datum ?? today;
      if (date > today) throw new Error('Aktivitäten in der Zukunft gehören in den Trainingsplan (trainingsplan_aendern).');
      const startTime = Date.parse(`${date}T${i.uhrzeit ?? '18:00'}:00`);
      const dup = await findDuplicate(startTime, i.sport);
      if (dup) return `Nicht eingetragen: Es gibt schon „${dup.title}“ (${SPORT_DEFS[dup.sport].label}) zu dieser Zeit.`;
      const def = SPORT_DEFS[i.sport];
      const id = await saveActivity({
        sport: i.sport,
        title: i.titel ?? def.label,
        date,
        startTime,
        durationSec: Math.round(i.dauer_min * 60),
        ...(i.distanz_km ? { distanceM: Math.round(i.distanz_km * 1000) } : {}),
        ...(i.hoehenmeter != null ? { elevationGainM: i.hoehenmeter } : {}),
        ...(i.puls_schnitt ? { avgHr: i.puls_schnitt } : {}),
        ...(i.rpe ? { rpe: i.rpe } : {}),
        ...(i.notiz ? { note: i.notiz } : {}),
        source: 'manuell',
      });
      const a = await db.activities.get(id);
      return `Eingetragen: ${def.label} „${a?.title}“ am ${date}, ${fmt(i.dauer_min)} min${a?.distanceM ? `, ${formatDistance(a.distanceM)}` : ''} → +${fmt(a?.points ?? 0)} Punkte${a?.kcal ? `, ~${fmt(a.kcal)} kcal` : ''}.${a?.points === 0 ? ' Keine Punkte: Die Werte wirken unrealistisch.' : ''}`;
    }

    case 'kraftsaetze_eintragen': {
      const i = inputs.kraftsaetze_eintragen.parse(raw);
      const date = i.datum ?? today;
      let t = Date.now();
      const done: string[] = [];
      for (const s of i.saetze) {
        const exercise = await ensureExercise(s.uebung);
        const n = s.anzahl ?? 1;
        for (let k = 0; k < n; k++) await db.sets.add({ date, exercise, weight: s.gewicht_kg, reps: s.wiederholungen, ...(s.rpe ? { rpe: s.rpe } : {}), createdAt: t++ });
        done.push(`${exercise} ${n} × ${s.wiederholungen}${s.gewicht_kg > 0 ? ` @ ${fmt(s.gewicht_kg, 1)} kg` : ''}`);
      }
      return `Eingetragen am ${date}: ${done.join('; ')}. Zum Teilen als Aktivität: Seite „training“ → „Einheit abschließen“.`;
    }

    case 'schlaf_eintragen': {
      const i = inputs.schlaf_eintragen.parse(raw);
      const date = i.datum ?? today;
      const durationMin = sleepDurationMin(i.ins_bett, i.aufgestanden);
      const entry = { date, bedtime: i.ins_bett, wakeTime: i.aufgestanden, durationMin, quality: i.qualitaet as 1 | 2 | 3 | 4 | 5, ...(i.notiz ? { note: i.notiz } : {}) };
      const existing = await db.sleep.where('date').equals(date).first();
      if (existing?.id != null) await db.sleep.update(existing.id, entry);
      else await db.sleep.add(entry);
      const { goals } = await loadNeedsInput(today);
      return `Schlaf am ${date}: ${fmt(durationMin / 60, 1)} h, Qualität ${i.qualitaet}/5 (Ziel ${fmt(goals.sleepHours, 1)} h).`;
    }

    case 'gewicht_eintragen': {
      const i = inputs.gewicht_eintragen.parse(raw);
      const date = i.datum ?? today;
      const existing = await db.weights.where('date').equals(date).first();
      if (existing?.id != null) await db.weights.update(existing.id, { weight: i.gewicht_kg });
      else await db.weights.add({ date, weight: i.gewicht_kg });
      const { goals } = await loadNeedsInput(today);
      return `Gewicht am ${date}: ${fmt(i.gewicht_kg, 1)} kg. Tagesziel jetzt Ø ${kcalLine(goals)}.`;
    }

    case 'vorlieben_aendern': {
      const i = inputs.vorlieben_aendern.parse(raw);
      const cur = await getKV<NutritionPreferences>('nutritionPrefs', DEFAULT_PREFS);
      const next: NutritionPreferences = {
        ...cur,
        ...(i.ernaehrungsform ? { diet: i.ernaehrungsform } : {}),
        ...(i.mahlzeiten_pro_tag ? { mealsPerDay: i.mahlzeiten_pro_tag } : {}),
        ...(i.abneigungen != null ? { dislikes: i.abneigungen } : {}),
        ...(i.kochzeit_min != null ? { cookingMinutes: i.kochzeit_min } : {}),
      };
      await setKV('nutritionPrefs', next);
      return `Vorlieben gespeichert: ${next.diet}, ${next.mealsPerDay} Mahlzeiten/Tag, Kochzeit ${next.cookingMinutes} min${next.dislikes ? `, ohne: ${next.dislikes}` : ''}.`;
    }

    case 'seite_oeffnen': {
      const { seite } = inputs.seite_oeffnen.parse(raw);
      if (typeof window !== 'undefined') window.location.hash = `/${seite}`;
      return `Seite „${seite}“ geöffnet.`;
    }
  }
  throw new Error(`Unbekanntes Werkzeug „${name}“`);
}

export { describeSession };
