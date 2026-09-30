import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

/**
 * Community-Server (Supabase). Adresse und öffentlicher Schlüssel kommen aus dem Build
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) oder – zum Ausprobieren – aus den Einstellungen.
 * Ohne Server funktioniert die App weiter lokal; nur Feed, Ranglisten und Konto fehlen.
 */

interface CloudConfig {
  url: string;
  anonKey: string;
}

const CONFIG_KEY = 'cloudConfig';

export function readCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as CloudConfig;
      if (c.url && c.anonKey) return c;
    }
  } catch {
    /* privates Fenster */
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

/** Speichert eine eigene Server-Adresse (leer = Standard aus dem Build) und lädt neu. */
export function saveCloudConfig(c: CloudConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignorieren */
  }
  location.reload();
}

const config = readCloudConfig();

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey, {
      // PKCE: der Bestätigungslink kommt als ?code=… zurück und verträgt sich mit dem #/-Routing
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;

export const cloudEnabled = supabase != null;

let current: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();
let ready = !supabase;
/** Nutzer kam über „Passwort vergessen“ zurück und soll ein neues setzen. */
export let passwordRecovery = false;
export function clearPasswordRecovery() {
  passwordRecovery = false;
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    current = data.session;
    ready = true;
    listeners.forEach((l) => l(current));
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      passwordRecovery = true;
      window.location.hash = '/konto';
    }
    current = session;
    ready = true;
    listeners.forEach((l) => l(current));
  });
}

export function currentUserId(): string | null {
  return current?.user.id ?? null;
}

/** Aktuelle Anmeldung. `undefined` solange noch geladen wird. */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(ready ? current : undefined);
  useEffect(() => {
    const l = (x: Session | null) => setS(x);
    listeners.add(l);
    if (ready) setS(current);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return s;
}

export function requireCloud(): SupabaseClient {
  if (!supabase) throw new Error('Kein Community-Server eingerichtet.');
  return supabase;
}

/** Verständliche Fehlermeldungen von Supabase. */
export function cloudError(err: unknown): string {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/Email not confirmed/i.test(msg)) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link im Postfach).';
  if (/User already registered/i.test(msg)) return 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.';
  if (/Password should be at least/i.test(msg)) return 'Das Passwort muss mindestens 6 Zeichen lang sein.';
  if (/duplicate key.*username/i.test(msg)) return 'Dieser Nutzername ist schon vergeben.';
  if (/profiles_username_check/i.test(msg)) return 'Nutzername: 3–24 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt und Unterstrich.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Keine Verbindung zum Community-Server. Bist du online?';
  if (/rate limit/i.test(msg)) return 'Zu viele Versuche – bitte kurz warten.';
  return msg;
}
