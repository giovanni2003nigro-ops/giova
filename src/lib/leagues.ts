import type { Activity, ISODate, Sport } from '../types';
import { addDays, parseISODate, toISODate } from './dates';
import { formatClock } from './sports';
import { fmt } from './stats';

/**
 * Ligen: Pro Sportart gibt es sechs Stufen. Man steigt auf, wenn man in seiner
 * Gruppe (ähnliches Niveau, in der Nähe) oben landet ODER eine Leistungsschwelle
 * (Umfang wie km/Monat bzw. Tempo) der nächsten Liga erreicht.
 *
 * WICHTIG: Schwellen und Auf-/Abstiegsregeln sind in
 * `supabase/migrations/…_platform.sql` gespiegelt (Tabelle `league_rules`,
 * Funktion `close_season`). Änderungen an beiden Stellen machen.
 */

export interface Tier {
  index: number;
  key: string;
  label: string;
  color: string;
}

export const TIERS: Tier[] = [
  { index: 0, key: 'bronze', label: 'Bronze', color: '#b0772f' },
  { index: 1, key: 'silber', label: 'Silber', color: '#8d949c' },
  { index: 2, key: 'gold', label: 'Gold', color: '#d4a017' },
  { index: 3, key: 'platin', label: 'Platin', color: '#2b9fa8' },
  { index: 4, key: 'diamant', label: 'Diamant', color: '#3d7be0' },
  { index: 5, key: 'elite', label: 'Elite', color: '#8a4fd8' },
];
export const MAX_TIER = TIERS.length - 1;

export type Metric = 'km' | 'hours' | 'sessions' | 'pace_km' | 'pace_100m' | 'pace_500m' | 'kmh' | 'elevation' | 'race_time' | 'dots';

export interface MetricRule {
  metric: Metric;
  label: string;
  /** Schwellen für Silber, Gold, Platin, Diamant, Elite (5 Werte) */
  thresholds: number[];
  lowerIsBetter: boolean;
}

export interface LeagueRule {
  sport: Sport;
  /** Betrachteter Zeitraum für den Umfang in Tagen */
  windowDays: number;
  volume: MetricRule;
  /** Alternative Leistungsschwelle (Tempo etc.), braucht einen Mindestumfang */
  intensity?: MetricRule & { minVolume: number; windowDays: number };
}

