import { describe, expect, it } from 'vitest';
import { AUTO_PAUSE_MS, currentSpeed, initialTracker, liveLaps, trackerReducer, type GpsFix, type TrackerState } from './tracker';

const T0 = 1_700_000_000_000;
const STEP_LAT = 1 / 111_195; // 1 m nach Norden

function run(state: TrackerState, fixes: GpsFix[], tick = true): TrackerState {
  let s = state;
  for (const f of fixes) {
    if (tick) s = trackerReducer(s, { type: 'tick', now: f.t });
    s = trackerReducer(s, { type: 'fix', fix: f });
  }
  return s;
}

/** Bewegung mit `speed` m/s für `sec` Sekunden, 1 Fix pro Sekunde. */
function move(fromM: number, t0: number, sec: number, speed: number, accuracy = 5): GpsFix[] {
  return Array.from({ length: sec }, (_, i) => ({
    lat: 52.5 + (fromM + (i + 1) * speed) * STEP_LAT,
    lon: 13.4,
    t: t0 + (i + 1) * 1000,
    accuracy,
  }));
}

describe('Live-Tracker', () => {
  it('zeichnet Strecke und Bewegungszeit auf', () => {
    let s = trackerReducer(initialTracker('laufen'), { type: 'start', now: T0 });
    s = run(s, [{ lat: 52.5, lon: 13.4, t: T0, accuracy: 5 }, ...move(0, T0, 300, 3.33)]);
    expect(s.distanceM).toBeGreaterThan(990);
    expect(s.distanceM).toBeLessThan(1010);
    expect(s.movingMs).toBe(300_000);
    expect(currentSpeed(s)).toBeCloseTo(3.33, 1);
    expect(liveLaps(s)).toHaveLength(0);
  });

  it('verwirft ungenaue Signale und GPS-Sprünge', () => {
    let s = trackerReducer(initialTracker('laufen'), { type: 'start', now: T0 });
    s = run(s, [
      { lat: 52.5, lon: 13.4, t: T0, accuracy: 5 },
      { lat: 52.5 + 10 * STEP_LAT, lon: 13.4, t: T0 + 3000, accuracy: 80 }, // zu ungenau
      { lat: 52.5 + 500 * STEP_LAT, lon: 13.4, t: T0 + 4000, accuracy: 5 }, // 500 m in 4 s
      { lat: 52.5 + 12 * STEP_LAT, lon: 13.4, t: T0 + 5000, accuracy: 5 },
    ]);
    expect(s.points).toHaveLength(2);
    expect(s.distanceM).toBeCloseTo(12, 0);
  });

  it('ignoriert Zittern im Stand und pausiert automatisch', () => {
    let s = trackerReducer(initialTracker('laufen'), { type: 'start', now: T0 });
    s = run(s, [{ lat: 52.5, lon: 13.4, t: T0, accuracy: 5 }, ...move(0, T0, 60, 3)]);
    const movedAt = T0 + 60_000;
    // 60 s an der Ampel mit ±1 m Rauschen
    const jitter = Array.from({ length: 60 }, (_, i) => ({
      lat: 52.5 + (180 + (i % 2)) * STEP_LAT,
      lon: 13.4,
      t: movedAt + (i + 1) * 1000,
      accuracy: 8,
    }));
    s = run(s, jitter);
    expect(s.autoPaused).toBe(true);
    expect(s.distanceM).toBeCloseTo(180, -1);
    // Die Stehzeit zählt nicht als Bewegungszeit
    expect(s.movingMs).toBeLessThanOrEqual(60_000 + 1000);
    // Weiterlaufen beendet die Auto-Pause
    s = run(s, move(181, movedAt + 60_000, 30, 3));
    expect(s.autoPaused).toBe(false);
    expect(s.distanceM).toBeGreaterThan(250);
    expect(s.movingMs).toBeGreaterThan(80_000);
    expect(s.movingMs).toBeLessThan(95_000);
    expect(AUTO_PAUSE_MS).toBeGreaterThan(5000);
  });

  it('zählt manuelle Pausen nicht mit und beginnt danach einen neuen Abschnitt', () => {
    let s = trackerReducer(initialTracker('radfahren'), { type: 'start', now: T0 });
    s = run(s, [{ lat: 52.5, lon: 13.4, t: T0, accuracy: 5 }, ...move(0, T0, 100, 8)]);
    s = trackerReducer(s, { type: 'pause', now: T0 + 100_000 });
    // Während der Pause 1 km weiter „getragen“ (z. B. Zug) – zählt nicht
    s = run(s, move(1800, T0 + 200_000, 5, 8));
    s = trackerReducer(s, { type: 'resume', now: T0 + 300_000 });
    s = run(s, move(2000, T0 + 300_000, 100, 8));
    expect(s.segmentStarts).toEqual([0, 101]);
    expect(s.distanceM).toBeGreaterThan(1580);
    expect(s.distanceM).toBeLessThan(1610);
    expect(s.movingMs).toBeCloseTo(200_000, -3);
    // Runden ignorieren die Pausenzeit zwischen den Abschnitten
    const laps = liveLaps(s);
    expect(laps).toHaveLength(1);
    expect(laps[0].durationSec).toBeCloseTo(125, 0);
  });
});
