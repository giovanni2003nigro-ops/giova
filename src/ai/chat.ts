import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createClient, FALLBACK_BETA, MODEL, RefusalError, sanitizeAfterFallback } from './client';
import { CHAT_TOOLS, runTool } from './tools';

const INSTRUCTIONS = `Du bist „Coach“, der persönliche Fitness-, Ernährungs- und Schlafcoach in der App Giova Fit. Du sprichst Deutsch, duzt den Nutzer und antwortest kurz, konkret und motivierend – wie ein erfahrener Trainer, der die Daten des Nutzers kennt.

Deine Aufgaben:
- Nährwerte mehrerer Lebensmittel kombinieren und berechnen (z. B. „200 g Haferflocken + 300 ml Milch + 30 g Whey“). Rechne dafür immer mit dem Werkzeug naehrwerte_berechnen statt im Kopf. Bevorzuge Produkte aus der Bibliothek des Nutzers; für andere Lebensmittel nimm realistische Durchschnittswerte (übliche deutsche Nährwertangaben).
- Mahlzeiten vorschlagen, die zu den heute noch offenen Makros passen – und zum Tagesbedarf, der sich nach Trainingsplan und Alltag (Arbeit, Uni) richtet.
- Ausdauer- und Hyrox-Einheiten (Pace, Umfang, Belastung) und Krafttraining gemeinsam bewerten.
- Training, Ernährung, Schlaf und Gewicht mit den Zielen vergleichen und bei Abweichungen konkret sagen, was geändert werden soll – mit Zahlen (kcal, Gramm, Stunden, kg, Sätze/Wiederholungen).
- Fragen zu Training, Technik, Progression und Regeneration beantworten.

Regeln:
- Der Datenstand unten stammt vom Beginn dieses Gesprächs. Wenn aktuelle Zahlen wichtig sind (z. B. was heute schon gegessen wurde), rufe daten_abrufen auf.
- Trage nur dann etwas ins Tagebuch ein oder speichere ein Lebensmittel, wenn der Nutzer das ausdrücklich möchte. Bestätige danach kurz, was eingetragen wurde.
- Wenn Daten fehlen, sag das offen, statt zu raten, und sag, was der Nutzer eintragen sollte.
- Formatiere für ein Handy-Display: kurze Absätze, Listen, bei Nährwert-Kombinationen eine kompakte Tabelle mit Summe. Keine langen Einleitungen.
- Keine medizinischen Diagnosen. Bei Schmerzen, Verletzungen oder Anzeichen einer Essstörung empfiehl ärztlichen Rat.`;

/** Systemprompt mit eingefrorenem Datenstand – bleibt für das ganze Gespräch identisch. */
export function buildSystemPrompt(snapshot: string): string {
  return `${INSTRUCTIONS}\n\n# Datenstand bei Gesprächsbeginn\n\n${snapshot}`;
}

export interface ChatTurnOptions {
  apiKey: string;
  system: string;
  messages: BetaMessageParam[];
  signal?: AbortSignal;
  /** Gesamter bisher gestreamter Text des aktuellen Schritts */
  onText: (text: string) => void;
  onTool: (name: string) => void;
  /** Wird nach jedem abgeschlossenen Schritt mit dem vollständigen Verlauf aufgerufen */
  onPersist: (messages: BetaMessageParam[]) => Promise<void>;
}

const MAX_STEPS = 10;

/**
 * Führt eine Chat-Runde aus: streamt die Antwort, führt angeforderte Werkzeuge aus
 * und wiederholt, bis Claude fertig ist. Der Verlauf wird nur angehängt, nie verändert.
 */
export async function runChatTurn(opts: ChatTurnOptions): Promise<BetaMessageParam[]> {
  const client = createClient(opts.apiKey);
  const history = [...opts.messages];
  let jsonRetries = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    opts.onText('');
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system: opts.system,
        tools: CHAT_TOOLS,
        messages: history,
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      { signal: opts.signal },
    );
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      opts.onText(text);
    });

    let message: BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Nur unlesbare Werkzeug-Eingaben (JSON) erneut anfragen – API-Fehler weiterreichen
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') throw new RefusalError();
    const content = sanitizeAfterFallback(message.content);
    const toolUses = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' && toolUses.length)
      throw new Error('Die Antwort wurde abgeschnitten. Bitte stelle die Frage etwas kleiner.');

    history.push({ role: 'assistant', content });
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      await opts.onPersist(history);
      return history;
    }

    for (const t of toolUses) opts.onTool(t.name);
    const results = await Promise.all(toolUses.map(runTool));
    history.push({ role: 'user', content: results });
    await opts.onPersist(history);
  }
  throw new Error('Zu viele Zwischenschritte – bitte formuliere die Frage einfacher.');
}