export const LEAGUE_RULES: Record<Sport, LeagueRule> = {
  laufen: {
    sport: 'laufen',
    windowDays: 30,
    volume: { metric: 'km', label: 'km in 30 Tagen', thresholds: [30, 60, 100, 160, 240], lowerIsBetter: false },
    intensity: { metric: 'pace_km', label: 'Ø Pace', thresholds: [390, 345, 300, 260, 225], lowerIsBetter: true, minVolume: 20, windowDays: 30 },
  },
  radfahren: {
    sport: 'radfahren',
    windowDays: 30,
    volume: { metric: 'km', label: 'km in 30 Tagen', thresholds: [150, 300, 500, 800, 1200], lowerIsBetter: false },
    intensity: { metric: 'kmh', label: 'Ø Tempo', thresholds: [22, 25, 28, 31, 34], lowerIsBetter: false, minVolume: 100, windowDays: 30 },
  },
  schwimmen: {
    sport: 'schwimmen',
    windowDays: 30,
    volume: { metric: 'km', label: 'km in 30 Tagen', thresholds: [5, 10, 18, 28, 40], lowerIsBetter: false },
    intensity: { metric: 'pace_100m', label: 'Ø Pace', thresholds: [150, 130, 115, 100, 85], lowerIsBetter: true, minVolume: 3, windowDays: 30 },
  },
  wandern: {
    sport: 'wandern',
    windowDays: 30,
    volume: { metric: 'km', label: 'km in 30 Tagen', thresholds: [20, 40, 70, 100, 150], lowerIsBetter: false },
    intensity: { metric: 'elevation', label: 'Höhenmeter', thresholds: [1000, 2500, 4000, 6000, 9000], lowerIsBetter: false, minVolume: 0, windowDays: 30 },
  },
  rudern: {
    sport: 'rudern',
    windowDays: 30,
    volume: { metric: 'km', label: 'km in 30 Tagen', thresholds: [20, 50, 90, 140, 200], lowerIsBetter: false },
    intensity: { metric: 'pace_500m', label: 'Ø Pace', thresholds: [160, 145, 130, 118, 108], lowerIsBetter: true, minVolume: 10, windowDays: 30 },
  },
  hyrox: {
    sport: 'hyrox',
    windowDays: 30,
    volume: { metric: 'hours', label: 'Stunden in 30 Tagen', thresholds: [6, 12, 18, 25, 35], lowerIsBetter: false },
    intensity: { metric: 'race_time', label: 'Bestzeit Wettkampf', thresholds: [6300, 5700, 5100, 4500, 3900], lowerIsBetter: true, minVolume: 0, windowDays: 365 },
  },
  gym: {
    sport: 'gym',
    windowDays: 30,
    volume: { metric: 'sessions', label: 'Einheiten in 30 Tagen', thresholds: [6, 10, 14, 18, 22], lowerIsBetter: false },
  },
  powerlifting: {
    sport: 'powerlifting',
    windowDays: 30,
    volume: { metric: 'sessions', label: 'Einheiten in 30 Tagen', thresholds: [4, 8, 12, 16, 20], lowerIsBetter: false },
    intensity: { metric: 'dots', label: 'DOTS-Punkte', thresholds: [200, 270, 330, 390, 450], lowerIsBetter: false, minVolume: 0, windowDays: 90 },
  },
};

export function formatMetric(metric: Metric, v: number): string {
  switch (metric) {
    case 'km':
      return `${fmt(v, v < 10 ? 1 : 0)} km`;
    case 'hours':
      return `${fmt(v, 1)} h`;
    case 'sessions':
      return `${fmt(v)} Einheiten`;
    case 'pace_km':
      return `${formatClock(v)} /km`;
    case 'pace_100m':
      return `${formatClock(v)} /100 m`;
    case 'pace_500m':
      return `${formatClock(v)} /500 m`;
    case 'kmh':
      return `${fmt(v, 1)} km/h`;
    case 'elevation':
      return `${fmt(v)} Hm`;
    case 'race_time':
      return formatClock(v);
    case 'dots':
      return `${fmt(v, 1)} DOTS`;
  }
}

// ------------------------------------------------------------------ DOTS (Powerlifting)

const DOTS_COEF = {
  m: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093],
  w: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706],
};

/** DOTS-Wert: Kraft relativ zum Körpergewicht, vergleichbar über Gewichtsklassen hinweg. */
export function dots(totalKg: number, bodyweightKg: number, sex: 'm' | 'w'): number {
  if (totalKg <= 0 || bodyweightKg <= 0) return 0;
  const bw = Math.min(sex === 'm' ? 210 : 150, Math.max(40, bodyweightKg));
  const [a, b, c, d, e] = DOTS_COEF[sex];
  const denom = a + b * bw + c * bw ** 2 + d * bw ** 3 + e * bw ** 4;
  return (totalKg * 500) / denom;
}

// ------------------------------------------------------------------ Leistung & Stufe

export interface SportPerformance {
  sport: Sport;
  activities: number;
  volume: number;
  intensity: number | null;
  /** Stufe, für die die Leistung reicht */
  tier: number;
  /** Fortschritt zur nächsten Stufe (0–1), null wenn Elite */
  nextVolumeProgress: number | null;
  nextIntensityProgress: number | null;
}

function inWindow(a: Activity, today: ISODate, days: number) {
  return a.date > addDays(today, -days) && a.date <= today;
}

export interface PerformanceContext {
  sex: 'm' | 'w';
  bodyweight: number | null;
}

