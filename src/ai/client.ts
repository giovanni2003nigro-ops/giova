import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** Modell für Chatbot, Coach-Analyse und Foto-Auslesen */
export const MODEL = 'claude-sonnet-5-5';

/**
 * Serverseitiger Fallback: Lehnt Sonnet 5.5 eine Anfrage aus Sicherheitsgründen ab,
 * versucht die API sie automatisch mit einem passenden Ersatzmodell erneut.
 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01' as const;

export function createClient(apiKey: string): Anthropic {
  // Die App läuft komplett im Browser; der Schlüssel liegt nur lokal auf dem Gerät.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export class RefusalError extends Error {
  constructor() {
    super('Claude hat diese Anfrage abgelehnt. Formuliere sie bitte etwas anders.');
    this.name = 'RefusalError';
  }
}

/** Verständliche deutsche Fehlermeldungen für die Oberfläche. */
export function errorMessage(err: unknown): string {
  if (err instanceof RefusalError) return err.message;
  if (err instanceof Anthropic.APIUserAbortError) return 'Abgebrochen.';
  if (err instanceof Anthropic.AuthenticationError)
    return 'Der API-Schlüssel ist ungültig. Bitte prüfe ihn in den Einstellungen (⚙︎).';
  if (err instanceof Anthropic.PermissionDeniedError)
    return 'Kein Zugriff mit diesem API-Schlüssel (fehlende Berechtigung oder Guthaben).';
  if (err instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen – bitte einen Moment warten und erneut versuchen.';
  if (err instanceof Anthropic.BadRequestError) return `Anfrage abgelehnt: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return 'Claude ist gerade überlastet. Bitte gleich nochmal versuchen.';
  if (err instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zur Claude-API. Bist du online?';
  if (err instanceof Anthropic.APIError) return `API-Fehler ${err.status ?? ''}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Nach einem Fallback-Wechsel mitten in der Antwort dürfen thinking- und tool_use-Blöcke
 * vor dem letzten `fallback`-Block nicht zurückgeschickt werden.
 */
export function sanitizeAfterFallback(content: BetaContentBlock[]): BetaContentBlock[] {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i;
  });
  if (last < 0) return content;
  return content.filter(
    (b, i) => i > last || !(b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use'),
  );
}

export function textOf(content: BetaContentBlock[]): string {
  return content
    .filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
