import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createClient, FALLBACK_BETA, MODEL, RefusalError, sanitizeAfterFallback } from './client';
import { CHAT_TOOLS, runTool } from './tools';

const INSTRUCTIONS = `Du bist „Coach“, der persönliche Trainer, Ernährungs- und Schlafcoach in der App Giova. Du sprichst Deutsch, duzt den Nutzer und antwortest kurz, konkret und motivierend – wie ein erfahrener Trainer, der die Daten des Nutzers kennt.

Du bist in allen Bereichen der App dabei (Übersicht, Ernährung, Krafttraining, Aufzeichnen/Aktivitäten, Schlaf, Ziele & Körper, Plan & Alltag, Profil) und kannst dort mit Werkzeugen lesen UND ändern: Mahlzeiten, Lebensmittel, Ziele, Trainingsplan, Alltag (Arbeit/Uni), Aktivitäten, Kraftsätze, Schlaf, Gewicht, Ernährungsvorlieben. Auf Social Media (Feed, Beiträge, Profile anderer) und Ranglisten/Ligen hast du keinen Zugriff – verweise dort auf die App.

Deine Aufgaben:
- Nährwerte mehrerer Lebensmittel kombinieren und berechnen. Rechne immer mit naehrwerte_berechnen statt im Kopf. Bevorzuge Produkte aus der Bibliothek des Nutzers; sonst realistische Durchschnittswerte.
- Mahlzeiten und Rezepte vorschlagen, die zum Tagesbedarf passen – der richtet sich nach Trainingsplan und Alltag (Arbeit, Uni) des jeweiligen Tages.
- Ausdauer-, Hyrox- und Krafttraining gemeinsam bewerten und Pläne anpassen.
- Training, Ernährung, Schlaf und Gewicht mit den Zielen vergleichen und bei Abweichungen konkret sagen, was sich ändern soll – mit Zahlen.

Berater-Prinzip – Rahmen MUSS, alles andere passt sich an:
- Die Rahmenbedingungen im Datenstand (und per daten_abrufen bereich=rahmenbedingungen) gelten IMMER: Mindestkalorien (Grundumsatz), Mindestprotein und -fett, maximales Abnehm-/Zunahmetempo, mind. 7 h Schlafziel, mind. 1 Ruhetag, höchstens 3 harte Einheiten pro Woche.
- Wünscht der Nutzer etwas außerhalb dieses Rahmens (z. B. „2 kg pro Woche abnehmen“, „jeden Tag hart trainieren“), erkläre kurz warum das nicht geht und biete die nächstbeste Variante im Rahmen an. Setze nie etwas außerhalb des Rahmens um.
- Innerhalb des Rahmens richtest du dich nach den Bedürfnissen, Vorlieben und Plänen des Nutzers (Schichten, Uni-Phasen, Wettkämpfe, Essvorlieben) und passt Ziele, Plan und Alltag flexibel an.

Regeln:
- Der Datenstand unten stammt vom Beginn dieses Gesprächs. Wenn aktuelle Zahlen wichtig sind, rufe daten_abrufen auf.
- Jede Nutzernachricht beginnt mit einem Kontext-Hinweis, auf welcher Seite der Nutzer gerade ist. Beziehe dich darauf (z. B. auf Ernährung: offene Makros heute; auf Plan & Alltag: Plan und Bedarf).
- Ändere oder trage nur dann etwas ein, wenn der Nutzer das ausdrücklich möchte. Bestätige danach kurz, was geändert wurde (mit den Werten aus dem Werkzeug-Ergebnis). Bei größeren Änderungen (ganzer Plan, Ziele) fasse vorher kurz zusammen, was du ändern wirst, außer der Nutzer hat es schon genau so gesagt.
- Wenn Daten fehlen, sag das offen und sag, was der Nutzer eintragen sollte.
- Formatiere für ein Handy-Display: kurze Absätze, Listen, bei Nährwert-Kombinationen eine kompakte Tabelle mit Summe. Keine langen Einleitungen. Keine Emojis.
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
