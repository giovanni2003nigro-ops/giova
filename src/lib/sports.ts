import type { Activity, Sport } from '../types';
import { fmt } from './stats';

export type PaceKind = 'min/km' | 'km/h' | 'min/100m' | 'min/500m';

export interface SportDef {
  key: Sport;
  label: string;
  emoji: string;
  /** Bezeichnung einer Einheit, z. B. „Lauf“ */
  noun: string;
  /** Live-Aufzeichnung per GPS sinnvoll */
  gps: boolean;
  /** Distanz ist die Hauptkennzahl */
  distance: boolean;
  pace: PaceKind | null;
  /** Metabolisches Äquivalent für die Kalorienschätzung */
  met: number;
}

export const SPORT_DEFS: Record<Sport, SportDef> = {
  laufen: { key: 'laufen', label: 'Laufen', emoji: '🏃', noun: 'Lauf', gps: true, distance: true, pace: 'min/km', met: 9.8 },
  radfahren: { key: 'radfahren', label: 'Radfahren', emoji: '🚴', noun: 'Radfahrt', gps: true, distance: true, pace: 'km/h', met: 8 },
  schwimmen: { key: 'schwimmen', label: 'Schwimmen', emoji: '🏊', noun: 'Schwimmeinheit', gps: false, distance: true, pace: 'min/100m', met: 7 },
  wandern: { key: 'wandern', label: 'Wandern', emoji: '🥾', noun: 'Wanderung', gps: true, distance: true, pace: 'min/km', met: 6 },
  rudern: { key: 'rudern', label: 'Rudern', emoji: '🚣', noun: 'Rudereinheit', gps: true, distance: true, pace: 'min/500m', met: 7 },
  hyrox: { key: 'hyrox', label: 'Hyrox', emoji: '🔥', noun: 'Hyrox-Einheit', gps: false, distance: false, pace: null, met: 9 },
  gym: { key: 'gym', label: 'Gym', emoji: '🏋️', noun: 'Krafttraining', gps: false, distance: false, pace: null, met: 5 },
  powerlifting: { key: 'powerlifting', label: 'Powerlifting', emoji: '🏋️‍♂️', noun: 'Powerlifting-Einheit', gps: false, distance: false, pace: null, met: 6 },
};

export const sportLabel = (s: Sport) => `${SPORT_DEFS[s].emoji} ${SPORT_DEFS[s].label}`;

/** "MM:SS" bzw. "H:MM:SS" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Dauer für Listen, z. B. "1 h 05 min" oder "42 min" */
export function formatDurationSec(sec: number): string {
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${fmt(m)} m`;
  return `${fmt(m / 1000, m < 100_000 ? 2 : 1)} km`;
}

/** Sekunden pro Einheit der Tempo-Angabe (z. B. s/km). */
export function paceSeconds(kind: PaceKind, distanceM: number, durationSec: number): number | null {
  if (distanceM <= 0 || durationSec <= 0) return null;
  switch (kind) {
    case 'min/km':
      return durationSec / (distanceM / 1000);
    case 'min/100m':
      return durationSec / (distanceM / 100);
    case 'min/500m':
      return durationSec / (distanceM / 500);
    case 'km/h':
      return null;
  }
}

/** Tempo passend zur Sportart: "5:12 /km", "27,4 km/h", "1:58 /100 m" */
export function formatPace(sport: Sport, distanceM: number | undefined, durationSec: number): string | null {
  const kind = SPORT_DEFS[sport].pace;
  if (!kind || !distanceM || distanceM <= 0 || durationSec <= 0) return null;
  if (kind === 'km/h') return `${fmt(distanceM / 1000 / (durationSec / 3600), 1)} km/h`;
  const s = paceSeconds(kind, distanceM, durationSec)!;
  if (!Number.isFinite(s) || s > 3600) return null;
  return `${formatClock(s)} /${kind.slice(4).replace('100m', '100 m').replace('500m', '500 m')}`;
}

export function paceLabel(sport: Sport): string {
  return SPORT_DEFS[sport].pace === 'km/h' ? 'Ø Tempo' : 'Ø Pace';
}

/**
 * Grobe Kalorienschätzung. Laufen/Gehen über die Distanz (≈ 1 bzw. 0,6 kcal pro kg und km),
 * sonst über MET × Gewicht × Stunden.
 */
export function estimateKcal(a: Pick<Activity, 'sport' | 'durationSec' | 'distanceM' | 'elevationGainM'>, weightKg: number): number {
  const km = (a.distanceM ?? 0) / 1000;
  if (a.sport === 'laufen' && km > 0) return Math.round(weightKg * km * 1.0);
  if (a.sport === 'wandern' && km > 0) return Math.round(weightKg * km * 0.6 + ((a.elevationGainM ?? 0) / 100) * weightKg * 0.1);
  return Math.round(SPORT_DEFS[a.sport].met * weightKg * (a.durationSec / 3600));
}

/** Parst "MM:SS", "H:MM:SS" oder Minuten als Zahl → Sekunden. */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function activityTitle(sport: Sport, startTime: number): string {
  const h = new Date(startTime).getHours();
  const part = h < 5 ? 'in der Nacht' : h < 11 ? 'am Morgen' : h < 14 ? 'am Mittag' : h < 18 ? 'am Nachmittag' : h < 22 ? 'am Abend' : 'in der Nacht';
  return `${SPORT_DEFS[sport].noun} ${part}`;
}

export function newUid(): string {
  return crypto.randomUUID();
}
