import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../types';
import {
  decodePolyline,
  elevationGain,
  encodePolyline,
  geohash,
  geohashCenter,
  haversine,
  simplify,
  splits,
  trackStats,
  trimEnds,
} from './geo';
import { formatClock, formatDistance, formatPace, parseClock } from './sports';

/** Gerade Strecke nach Norden: `n` Punkte im Abstand von `stepM` Metern, alle `dt` Sekunden. */
export function straightTrack(n: number, stepM: number, dt: number, start = { lat: 52.52, lon: 13.405 }, t0 = 1_700_000_000_000): TrackPoint[] {
  const dLat = stepM / 111_195;
  return Array.from({ length: n }, (_, i) => ({ lat: start.lat + i * dLat, lon: start.lon, t: t0 + i * dt * 1000 }));
}

describe('geo', () => {
  it('berechnet Entfernungen (Haversine)', () => {
    // Berlin Alexanderplatz → Brandenburger Tor ≈ 2,9 km
    const d = haversine({ lat: 52.5219, lon: 13.4132 }, { lat: 52.5163, lon: 13.3777 });
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -2);
  });

  it('wertet einen Track aus und erkennt Pausen', () => {
    const track = straightTrack(101, 10, 3); // 1 km in 300 s
    // 2 Minuten Pause am Ende (gleicher Ort)
    const last = track[track.length - 1];
    track.push({ ...last, t: last.t + 120_000 });
    const s = trackStats(track);
    expect(s.distanceM).toBeGreaterThan(995);
    expect(s.distanceM).toBeLessThan(1005);
    expect(s.movingSec).toBe(300);
    expect(s.elapsedSec).toBe(420);
  });

  it('zählt Höhenmeter mit Hysterese', () => {
    const t = (ele: number, i: number): TrackPoint => ({ lat: 0, lon: 0, t: i, ele });
    // Rauschen ±1 m zählt nicht, echter Anstieg 10 m schon
    const noisy = [100, 101, 100, 101, 100, 102, 105, 108, 110, 109, 110].map(t);
    expect(elevationGain(noisy)).toBe(10);
  });

  it('berechnet Kilometer-Splits mit Interpolation', () => {
    // 2,5 km: erster km in 300 s, zweiter in 360 s, Rest 500 m in 150 s
    const a = straightTrack(101, 10, 3);
    const b = straightTrack(101, 10, 3.6, { lat: a[100].lat, lon: a[100].lon }, a[100].t).slice(1);
    const c = straightTrack(51, 10, 3, { lat: b[99].lat, lon: b[99].lon }, b[99].t).slice(1);
    const sp = splits([...a, ...b, ...c]);
    expect(sp).toHaveLength(3);
    expect(sp[0].durationSec).toBeCloseTo(300, 0);
    expect(sp[1].durationSec).toBeCloseTo(360, 0);
    expect(sp[2].distanceM).toBeGreaterThan(490);
    expect(sp[2].durationSec).toBeCloseTo(150, 0);
  });

  it('vereinfacht gerade Strecken auf Anfang und Ende', () => {
    const track = straightTrack(200, 5, 1);
    const s = simplify(track, 2);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual(track[0]);
  });

  it('blendet Start und Ziel aus', () => {
    const track = straightTrack(201, 10, 3); // 2 km
    const trimmed = trimEnds(track, 200);
    expect(haversine(track[0], trimmed[0])).toBeGreaterThanOrEqual(199);
    expect(haversine(track[track.length - 1], trimmed[trimmed.length - 1])).toBeGreaterThanOrEqual(199);
    expect(trimEnds(straightTrack(30, 10, 3))).toEqual([]); // zu kurz → nichts zeigen
  });

  it('kodiert Polylines verlustarm (Google-Format)', () => {
    // Beispiel aus der Google-Dokumentation
    const pts = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    const enc = encodePolyline(pts);
    expect(enc).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(enc)).toEqual(pts.map((p) => [p.lat, p.lon]));
  });

  it('berechnet Geohashes', () => {
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    const berlin = geohash(52.52, 13.405, 4);
    const potsdam = geohash(52.39, 13.06, 4);
    expect(berlin.slice(0, 3)).toBe(potsdam.slice(0, 3));
    const c = geohashCenter(geohash(52.52, 13.405, 6));
    expect(haversine(c, { lat: 52.52, lon: 13.405 })).toBeLessThan(1000);
  });
});

describe('sports', () => {
  it('formatiert Zeiten, Distanzen und Tempo', () => {
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(10_234)).toBe('10,23 km');
    expect(formatPace('laufen', 10_000, 3000)).toBe('5:00 /km');
    expect(formatPace('radfahren', 30_000, 3600)).toBe('30 km/h');
    expect(formatPace('schwimmen', 1500, 1800)).toBe('2:00 /100 m');
    expect(formatPace('rudern', 2000, 480)).toBe('2:00 /500 m');
    expect(formatPace('gym', 0, 3600)).toBeNull();
  });
  it('liest Zeiteingaben', () => {
    expect(parseClock('45')).toBe(2700);
    expect(parseClock('5:30')).toBe(330);
    expect(parseClock('1:05:00')).toBe(3900);
    expect(parseClock('abc')).toBeNull();
  });
});
