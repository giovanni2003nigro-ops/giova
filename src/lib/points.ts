import type { Activity, Sport } from '../types';

/**
 * Punkte einer Aktivität für Rangliste und Liga.
 *
 * WICHTIG: Dieselbe Formel steckt in `supabase/migrations/…_platform.sql`
 * (Funktion `activity_points`). Änderungen immer an beiden Stellen machen –
 * die gemeinsamen Testfälle in `points.vectors.json` prüfen, dass beide gleich rechnen.
 */

/** Mehr als 6 Stunden pro Aktivität zählen nicht. */
export const MAX_COUNTED_SEC = 6 * 3600;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Kaufmännisch runden (wie `floor(x + 0.5)` in SQL) */
const r = (v: number) => Math.floor(v + 0.5);

export type PointsInput = Pick<Activity, 'sport' | 'durationSec' | 'distanceM' | 'elevationGainM'> & {
  hyrox?: { race?: boolean } | null;
};

/** Grenzen, ab denen eine Aktivität als unrealistisch gilt (dann 0 Punkte). */
export function isImplausible(a: PointsInput): boolean {
  const km = (a.distanceM ?? 0) / 1000;
  const sec = a.durationSec;
  if (sec <= 0) return true;
  if (sec > 24 * 3600) return true;
  if (km <= 0) return false;
  switch (a.sport) {
    case 'laufen':
      return km >= 1 && sec / km < 150; // schneller als 2:30 /km
    case 'wandern':
      return km / (sec / 3600) > 12;
    case 'radfahren':
      return km / (sec / 3600) > 60;
    case 'schwimmen':
      return sec / (km * 10) < 55; // schneller als 0:55 /100 m
    case 'rudern':
      return sec / (km * 2) < 80; // schneller als 1:20 /500 m
    default:
      return false;
  }
}

export function activityPoints(a: PointsInput): number {
  if (isImplausible(a)) return 0;
  const sec = Math.min(a.durationSec, MAX_COUNTED_SEC);
  // Distanz im selben Verhältnis kappen wie die Zeit
  const km = ((a.distanceM ?? 0) / 1000) * (sec / a.durationSec);
  const min = sec / 60;
  const byTime = (perMin: number) => r(min * perMin);
  switch (a.sport) {
    case 'laufen': {
      if (km <= 0) return byTime(1);
      const pace = sec / km; // s/km
      return r(km * 10 * clamp(360 / pace, 0.7, 1.5));
    }
    case 'radfahren': {
      if (km <= 0) return byTime(1);
      const kmh = km / (sec / 3600);
      return r(km * 2.5 * clamp(kmh / 25, 0.7, 1.5));
    }
    case 'schwimmen': {
      if (km <= 0) return byTime(1);
      const pace100 = sec / (km * 10);
      return r(km * 40 * clamp(150 / pace100, 0.7, 1.5));
    }
    case 'wandern':
      if (km <= 0) return byTime(0.5);
      return r(km * 5 + (a.elevationGainM ?? 0) / 10);
    case 'rudern': {
      if (km <= 0) return byTime(1);
      const pace500 = sec / (km * 2);
      return r(km * 8 * clamp(150 / pace500, 0.7, 1.5));
    }
    case 'hyrox':
      return r(min * 2 * (a.hyrox?.race ? 1.5 : 1));
    case 'gym':
      return r(Math.min(min, 150) * 1.5);
    case 'powerlifting':
      return r(Math.min(min, 180) * 1.5);
  }
}

/** Kurze Erklärung der Punkteformel für die Oberfläche. */
export const POINTS_RULES: Record<Sport, string> = {
  laufen: '10 Punkte pro km × Tempofaktor (6:00 /km = 1,0; schneller bis 1,5)',
  radfahren: '2,5 Punkte pro km × Tempofaktor (25 km/h = 1,0; schneller bis 1,5)',
  schwimmen: '40 Punkte pro km × Tempofaktor (2:30 /100 m = 1,0; schneller bis 1,5)',
  wandern: '5 Punkte pro km + 1 Punkt je 10 Höhenmeter',
  rudern: '8 Punkte pro km × Tempofaktor (2:30 /500 m = 1,0; schneller bis 1,5)',
  hyrox: '2 Punkte pro Minute, Wettkampf/Simulation × 1,5',
  gym: '1,5 Punkte pro Minute (max. 150 min)',
  powerlifting: '1,5 Punkte pro Minute (max. 180 min)',
};
