import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { blobToBase64 } from '../lib/image';
import { createClient, FALLBACK_BETA, MODEL, RefusalError } from './client';

const LabelSchema = z.object({
  lesbar: z.boolean().describe('false, wenn keine Nährwerttabelle erkennbar ist'),
  name: z.string().describe('Produktname, falls sichtbar, sonst eine kurze Beschreibung'),
  marke: z.string().nullable(),
  bezug: z.enum(['100g', '100ml']).describe('Worauf sich die Werte beziehen'),
  kcal: z.number(),
  protein: z.number(),
  kohlenhydrate: z.number(),
  fett: z.number(),
  zucker: z.number().nullable(),
  ballaststoffe: z.number().nullable(),
  salz: z.number().nullable(),
  gesaettigte_fettsaeuren: z.number().nullable(),
  portion_groesse: z.number().nullable().describe('Portionsgröße in g bzw. ml, falls angegeben'),
  portion_bezeichnung: z.string().nullable().describe('z. B. "1 Riegel" oder "1 Scoop"'),
  hinweis: z.string().describe('Kurze Anmerkung zu Unsicherheiten, sonst leer'),
});

export type LabelScan = z.infer<typeof LabelSchema>;

const PROMPT = `Lies die Nährwerttabelle auf diesem Foto aus.

- Gib die Werte immer pro 100 g bzw. 100 ml an. Steht nur ein Wert pro Portion da, rechne ihn mit der Portionsgröße auf 100 g/ml um und erwähne das im Hinweis.
- Energie in kcal (nicht kJ). Fehlt die kcal-Angabe, rechne kJ ÷ 4,184.
- "davon Zucker" gehört zu zucker, "davon gesättigte Fettsäuren" zu gesaettigte_fettsaeuren.
- Nicht erkennbare optionale Werte als null.
- Wenn keine Nährwerttabelle zu sehen ist: lesbar = false und alle Zahlen 0.`;

/** Liest eine fotografierte Nährwerttabelle mit Claude aus. */
export async function scanNutritionLabel(apiKey: string, photo: Blob, signal?: AbortSignal): Promise<LabelScan> {
  const client = createClient(apiKey);
  const data = await blobToBase64(photo);
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(LabelSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') throw new RefusalError();
  if (response.stop_reason === 'max_tokens' || !response.parsed_output)
    throw new Error('Die Nährwerte konnten nicht ausgelesen werden. Versuche ein schärferes Foto.');
  return response.parsed_output;
}
