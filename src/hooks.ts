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

export type Tab = 'heute' | 'training' | 'essen' | 'schlaf' | 'ziele' | 'coach' | 'einstellungen';
const TABS: Tab[] = ['heute', 'training', 'essen', 'schlaf', 'ziele', 'coach', 'einstellungen'];

function readHash(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '') as Tab;
  return TABS.includes(h) ? h : 'heute';
}

export function navigate(tab: Tab) {
  window.location.hash = `/${tab}`;
}

export function useRoute(): Tab {
  const [tab, setTab] = useState<Tab>(readHash);
  useEffect(() => {
    const on = () => {
      setTab(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tab;
}
