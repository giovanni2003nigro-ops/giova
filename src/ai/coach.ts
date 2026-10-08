import { setKV } from '../db';
import { today } from '../lib/dates';
import type { CoachReport } from '../types';
import { createClient, FALLBACK_BETA, MODEL, RefusalError, textOf } from './client';
import { buildSnapshot, loadAppData } from './context';

const COACH_SYSTEM = `Du bist ein erfahrener Kraftsport-Coach und Ernährungsberater. Du bekommst die Daten eines Nutzers aus seiner Tracking-App (Training, Ernährung, Schlaf, Gewicht, Ziele) inklusive der automatischen Auswertung der App. Schreibe eine persönliche Analyse auf Deutsch in der Du-Form, als Markdown mit genau diesen Abschnitten:

## Kurzfazit
2–3 Sätze: Wo steht der Nutzer in Bezug auf sein Ziel?

## Bewertung
Je ein kurzer Absatz zu Training (Fortschritt der wichtigsten Übungen), Ernährung (Kalorien und Makros im Vergleich zum Ziel), Schlaf und Gewichtsverlauf – jeweils beginnend mit **Im Ziel**, **Abweichung** oder **Deutliche Abweichung**. Keine Emojis.

## Was du ändern solltest
Die 3–5 wichtigsten konkreten Änderungen, nach Wirkung sortiert und mit Zahlen (z. B. „+40 g Protein pro Tag“, „Kalorienziel auf 2.350 kcal senken“, „30 Minuten früher ins Bett“).

## Zusammenhänge
Was die Daten über den Einfluss von Schlaf und Ernährung auf die Trainingsleistung zeigen. Wenn die Datenlage dafür zu dünn ist, sag das in einem Satz.

## Plan für die nächste Woche
Eine kurze, umsetzbare Checkliste.

Sei ehrlich: Wenn Daten fehlen, sag, was eingetragen werden sollte. Erfinde keine Zahlen. Keine medizinischen Diagnosen.`;

/** Erstellt eine ausführliche KI-Analyse aller Daten im Vergleich zu den Zielen. */
export async function generateCoachReport(
  apiKey: string,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<CoachReport> {
  const data = await loadAppData();
  const snapshot = buildSnapshot(data, today());
  const client = createClient(apiKey);
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      system: COACH_SYSTEM,
      output_config: { effort: 'medium' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      messages: [{ role: 'user', content: `${snapshot}\n\nBitte erstelle meine Analyse.` }],
    },
    { signal },
  );
  let text = '';
  stream.on('text', (delta) => {
    text += delta;
    onText(text);
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new RefusalError();
  const report: CoachReport = { createdAt: Date.now(), text: textOf(message.content) };
  await setKV('coachReport', report);
  return report;
}
