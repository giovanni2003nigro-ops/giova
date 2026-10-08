import type { Sport, TrackPoint } from '../types';
import { haversine } from './geo';

/**
 * Zustand der Live-Aufzeichnung. Die Logik ist rein (ohne Browser-APIs),
 * damit sie getestet werden kann; die Oberfläche füttert Positionen und Sekunden-Ticks.
 */
export interface TrackerState {
  status: 'idle' | 'running' | 'paused';
  sport: Sport;
  startTime: number | null;
  points: TrackPoint[];
  /** Index im Track, an dem nach einer Pause ein neuer Abschnitt beginnt */
  segmentStarts: number[];
  distanceM: number;
  /** Bewegungszeit in ms (ohne manuelle und automatische Pausen) */
  movingMs: number;
  lastTick: number | null;
  /** Zeitpunkt der letzten echten Bewegung */
  lastMove: number | null;
  autoPaused: boolean;
  autoPause: boolean;
  /** Genauigkeit des letzten GPS-Signals in m */
  accuracy: number | null;
  /** Neuer Abschnitt beginnt mit dem nächsten Punkt */
  newSegment: boolean;
  /** Zeit, in der die App im Hintergrund war (Handy gesperrt / andere App) – dort fehlt GPS */
  backgroundMs?: number;
}

export interface GpsFix {
  lat: number;
  lon: number;
  t: number;
  accuracy: number;
  ele?: number | null;
}

/** Signale, die ungenauer sind, werden verworfen (m). */
export const MAX_ACCURACY = 35;
/** Ohne Bewegung so lange → Auto-Pause (ms) */
export const AUTO_PAUSE_MS = 12_000;
/** Kam so lange kein Tick, war die App im Hintergrund (Browser hat sie angehalten) */
export const BACKGROUND_GAP_MS = 15_000;

/** Höchstgeschwindigkeit (m/s), darüber gilt ein Punkt als GPS-Sprung. */
const MAX_SPEED: Record<Sport, number> = {
  laufen: 11,
  wandern: 5,
  radfahren: 30,
  rudern: 8,
  schwimmen: 4,
  hyrox: 11,
  gym: 11,
  powerlifting: 11,
};

export function initialTracker(sport: Sport, autoPause = true): TrackerState {
  return {
    status: 'idle',
    sport,
    startTime: null,
    points: [],
    segmentStarts: [],
    distanceM: 0,
    movingMs: 0,
    lastTick: null,
    lastMove: null,
    autoPaused: false,
    autoPause,
    accuracy: null,
    newSegment: true,
    backgroundMs: 0,
  };
}

export type TrackerAction =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'fix'; fix: GpsFix }
  | { type: 'sport'; sport: Sport }
  | { type: 'autoPause'; enabled: boolean }
  | { type: 'restore'; state: TrackerState }
  | { type: 'reset' };

/** Zählt die Zeit seit dem letzten Tick, wenn gerade aufgezeichnet wird. */
function accrue(s: TrackerState, now: number): TrackerState {
  if (s.status !== 'running' || s.lastTick == null) return { ...s, lastTick: now };
  const dt = Math.max(0, now - s.lastTick);
  // Sehr große Lücken (z. B. Tab im Hintergrund eingefroren) nur zählen, wenn es Bewegung gab
  return { ...s, movingMs: s.autoPaused ? s.movingMs : s.movingMs + dt, lastTick: now };
}

