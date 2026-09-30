import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { loadAppData, type AppData } from './ai/context';
import { useKV } from './db';
import { analyze, type AnalysisResult } from './lib/analysis';
import { today } from './lib/dates';

/** Alle Daten der App – aktualisiert sich automatisch bei Änderungen. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(loadAppData, []);
}

export function useAnalysis(data: AppData | undefined): AnalysisResult | undefined {
  const t = useToday();
  return useMemo(() => (data ? analyze({ today: t, ...data }) : undefined), [data, t]);
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
  | 'heute'
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
  'heute',
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
  if (!ROUTES.includes(name as RouteName)) return { name: 'heute' };
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
