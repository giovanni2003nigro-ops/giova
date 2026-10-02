import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { blobToBase64 } from '../lib/image';
import { CATEGORY_DEFS, POST_CATEGORIES, type PostCategory } from '../lib/postRules';
import { SPORT_DEFS } from '../lib/sports';
import type { Sport } from '../types';
import { createClient, FALLBACK_BETA, MODEL, RefusalError } from './client';

/** Ergebnis der KI-Prüfung – wird so auch am Beitrag gespeichert (Spalte moderation). */
export const PostVerdictSchema = z.object({
  sport: z.boolean().describe('true, wenn Bild/Video und Text klar einen Sportbezug haben'),
  unangemessen: z.boolean().describe('true bei Nacktheit, Gewalt, Hass, Drogen, Werbung/Spam oder sichtbaren privaten Daten'),
  kategorie: z.enum(POST_CATEGORIES).describe('Am besten passende Kategorie'),
  erkannt: z.string().describe('Was ist zu sehen? Ein kurzer Satz'),
  grund: z.string().describe('Kurze Begründung für den Nutzer, besonders wenn abgelehnt'),
});
export type PostVerdict = z.infer<typeof PostVerdictSchema>;

export const POST_RULES_PROMPT = `Du prüfst Beiträge für eine Sport-Community (Laufen, Radfahren, Schwimmen, Wandern, Rudern, Hyrox, Gym, Powerlifting). Erlaubt sind NUR Beiträge mit klarem Sportbezug, zum Beispiel:
- Rekorde und Ergebnisse (Uhr/Anzeige mit Zeit, Hantel mit Gewicht, Zieleinlauf)
- Technik und Anleitungen (wie man läuft, Kniebeuge, Kraulzug …)
- Trainingseinheiten, Workouts, Trainingsorte
- Wettkämpfe (Startnummer, Rennen, Hyrox, Meet)
- Sportoutfits und Ausrüstung (Laufschuhe, Trikot, Gürtel, Uhr)
- Motivation und Fortschritt im Sport
- Sporternährung (Meal-Prep, Verpflegung im Wettkampf)

Nicht erlaubt: Beiträge ohne Sportbezug (Urlaub, Essen ohne Sportbezug, Selfies ohne Sport, Memes, Politik), Nacktheit oder sexualisierte Darstellung, Gewalt, Hass, Drogen, Werbung/Spam/Links, sichtbare private Daten Dritter (Adressen, Kennzeichen, Ausweise).
Ein Sportoutfit-Foto in Sportkleidung ist erlaubt, wenn es nicht sexualisiert ist. Bewerte Bild(er) UND Text zusammen. Bei Videos siehst du Einzelbilder vom Anfang, aus der Mitte und vom Ende.`;

/** Prüft Foto bzw. Video-Einzelbilder und Text mit Claude, bevor etwas hochgeladen wird. */
export async function checkPost(
  apiKey: string,
  input: { images: Blob[]; caption: string; category: PostCategory; sport: Sport | null; video: boolean },
  signal?: AbortSignal,
): Promise<PostVerdict> {
  const client = createClient(apiKey);
  const images = await Promise.all(input.images.slice(0, 4).map(blobToBase64));
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: POST_RULES_PROMPT,
      output_config: { effort: 'low', format: betaZodOutputFormat(PostVerdictSchema) },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((data) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } })),
            {
              type: 'text',
              text: `${input.video ? 'Video (Einzelbilder oben)' : 'Foto'}. Gewählte Kategorie: ${CATEGORY_DEFS[input.category].label}${
                input.sport ? `, Sportart: ${SPORT_DEFS[input.sport].label}` : ''
              }.\nText des Beitrags: ${input.caption.trim() ? `„${input.caption.trim()}“` : '(kein Text)'}\n\nDarf das veröffentlicht werden?`,
            },
          ],
        },
      ],
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') return { sport: false, unangemessen: true, kategorie: input.category, erkannt: '', grund: 'Der Inhalt wurde von der KI-Prüfung abgelehnt.' };
  if (!response.parsed_output) throw new RefusalError();
  return response.parsed_output;
}

/** Darf der Beitrag laut Prüfung sofort sichtbar werden? */
export const verdictOk = (v: PostVerdict) => v.sport && !v.unangemessen;
