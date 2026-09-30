import type { Sport, TrackPoint } from '../types';
import { trackStats } from './geo';

/** Eine aus einer Datei gelesene Aktivität – vor dem Speichern noch bearbeitbar. */
export interface ImportedActivity {
  sport: Sport;
  name?: string;
  startTime: number;
  durationSec: number;
  elapsedSec?: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  kcal?: number;
  track: TrackPoint[];
  source: 'gpx' | 'tcx' | 'fit';
}

/** Ordnet Sportart-Bezeichnungen aus GPX/TCX/FIT unseren Sportarten zu. */
export function mapSport(raw: string | undefined | null, sub?: string | null): Sport | undefined {
  const s = `${raw ?? ''} ${sub ?? ''}`.toLowerCase();
  if (/strength|kraft|weight/.test(s)) return 'gym';
  if (/row|ruder/.test(s)) return 'rudern';
  if (/swim|schwimm/.test(s)) return 'schwimmen';
  if (/bik|cycl|ride|rad|mtb|gravel/.test(s)) return 'radfahren';
  if (/hik|walk|wander|trek|mountaineer/.test(s)) return 'wandern';
  if (/run|lauf|jog|trail/.test(s)) return 'laufen';
  if (/hyrox/.test(s)) return 'hyrox';
  return undefined;
}

/** Rät die Sportart aus der Durchschnittsgeschwindigkeit, wenn die Datei keine enthält. */
export function guessSport(distanceM: number, durationSec: number): Sport {
  if (distanceM <= 0) return 'gym';
  const v = durationSec > 0 ? distanceM / durationSec : 0; // m/s
  if (v > 4.6) return 'radfahren'; // > ~16,5 km/h
  if (v > 0 && v < 1.9) return 'wandern'; // < ~6,8 km/h
  return 'laufen';
}

// ------------------------------------------------------------------ XML-Hilfen

function byLocalName(root: Element | Document, name: string): Element[] {
  const all = root.getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
  return out;
}

function firstText(root: Element, name: string): string | undefined {
  const el = byLocalName(root, name)[0];
  const t = el?.textContent?.trim();
  return t || undefined;
}

function num(v: string | undefined | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges XML.');
  return doc;
}

function finish(
  source: ImportedActivity['source'],
  track: TrackPoint[],
  meta: Partial<Omit<ImportedActivity, 'track' | 'source'>>,
): ImportedActivity {
  track.sort((a, b) => a.t - b.t);
  const stats = trackStats(track);
  const distanceM = meta.distanceM ?? (stats.distanceM || undefined);
  const durationSec = meta.durationSec ?? (stats.movingSec || stats.elapsedSec);
  const startTime = meta.startTime ?? track[0]?.t;
  if (startTime == null || !Number.isFinite(startTime)) throw new Error('Die Datei enthält keine Zeitangaben.');
  if (!durationSec) throw new Error('Die Datei enthält keine auswertbare Dauer.');
  return {
    sport: meta.sport ?? guessSport(distanceM ?? 0, durationSec),
    name: meta.name,
    startTime,
    durationSec: Math.round(durationSec),
    elapsedSec: Math.round(meta.elapsedSec ?? stats.elapsedSec) || undefined,
    distanceM: distanceM != null ? Math.round(distanceM) : undefined,
    elevationGainM: meta.elevationGainM ?? (track.some((p) => p.ele != null) ? stats.elevationGainM : undefined),
    avgHr: meta.avgHr ?? stats.avgHr,
    maxHr: meta.maxHr ?? stats.maxHr,
    kcal: meta.kcal,
    track,
    source,
  };
}

// ------------------------------------------------------------------ GPX

export function parseGpx(text: string): ImportedActivity[] {
  const doc = parseXml(text);
  const tracks = byLocalName(doc, 'trk');
  const out: ImportedActivity[] = [];
  for (const trk of tracks) {
    const track: TrackPoint[] = [];
    for (const pt of byLocalName(trk, 'trkpt')) {
      const lat = num(pt.getAttribute('lat'));
      const lon = num(pt.getAttribute('lon'));
      const time = firstText(pt, 'time');
      const t = time ? Date.parse(time) : NaN;
      if (lat == null || lon == null || !Number.isFinite(t)) continue;
      const ele = num(firstText(pt, 'ele'));
      const hr = num(firstText(pt, 'hr'));
      track.push({ lat, lon, t, ...(ele != null ? { ele } : {}), ...(hr ? { hr } : {}) });
    }
    if (track.length < 2) continue;
    // <name>/<type> direkt unter <trk>, nicht aus Wegpunkten
    const direct = (name: string) =>
      [...trk.children].find((c) => c.localName === name)?.textContent?.trim() || undefined;
    out.push(finish('gpx', track, { name: direct('name'), sport: mapSport(direct('type')) }));
  }
  if (!out.length) throw new Error('Keine Strecke mit Zeitstempeln in der GPX-Datei gefunden.');
  return out;
}

// ------------------------------------------------------------------ TCX

