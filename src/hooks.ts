import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadAppData, type AppData } from './ai/context';
import { useKV } from './db';
import { analyze, type AnalysisResult } from './lib/analysis';
import { today } from './lib/dates';

// Ein gemeinsames Abo für alle Komponenten: Kopfzeile (!) und Seite laden die Daten nicht doppelt
const appStore: { data?: AppData; sub?: { unsubscribe(): void }; listeners: Set<() => void> } = { listeners: new Set() };

function subscribeAppData(onChange: () => void) {
  appStore.listeners.add(onChange);
  if (!appStore.sub)
    appStore.sub = liveQuery(loadAppData).subscribe({
      next: (d) => {
        appStore.data = d;
        appStore.listeners.forEach((l) => l());
      },
      error: (err) => console.error(err),
    });
  return () => {
    appStore.listeners.delete(onChange);
    if (appStore.listeners.size === 0) {
      appStore.sub?.unsubscribe();
      appStore.sub = undefined;
    }
  };
}

/** Alle Daten der App – aktualisiert sich automatisch bei Änderungen. */
export function useAppData(): AppData | undefined {
  return useSyncExternalStore(subscribeAppData, () => appStore.data);
}

// Auswertung pro Datenstand nur einmal berechnen, egal wie viele Komponenten sie brauchen
const analysisCache = new WeakMap<AppData, { t: string; result: AnalysisResult }>();

export function useAnalysis(data: AppData | undefined): AnalysisResult | undefined {
  const t = useToday();
  return useMemo(() => {
    if (!data) return undefined;
    const hit = analysisCache.get(data);
    if (hit?.t === t) return hit.result;
    const result = analyze({ today: t, ...data });
    analysisCache.set(data, { t, result });
    return result;
  }, [data, t]);
}

export function useApiKey(): string | undefined {
  return useKV<string>('apiKey', '');
}

/** Aktuelles Datum, das sich um Mitternacht aktualisiert. */
export function useToday(): string {
  const [t, setT] = useState(today());
  useEffect(() => {
    const id = setInterval(() => setT(today()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** Temporäre URL für ein gespeichertes Foto. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

export type RouteName =
  | 'ich'
  | 'heute'
  | 'einheiten'
  | 'entwicklung'
  | 'analyse'
  | 'start'
  | 'feed'
  | 'aufzeichnen'
  | 'ligen'
  | 'essen'
  | 'profil'
  | 'training'
  | 'tracker'
  | 'import'
  | 'schlaf'
  | 'ziele'
  | 'coach'
  | 'einstellungen'
  | 'medaillen'
  | 'plan'
  | 'konto'
  | 'aktivitaet'
  | 'post'
  | 'athlet';

const ROUTES: RouteName[] = [
  'ich',
  'heute',
  'einheiten',
  'entwicklung',
  'analyse',
  'start',
  'feed',
  'aufzeichnen',
  'ligen',
  'essen',
  'profil',
  'training',
  'tracker',
  'import',
  'schlaf',
  'ziele',
  'coach',
  'einstellungen',
  'medaillen',
  'plan',
  'konto',
  'aktivitaet',
  'post',
  'athlet',
];

export interface Route {
  name: RouteName;
  /** Optionaler Parameter, z. B. die ID bei #/aktivitaet/12 */
  id?: string;
}


export function parseHash(hash: string): Route {
  const [name, ...rest] = hash.replace(/^#\/?/, '').split('/');
  if (!ROUTES.includes(name as RouteName)) return { name: 'ich' };
  const id = rest.join('/');
  return id ? { name: name as RouteName, id: decodeURIComponent(id) } : { name: name as RouteName };
}

/** Navigiert zu einer Seite, z. B. navigate('ligen') oder navigate('aktivitaet', 12). */
export function navigate(name: RouteName, id?: string | number) {
  window.location.hash = id != null ? `/${name}/${encodeURIComponent(String(id))}` : `/${name}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
