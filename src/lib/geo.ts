import type { TrackPoint } from '../types';

const R = 6_371_000; // Erdradius in m
const rad = (d: number) => (d * Math.PI) / 180;

/** Entfernung zweier Koordinaten in Metern (Haversine). */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kumulierte Distanz je Punkt (Index i = Strecke vom Start bis Punkt i). */
export function cumulativeDistance(track: TrackPoint[]): number[] {
  const out = new Array<number>(track.length);
  let d = 0;
  for (let i = 0; i < track.length; i++) {
    if (i > 0) d += haversine(track[i - 1], track[i]);
    out[i] = d;
  }
  return out;
}

/**
 * Höhenmeter bergauf mit Hysterese: Erst eine Änderung über `threshold` Meter zählt.
 * Das filtert das typische Rauschen der GPS-/Barometer-Höhe.
 */
export function elevationGain(track: TrackPoint[], threshold = 3): number {
  let gain = 0;
  let base: number | undefined; // Tiefpunkt vor dem aktuellen Anstieg
  let peak = 0;
  let climbing = false;
  for (const p of track) {
    const e = p.ele;
    if (e == null || !Number.isFinite(e)) continue;
    if (base == null) {
      base = e;
      continue;
    }
    if (climbing) {
      if (e > peak) peak = e;
      else if (peak - e >= threshold) {
        gain += peak - base;
        base = e;
        climbing = false;
      }
    } else if (e < base) base = e;
    else if (e - base >= threshold) {
      climbing = true;
      peak = e;
    }
  }
  if (climbing && base != null) gain += peak - base;
  return Math.round(gain);
}

export interface TrackStats {
  distanceM: number;
  /** Bewegungszeit (Pausen > `pauseSec` ohne Bewegung zählen nicht) */
  movingSec: number;
  elapsedSec: number;
  elevationGainM: number;
  avgHr?: number;
  maxHr?: number;
}

/**
 * Kennzahlen eines Tracks. Abschnitte, in denen man langsamer als `minSpeed` (m/s) ist
 * oder zwischen zwei Punkten länger als `pauseSec` vergeht, gelten als Pause.
 */
export function trackStats(track: TrackPoint[], { minSpeed = 0.5, pauseSec = 30 } = {}): TrackStats {
  let distanceM = 0;
  let movingSec = 0;
  let hrSum = 0;
  let hrN = 0;
  let maxHr = 0;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (p.hr) {
      hrSum += p.hr;
      hrN++;
      maxHr = Math.max(maxHr, p.hr);
    }
    if (i === 0) continue;
    const d = haversine(track[i - 1], p);
    const dt = (p.t - track[i - 1].t) / 1000;
    distanceM += d;
    if (dt > 0 && dt <= pauseSec && d / dt >= minSpeed) movingSec += dt;
  }
  const elapsedSec = track.length > 1 ? (track[track.length - 1].t - track[0].t) / 1000 : 0;
  return {
    distanceM: Math.round(distanceM),
    movingSec: Math.round(movingSec),
    elapsedSec: Math.round(elapsedSec),
    elevationGainM: elevationGain(track),
    ...(hrN ? { avgHr: Math.round(hrSum / hrN), maxHr } : {}),
  };
}

export interface Split {
  /** 1-basiert */
  index: number;
  distanceM: number;
  durationSec: number;
  elevationDelta: number;
  avgHr?: number;
}

/**
 * Zwischenzeiten je `splitM` Meter (Standard 1 km). Die Zeit an der Split-Grenze wird
 * zwischen zwei Punkten linear interpoliert; der letzte angebrochene Abschnitt kommt dazu.
 */