export function parseTcx(text: string): ImportedActivity[] {
  const doc = parseXml(text);
  const out: ImportedActivity[] = [];
  for (const act of byLocalName(doc, 'Activity')) {
    const laps = byLocalName(act, 'Lap');
    let durationSec = 0;
    let distanceM = 0;
    let kcal = 0;
    let maxHr = 0;
    let hrWeighted = 0;
    for (const lap of laps) {
      const d = num([...lap.children].find((c) => c.localName === 'TotalTimeSeconds')?.textContent) ?? 0;
      durationSec += d;
      distanceM += num([...lap.children].find((c) => c.localName === 'DistanceMeters')?.textContent) ?? 0;
      kcal += num([...lap.children].find((c) => c.localName === 'Calories')?.textContent) ?? 0;
      const avg = [...lap.children].find((c) => c.localName === 'AverageHeartRateBpm');
      const max = [...lap.children].find((c) => c.localName === 'MaximumHeartRateBpm');
      const avgV = avg ? num(firstText(avg, 'Value')) : undefined;
      const maxV = max ? num(firstText(max, 'Value')) : undefined;
      if (avgV) hrWeighted += avgV * d;
      if (maxV) maxHr = Math.max(maxHr, maxV);
    }
    const track: TrackPoint[] = [];
    const timeline: { t: number; hr?: number }[] = [];
    for (const tp of byLocalName(act, 'Trackpoint')) {
      const time = firstText(tp, 'Time');
      const t = time ? Date.parse(time) : NaN;
      if (!Number.isFinite(t)) continue;
      const hrEl = byLocalName(tp, 'HeartRateBpm')[0];
      const hr = hrEl ? num(firstText(hrEl, 'Value')) : undefined;
      timeline.push({ t, hr });
      const lat = num(firstText(tp, 'LatitudeDegrees'));
      const lon = num(firstText(tp, 'LongitudeDegrees'));
      if (lat == null || lon == null) continue;
      const ele = num(firstText(tp, 'AltitudeMeters'));
      track.push({ lat, lon, t, ...(ele != null ? { ele } : {}), ...(hr ? { hr } : {}) });
    }
    const id = [...act.children].find((c) => c.localName === 'Id')?.textContent?.trim();
    const startTime = id ? Date.parse(id) : timeline[0]?.t;
    const hrs = timeline.map((x) => x.hr).filter((x): x is number => !!x);
    out.push(
      finish('tcx', track, {
        sport: mapSport(act.getAttribute('Sport')),
        startTime: Number.isFinite(startTime) ? startTime : undefined,
        durationSec: durationSec || undefined,
        distanceM: distanceM || undefined,
        kcal: kcal || undefined,
        avgHr: durationSec && hrWeighted ? Math.round(hrWeighted / durationSec) : hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined,
        maxHr: maxHr || (hrs.length ? Math.max(...hrs) : undefined),
      }),
    );
  }
  if (!out.length) throw new Error('Keine Aktivität in der TCX-Datei gefunden.');
  return out;
}

// ------------------------------------------------------------------ FIT (Garmin)

const SEMI = 180 / 2 ** 31;

type FitMsg = Record<string, unknown>;

const asTime = (v: unknown): number | undefined =>
  v instanceof Date ? v.getTime() : typeof v === 'number' ? v : undefined;
const asNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export async function parseFit(bytes: Uint8Array): Promise<ImportedActivity[]> {
  // Das Garmin-SDK ist groß – erst laden, wenn wirklich eine FIT-Datei kommt
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) throw new Error('Das ist keine gültige FIT-Datei.');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();
  const records = (messages.recordMesgs ?? []) as FitMsg[];
  const sessions = (messages.sessionMesgs ?? []) as FitMsg[];
  if (!records.length && !sessions.length)
    throw new Error(errors.length ? `FIT-Datei beschädigt: ${String(errors[0])}` : 'Die FIT-Datei enthält keine Aktivität.');

  const track: TrackPoint[] = [];
  for (const r of records) {
    const t = asTime(r.timestamp);
    const la = asNum(r.positionLat);
    const lo = asNum(r.positionLong);
    if (t == null || la == null || lo == null) continue;
    const ele = asNum(r.enhancedAltitude) ?? asNum(r.altitude);
    const hr = asNum(r.heartRate);
    track.push({ lat: la * SEMI, lon: lo * SEMI, t, ...(ele != null ? { ele } : {}), ...(hr ? { hr } : {}) });
  }
  const hrs = records.map((r) => asNum(r.heartRate)).filter((x): x is number => !!x);

  if (!sessions.length) return [finish('fit', track, {})];
  // Multisport-Dateien (z. B. Triathlon) enthalten mehrere Sessions
  return sessions.map((s) => {
    const start = asTime(s.startTime);
    const elapsed = asNum(s.totalElapsedTime);
    const end = start != null && elapsed != null ? start + elapsed * 1000 : undefined;
    const part = sessions.length > 1 && start != null && end != null ? track.filter((p) => p.t >= start && p.t <= end) : track;
    return finish('fit', part, {
      sport: mapSport(String(s.sport ?? ''), String(s.subSport ?? '')),
      startTime: start,
      durationSec: asNum(s.totalTimerTime) ?? elapsed,
      elapsedSec: elapsed,
      distanceM: asNum(s.totalDistance),
      elevationGainM: asNum(s.totalAscent),
      kcal: asNum(s.totalCalories),
      avgHr: asNum(s.avgHeartRate) ?? (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined),
      maxHr: asNum(s.maxHeartRate) ?? (hrs.length ? Math.max(...hrs) : undefined),
    });
  });
}

/** Liest eine Datei (GPX, TCX oder FIT) ein. */
export async function importFile(file: File): Promise<ImportedActivity[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.fit')) return parseFit(new Uint8Array(await file.arrayBuffer()));
  const text = await file.text();
  if (name.endsWith('.gpx') || /<gpx[\s>]/i.test(text.slice(0, 2000))) return parseGpx(text);
  if (name.endsWith('.tcx') || /<TrainingCenterDatabase/i.test(text.slice(0, 2000))) return parseTcx(text);
  throw new Error(`„${file.name}“: Nur GPX-, TCX- und FIT-Dateien werden unterstützt.`);
}