export function trackerReducer(s: TrackerState, a: TrackerAction): TrackerState {
  switch (a.type) {
    case 'start':
      return { ...initialTracker(s.sport, s.autoPause), status: 'running', startTime: a.now, lastTick: a.now, lastMove: a.now };
    case 'pause':
      if (s.status !== 'running') return s;
      return { ...accrue(s, a.now), status: 'paused', newSegment: true };
    case 'resume':
      if (s.status !== 'paused') return s;
      return { ...s, status: 'running', lastTick: a.now, lastMove: a.now, autoPaused: false, newSegment: true };
    case 'tick': {
      // Zurück aus dem Hintergrund: Die Zeit lief weiter, nur GPS fehlte. Keine Auto-Pause auslösen –
      // der nächste GPS-Punkt verbindet die Lücke (Luftlinie).
      if (s.status === 'running' && !s.autoPaused && s.lastTick != null && a.now - s.lastTick > BACKGROUND_GAP_MS) {
        return { ...accrue(s, a.now), lastMove: a.now, backgroundMs: (s.backgroundMs ?? 0) + (a.now - s.lastTick) };
      }
      const next = accrue(s, a.now);
      if (next.status === 'running' && next.autoPause && !next.autoPaused && next.lastMove != null && a.now - next.lastMove > AUTO_PAUSE_MS) {
        // Die Stehzeit bis zur Erkennung wieder abziehen
        return { ...next, autoPaused: true, movingMs: Math.max(0, next.movingMs - (a.now - next.lastMove)), newSegment: true };
      }
      return next;
    }
    case 'fix': {
      const f = a.fix;
      let st: TrackerState = { ...s, accuracy: f.accuracy };
      if (st.status !== 'running' || f.accuracy > MAX_ACCURACY) return st;
      const point: TrackPoint = { lat: f.lat, lon: f.lon, t: f.t, ...(f.ele != null && Number.isFinite(f.ele) ? { ele: Math.round(f.ele) } : {}) };
      const last = st.points[st.points.length - 1];
      if (!last || st.newSegment) {
        const resumed = st.autoPaused;
        st = accrue(st, f.t);
        return {
          ...st,
          points: [...st.points, point],
          segmentStarts: [...st.segmentStarts, st.points.length],
          newSegment: false,
          // Beim ersten Punkt eines Abschnitts noch keine Strecke – Auto-Pause erst bei echter Bewegung beenden
          autoPaused: resumed,
          lastMove: resumed ? st.lastMove : f.t,
        };
      }
      const dt = (f.t - last.t) / 1000;
      if (dt <= 0) return st;
      const d = haversine(last, point);
      if (d / dt > MAX_SPEED[st.sport]) return st; // GPS-Sprung
      // Zittern im Stand ignorieren: Bewegung muss größer als die halbe Ungenauigkeit sein
      if (d < Math.max(3, Math.min(10, f.accuracy / 2))) return st;
      if (st.autoPaused) {
        // Weiter geht's: Tick-Zeit ab jetzt zählen, Strecke seit dem Stillstand nicht doppelt
        st = { ...st, autoPaused: false, lastTick: f.t };
      } else st = accrue(st, f.t);
      return { ...st, points: [...st.points, point], distanceM: st.distanceM + d, lastMove: f.t };
    }
    case 'sport':
      return { ...s, sport: a.sport };
    case 'autoPause':
      return { ...s, autoPause: a.enabled, autoPaused: a.enabled ? s.autoPaused : false };
    case 'restore':
      return a.state;
    case 'reset':
      return initialTracker(s.sport, s.autoPause);
  }
}

/** Aktuelles Tempo aus den letzten `windowSec` Sekunden (m/s) – glättet GPS-Schwankungen. */
export function currentSpeed(s: TrackerState, windowSec = 20): number | null {
  if (s.status !== 'running' || s.autoPaused || s.points.length < 2) return null;
  const last = s.points[s.points.length - 1];
  const segStart = s.segmentStarts[s.segmentStarts.length - 1] ?? 0;
  let d = 0;
  let i = s.points.length - 1;
  while (i > segStart && (last.t - s.points[i - 1].t) / 1000 <= windowSec) {
    d += haversine(s.points[i - 1], s.points[i]);
    i--;
  }
  const dt = (last.t - s.points[i].t) / 1000;
  if (dt < 5 || d <= 0) return null;
  return d / dt;
}

/** Zwischenzeiten je Kilometer auf Basis der Bewegung innerhalb der Abschnitte. */
export function liveLaps(s: TrackerState, lapM = 1000): { index: number; durationSec: number }[] {
  const laps: { index: number; durationSec: number }[] = [];
  let cum = 0;
  let next = lapM;
  let lapStartT = s.points[0]?.t ?? 0;
  const starts = new Set(s.segmentStarts);
  let pausedMs = 0;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    if (starts.has(i)) {
      // Pausenzeit zwischen zwei Abschnitten nicht in die Runde einrechnen
      pausedMs += b.t - a.t;
      continue;
    }
    const d = haversine(a, b);
    while (cum + d >= next) {
      const f = d > 0 ? (next - cum) / d : 1;
      const t = a.t + f * (b.t - a.t);
      laps.push({ index: laps.length + 1, durationSec: (t - lapStartT - pausedMs) / 1000 });
      lapStartT = t;
      pausedMs = 0;
      next += lapM;
    }
    cum += d;
  }
  return laps;
}