export function splits(track: TrackPoint[], splitM = 1000): Split[] {
  if (track.length < 2) return [];
  const cum = cumulativeDistance(track);
  const total = cum[cum.length - 1];
  const out: Split[] = [];
  let startT = track[0].t;
  let startEle = track[0].ele;
  let hrSum = 0;
  let hrN = 0;
  let next = splitM;
  for (let i = 1; i < track.length; i++) {
    const p = track[i];
    if (p.hr) {
      hrSum += p.hr;
      hrN++;
    }
    while (cum[i] >= next) {
      const segLen = cum[i] - cum[i - 1];
      const f = segLen > 0 ? (next - cum[i - 1]) / segLen : 1;
      const t = track[i - 1].t + f * (p.t - track[i - 1].t);
      const prev = track[i - 1].ele;
      const ele = prev != null && p.ele != null ? prev + f * (p.ele - prev) : undefined;
      out.push({
        index: out.length + 1,
        distanceM: splitM,
        durationSec: (t - startT) / 1000,
        elevationDelta: ele != null && startEle != null ? Math.round(ele - startEle) : 0,
        ...(hrN ? { avgHr: Math.round(hrSum / hrN) } : {}),
      });
      startT = t;
      startEle = ele;
      hrSum = 0;
      hrN = 0;
      next += splitM;
    }
  }
  const rest = total - (next - splitM);
  if (rest >= Math.min(100, splitM / 10)) {
    const last = track[track.length - 1];
    out.push({
      index: out.length + 1,
      distanceM: Math.round(rest),
      durationSec: (last.t - startT) / 1000,
      elevationDelta: last.ele != null && startEle != null ? Math.round(last.ele - startEle) : 0,
      ...(hrN ? { avgHr: Math.round(hrSum / hrN) } : {}),
    });
  }
  return out;
}

/** Senkrechter Abstand (m, lokal flach genähert) von p zur Strecke a–b. */
function perpDistance(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const kx = Math.cos(rad(a.lat)) * 111_320;
  const ky = 110_540;
  const ax = a.lon * kx;
  const ay = a.lat * ky;
  const bx = b.lon * kx - ax;
  const by = b.lat * ky - ay;
  const px = p.lon * kx - ax;
  const py = p.lat * ky - ay;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Vereinfacht einen Track (Douglas-Peucker) auf Punkte mit mehr als `tolerance` m Abweichung. */
export function simplify(track: TrackPoint[], tolerance = 5): TrackPoint[] {
  if (track.length < 3) return track.slice();
  const keep = new Uint8Array(track.length);
  keep[0] = keep[track.length - 1] = 1;
  const stack: [number, number][] = [[0, track.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(track[i], track[s], track[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return track.filter((_, i) => keep[i]);
}

/** Entfernt Start und Ende (je `meters`) – Privatsphäre für die eigene Haustür. */
export function trimEnds(track: TrackPoint[], meters = 200): TrackPoint[] {
  if (track.length < 3) return [];
  const cum = cumulativeDistance(track);
  const total = cum[cum.length - 1];
  if (total <= meters * 2.5) return [];
  return track.filter((_, i) => cum[i] >= meters && cum[i] <= total - meters);
}

// ------------------------------------------------------------------ Encoded Polyline (Google-Format, 5 Stellen)

export function encodePolyline(points: { lat: number; lon: number }[]): string {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += enc(lat - pLat) + enc(lon - pLon);
    pLat = lat;
    pLon = lon;
  }
  return out;
}

export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const dec = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += dec();
    lon += dec();
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

// ------------------------------------------------------------------ Geohash

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Geohash einer Koordinate. Genauigkeit: 4 Zeichen ≈ 39 × 20 km (Region),
 * 5 Zeichen ≈ 5 × 5 km. Nahe Orte haben meist einen gemeinsamen Präfix.
 */
export function geohash(lat: number, lon: number, precision = 5): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch <<= 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Mittelpunkt einer Geohash-Zelle. */
export function geohashCenter(hash: string): { lat: number; lon: number } {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error(`Ungültiger Geohash: ${hash}`);
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (on) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

/** Rahmen (min/max) eines Tracks – für Kartenausschnitte. */
export function bounds(points: [number, number][]): { minLat: number; maxLat: number; minLon: number; maxLon: number } | null {
  if (!points.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}