/** Umfang und Intensität einer Sportart im Betrachtungszeitraum. */
export function sportMetrics(sport: Sport, activities: Activity[], today: ISODate, ctx: PerformanceContext): { activities: number; volume: number; intensity: number | null; intensityVolume: number } {
  const rule = LEAGUE_RULES[sport];
  const list = activities.filter((a) => a.sport === sport && a.points > 0 && inWindow(a, today, rule.windowDays));
  const km = list.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000;
  const sec = list.reduce((s, a) => s + a.durationSec, 0);
  let volume: number;
  switch (rule.volume.metric) {
    case 'km':
      volume = km;
      break;
    case 'hours':
      volume = sec / 3600;
      break;
    default:
      volume = list.length;
  }
  const int = rule.intensity;
  let intensity: number | null = null;
  let intensityVolume = volume;
  if (int) {
    const iList = activities.filter((a) => a.sport === sport && a.points > 0 && inWindow(a, today, int.windowDays));
    const withDist = iList.filter((a) => (a.distanceM ?? 0) > 0);
    const dKm = withDist.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000;
    const dSec = withDist.reduce((s, a) => s + a.durationSec, 0);
    intensityVolume = int.windowDays === rule.windowDays ? volume : dKm;
    switch (int.metric) {
      case 'pace_km':
        intensity = dKm > 0 ? dSec / dKm : null;
        break;
      case 'pace_100m':
        intensity = dKm > 0 ? dSec / (dKm * 10) : null;
        break;
      case 'pace_500m':
        intensity = dKm > 0 ? dSec / (dKm * 2) : null;
        break;
      case 'kmh':
        intensity = dSec > 0 ? dKm / (dSec / 3600) : null;
        break;
      case 'elevation':
        intensity = iList.reduce((s, a) => s + (a.elevationGainM ?? 0), 0);
        break;
      case 'race_time': {
        const races = iList.filter((a) => a.hyrox?.race).map((a) => a.durationSec);
        intensity = races.length ? Math.min(...races) : null;
        break;
      }
      case 'dots': {
        const best = (k: 'squat' | 'bench' | 'deadlift') => Math.max(0, ...iList.map((a) => a.powerlifting?.[k] ?? 0));
        const total = best('squat') + best('bench') + best('deadlift');
        // Körpergewicht der letzten Einheit, sonst aus dem Profil
        const bw = [...iList].sort((a, b) => b.startTime - a.startTime).find((a) => a.powerlifting?.bodyweight)?.powerlifting?.bodyweight ?? ctx.bodyweight;
        // Nur mit allen drei Wettkampfübungen aussagekräftig
        intensity = bw && best('squat') && best('bench') && best('deadlift') ? dots(total, bw, ctx.sex) : null;
        break;
      }
      default:
        intensity = null;
    }
  }
  return { activities: list.length, volume, intensity, intensityVolume };
}

const meets = (rule: MetricRule, value: number | null, i: number) =>
  value != null && (rule.lowerIsBetter ? value <= rule.thresholds[i] : value >= rule.thresholds[i]);

/** Höchste Stufe, deren Schwelle (Umfang ODER Intensität mit Mindestumfang) erreicht ist. */
export function performanceTier(sport: Sport, volume: number, intensity: number | null, intensityVolume = volume): number {
  const rule = LEAGUE_RULES[sport];
  let tier = 0;
  for (let i = 0; i < rule.volume.thresholds.length; i++) {
    const byVolume = meets(rule.volume, volume, i);
    const byIntensity = !!rule.intensity && intensityVolume >= rule.intensity.minVolume && meets(rule.intensity, intensity, i);
    if (byVolume || byIntensity) tier = i + 1;
  }
  return tier;
}

function progressTo(rule: MetricRule, value: number | null, i: number): number | null {
  if (i >= rule.thresholds.length || value == null) return null;
  const target = rule.thresholds[i];
  if (rule.lowerIsBetter) return value <= target ? 1 : Math.max(0, Math.min(1, target / value));
  return Math.max(0, Math.min(1, value / target));
}

