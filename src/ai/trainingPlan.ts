import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { blobToBase64, compressImage } from '../lib/image';
import { newUid } from '../lib/sports';
import type { PlannedSession, TrainingPlan } from '../types';
import { SPORTS } from '../types';
import { createClient, FALLBACK_BETA, MODEL, RefusalError } from './client';

const PlanSchema = z.object({
  lesbar: z.boolean().describe('false, wenn kein Trainingsplan erkennbar ist'),
  name: z.string().describe('Kurzer Name des Plans, z. B. "Halbmarathon-Plan Woche 3"'),
  einheiten: z.array(
    z.object({
      wochentag: z.number().int().describe('0 = Montag … 6 = Sonntag'),
      sportart: z.enum(SPORTS),
      titel: z.string().describe('z. B. "Intervalle 6 × 800 m" oder "Push-Tag"'),
      uhrzeit: z.string().nullable().describe('"HH:MM", falls angegeben'),
      dauer_min: z.number().describe('Geschätzte Dauer in Minuten'),
      intensitaet: z.enum(['locker', 'mittel', 'hart']),
      distanz_km: z.number().nullable(),
      notiz: z.string().nullable().describe('Wichtige Details (Pace, Sätze, Stationen), knapp'),
    }),
  ),
  hinweis: z.string().describe('Kurze Anmerkung, z. B. welche Woche übernommen wurde oder was unklar war; sonst leer'),
});

const PROMPT = `Lies diesen Trainingsplan aus und übertrage ihn in eine typische Trainingswoche (Montag bis Sonntag).

- Umfasst der Plan mehrere Wochen, nimm die aktuelle bzw. erste vollständige Woche und nenne das im Hinweis.
- Sportarten: laufen, radfahren, schwimmen, wandern, rudern, hyrox (auch funktionelles Training mit Stationen, Wall Balls, Sled usw.), gym (Krafttraining, Bodybuilding), powerlifting (Kniebeuge/Bankdrücken/Kreuzheben mit schweren Sätzen).
- Intensität: locker (Grundlage, Regeneration, Technik), mittel (Tempodauerlauf, normales Krafttraining), hart (Intervalle, Wettkampf, Maximalversuche, Hyrox-Simulation).
- Schätze eine realistische Dauer, wenn keine angegeben ist (inkl. Ein- und Auslaufen).
- Ruhetage nicht als Einheit eintragen.
- Wenn kein Trainingsplan zu sehen ist: lesbar = false und keine Einheiten.`;

export type PlanSource = { kind: 'text'; text: string } | { kind: 'file'; file: File };

/** Liest einen Trainingsplan (Foto, PDF oder Text) mit Claude aus. */
export async function parseTrainingPlan(apiKey: string, source: PlanSource, signal?: AbortSignal): Promise<{ plan: TrainingPlan; note: string }> {
  const content: BetaContentBlockParam[] = [];
  if (source.kind === 'text') content.push({ type: 'text', text: `Trainingsplan:\n\n${source.text}` });
  else if (source.file.type === 'application/pdf' || source.file.name.toLowerCase().endsWith('.pdf')) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(source.file) } });
  } else if (source.file.type.startsWith('image/')) {
    const img = await compressImage(source.file);
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(img) } });
  } else {
    content.push({ type: 'text', text: `Trainingsplan (${source.file.name}):\n\n${(await source.file.text()).slice(0, 60_000)}` });
  }
  content.push({ type: 'text', text: PROMPT });

  const client = createClient(apiKey);
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
      messages: [{ role: 'user', content }],
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') throw new RefusalError();
  const out = response.parsed_output;
  if (response.stop_reason === 'max_tokens' || !out) throw new Error('Der Plan konnte nicht gelesen werden. Versuche ein schärferes Foto oder füge den Text ein.');
  if (!out.lesbar || !out.einheiten.length) throw new Error(out.hinweis || 'Darin ist kein Trainingsplan erkennbar.');
  const sessions: PlannedSession[] = out.einheiten
    .filter((e) => e.wochentag >= 0 && e.wochentag <= 6)
    .map((e) => ({
      id: newUid(),
      weekday: e.wochentag as PlannedSession['weekday'],
      sport: e.sportart,
      title: e.titel,
      ...(e.uhrzeit && /^\d{1,2}:\d{2}$/.test(e.uhrzeit) ? { time: e.uhrzeit.padStart(5, '0') } : {}),
      durationMin: Math.max(10, Math.min(360, Math.round(e.dauer_min))),
      intensity: e.intensitaet,
      ...(e.distanz_km ? { distanceKm: e.distanz_km } : {}),
      ...(e.notiz ? { note: e.notiz } : {}),
    }));
  return { plan: { name: out.name, sessions, updatedAt: Date.now(), source: 'ki' }, note: out.hinweis };
}