export function sportPerformance(sport: Sport, activities: Activity[], today: ISODate, ctx: PerformanceContext): SportPerformance {
  const m = sportMetrics(sport, activities, today, ctx);
  const tier = performanceTier(sport, m.volume, m.intensity, m.intensityVolume);
  const rule = LEAGUE_RULES[sport];
  return {
    sport,
    activities: m.activities,
    volume: m.volume,
    intensity: m.intensity,
    tier,
    nextVolumeProgress: progressTo(rule.volume, m.volume, tier),
    nextIntensityProgress: rule.intensity ? progressTo(rule.intensity, m.intensity, tier) : null,
  };
}

// ------------------------------------------------------------------ Saison

/** Saison = Kalendermonat, z. B. "2026-09" */
export function seasonOf(date: ISODate): string {
  return date.slice(0, 7);
}

export function seasonRange(season: string): { from: ISODate; to: ISODate } {
  const [y, m] = season.split('-').map(Number);
  return { from: `${season}-01`, to: toISODate(new Date(y, m, 0, 12)) };
}

export function seasonLabel(season: string): string {
  return parseISODate(`${season}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

export function daysLeftInSeason(today: ISODate): number {
  const { to } = seasonRange(seasonOf(today));
  return Math.round((parseISODate(to).getTime() - parseISODate(today).getTime()) / 86_400_000) + 1;
}

/** Größe der Auf- bzw. Abstiegszone. Kleine Gruppen (< 5) haben keine Zonen. */
export function zoneSize(groupSize: number): number {
  return groupSize >= 5 ? Math.max(1, Math.round(groupSize * 0.2)) : 0;
}

export type Outcome = 'auf' | 'ab' | 'bleibt';

export interface GroupMember {
  userId: string;
  points: number;
  tier: number;
  performanceTier: number;
}

export interface MemberResult {
  userId: string;
  rank: number;
  outcome: Outcome;
  newTier: number;
}

/**
 * Saisonabschluss einer Gruppe:
 * - Aufstieg: Aufstiegszone (Top 20 %, mit Punkten) ODER Leistungsschwelle einer höheren Liga erreicht.
 *   Wer die Schwelle mehrerer Ligen erreicht, springt direkt dorthin.
 * - Abstieg: Abstiegszone (unterste 20 %) und die Schwelle der eigenen Liga nicht gehalten,
 *   oder in der ganzen Saison keine Punkte.
 */
export function closeGroup(members: GroupMember[]): MemberResult[] {
  // Gleichstand: nach ID in Byte-Reihenfolge (wie `collate "C"` in SQL)
  const sorted = [...members].sort((a, b) => b.points - a.points || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const n = sorted.length;
  const zone = zoneSize(n);
  return sorted.map((m, i) => {
    const rank = i + 1;
    const promote = m.tier < MAX_TIER && ((rank <= zone && m.points > 0) || m.performanceTier > m.tier);
    const relegate = !promote && m.tier > 0 && ((rank > n - zone && m.performanceTier < m.tier) || m.points <= 0);
    const newTier = promote ? Math.min(MAX_TIER, Math.max(m.tier + 1, m.performanceTier)) : relegate ? m.tier - 1 : m.tier;
    return { userId: m.userId, rank, outcome: promote ? 'auf' : relegate ? 'ab' : 'bleibt', newTier };
  });
}

/** Punkte einer Saison in einer Sportart (Aktivitäten + Medaillen dieser Sportart + allgemeine Medaillen). */
export function seasonPoints(
  sport: Sport,
  season: string,
  activities: Activity[],
  medals: { period: string; date: ISODate; points: number; sport?: Sport }[],
): number {
  const { from, to } = seasonRange(season);
  const act = activities.filter((a) => a.sport === sport && a.date >= from && a.date <= to).reduce((s, a) => s + a.points, 0);
  const med = medals.filter((m) => m.date >= from && m.date <= to && (!m.sport || m.sport === sport)).reduce((s, m) => s + m.points, 0);
  return act + med;
}
