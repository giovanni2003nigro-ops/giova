import { useMemo } from 'react';
import type { FeedItem } from '../cloud/api';
import { mediaUrl } from '../cloud/api';
import { useObjectUrl } from '../hooks';
import { relativeDay, toISODate } from '../lib/dates';
import { decodePolyline } from '../lib/geo';
import { formatClock, formatDistance, formatDurationSec, formatPace, paceLabel, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Activity, HyroxData, PowerliftingData, Sport, StrengthSummary, Visibility } from '../types';
import { IconComment, IconHeart, IconLock, IconUsers } from './icons';
import { Avatar } from './people';
import { SportIcon } from './SportIcon';

export interface ActivityCardData {
  key: string;
  href: string;
  sport: Sport;
  title: string;
  note?: string | null;
  startTime: number;
  durationSec: number;
  distanceM?: number | null;
  elevationGainM?: number | null;
  avgHr?: number | null;
  points: number;
  route?: [number, number][] | null;
  photo?: Blob;
  photoUrl?: string;
  strength?: StrengthSummary[];
  hyrox?: HyroxData;
  powerlifting?: PowerliftingData;
  visibility: Visibility;
  author?: { id: string; name: string; avatarUrl?: string | null; region?: string | null };
  social?: { kudos: number; comments: number; hasKudo: boolean };
  /** Lokale Aktivität, die in der Community geteilt ist */
  shared?: boolean;
}

export function fromLocal(a: Activity): ActivityCardData {
  return {
    key: `l-${a.id}`,
    href: `#/aktivitaet/${a.id}`,
    sport: a.sport,
    title: a.title,
    note: a.note,
    startTime: a.startTime,
    durationSec: a.durationSec,
    distanceM: a.distanceM,
    elevationGainM: a.elevationGainM,
    avgHr: a.avgHr,
    points: a.points,
    route: a.track && a.track.length > 1 ? a.track.map((p) => [p.lat, p.lon] as [number, number]) : null,
    photo: a.photo,
    strength: a.strength,
    hyrox: a.hyrox,
    powerlifting: a.powerlifting,
    visibility: a.visibility,
    shared: !!a.remoteId,
  };
}

export function fromFeed(f: FeedItem): ActivityCardData {
  return {
    key: `r-${f.id}`,
    href: `#/post/${f.id}`,
    sport: f.sport,
    title: f.title,
    note: f.description,
    startTime: Date.parse(f.started_at),
    durationSec: f.duration_s,
    distanceM: f.distance_m,
    elevationGainM: f.elevation_m,
    avgHr: f.avg_hr,
    points: f.points,
    route: f.polyline ? decodePolyline(f.polyline) : null,
    photoUrl: mediaUrl(f.photo_path),
    strength: f.metrics?.strength,
    hyrox: f.metrics?.hyrox,
    powerlifting: f.metrics?.powerlifting,
    visibility: f.visibility,
    author: { id: f.user_id, name: f.display_name, avatarUrl: f.avatar_url, region: f.region_name },
    social: { kudos: f.kudos, comments: f.comments, hasKudo: f.has_kudo },
  };
}

export function whenLabel(startTime: number): string {
  const d = new Date(startTime);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${relativeDay(toISODate(d))}, ${time}`;
}

/** Die wichtigsten Kennzahlen je nach Sportart. */
export function activityStats(a: Pick<ActivityCardData, 'sport' | 'durationSec' | 'distanceM' | 'elevationGainM' | 'avgHr' | 'strength' | 'hyrox' | 'powerlifting' | 'points'>): { label: string; value: string }[] {
  const def = SPORT_DEFS[a.sport];
  const out: { label: string; value: string }[] = [];
  if (def.distance && a.distanceM) {
    out.push({ label: 'Distanz', value: formatDistance(a.distanceM) });
    const pace = formatPace(a.sport, a.distanceM, a.durationSec);
    if (pace) out.push({ label: paceLabel(a.sport), value: pace });
    out.push({ label: 'Zeit', value: formatClock(a.durationSec) });
    if (a.elevationGainM && (a.sport === 'wandern' || a.sport === 'radfahren' || a.elevationGainM >= 50)) out.push({ label: 'Höhenmeter', value: `${fmt(a.elevationGainM)} m` });
    return out;
  }
  out.push({ label: 'Zeit', value: a.sport === 'hyrox' && a.hyrox?.race ? formatClock(a.durationSec) : formatDurationSec(a.durationSec) });
  if (a.sport === 'hyrox') out.push({ label: 'Art', value: a.hyrox?.race ? 'Wettkampf' : 'Training' });
  const pl = a.powerlifting;
  if (pl && pl.squat && pl.bench && pl.deadlift) out.push({ label: 'Total (e1RM)', value: `${fmt(pl.squat + pl.bench + pl.deadlift)} kg` });
  if (a.strength?.length) {
    out.push({ label: 'Übungen', value: String(a.strength.length) });
    const vol = a.strength.reduce((s, x) => s + x.volume, 0);
    if (vol > 0 && out.length < 3) out.push({ label: 'Volumen', value: `${fmt(vol / 1000, 1)} t` });
  }
  if (a.avgHr && out.length < 3) out.push({ label: 'Ø Puls', value: `${a.avgHr} bpm` });
  return out;
}

/** Kleine Streckenvorschau ohne Kartenkacheln (schnell für Listen). */
export function RouteSvg({ route, height = 150 }: { route: [number, number][]; height?: number }) {
  const path = useMemo(() => {
    if (route.length < 2) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [la, lo] of route) {
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLon = Math.min(minLon, lo);
      maxLon = Math.max(maxLon, lo);
    }
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const w = Math.max((maxLon - minLon) * k, 1e-6);
    const h = Math.max(maxLat - minLat, 1e-6);
    const W = 300;
    const H = height;
    const pad = 12;
    const s = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
    const ox = (W - w * s) / 2;
    const oy = (H - h * s) / 2;
    const step = Math.max(1, Math.floor(route.length / 400));
    const pts = route.filter((_, i) => i % step === 0 || i === route.length - 1).map(([la, lo]) => [ox + (lo - minLon) * k * s, oy + (maxLat - la) * s]);
    return { d: `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}`, start: pts[0], end: pts[pts.length - 1], W, H };
  }, [route, height]);
  if (!path) return null;
  return (
    <svg className="route-svg" viewBox={`0 0 ${path.W} ${path.H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={path.d} className="route-line" />
      <circle cx={path.start[0]} cy={path.start[1]} r="4.5" className="route-start" />
      <circle cx={path.end[0]} cy={path.end[1]} r="4.5" className="route-end" />
    </svg>
  );
}

export function VisibilityIcon({ v }: { v: Visibility }) {
  if (v === 'private') return <IconLock className="inline-icon" aria-label="Nur ich" />;
  if (v === 'followers') return <IconUsers className="inline-icon" aria-label="Nur Follower" />;
  return null;
}

export function ActivityCard({ a, onKudo }: { a: ActivityCardData; onKudo?: () => void }) {
  const localPhoto = useObjectUrl(a.photo);
  const photo = localPhoto ?? a.photoUrl;
  const def = SPORT_DEFS[a.sport];
  const stats = activityStats(a);
  return (
    <article className="card activity-card">
      <a className="activity-link" href={a.href} aria-label={`${a.title} öffnen`} />
      <div className="row" style={{ gap: 10 }}>
        {a.author ? <Avatar name={a.author.name} url={a.author.avatarUrl} size={40} /> : <span className="sport-dot" aria-hidden="true"><SportIcon sport={def.key} /></span>}
        <div className="grow">
          <div className="small">
            {a.author ? (
              <a href={`#/athlet/${a.author.id}`} className="author">
                {a.author.name}
              </a>
            ) : (
              <strong>{def.label}</strong>
            )}
          </div>
          <div className="tiny muted">
            {a.author && `$<SportIcon sport={def.key} /> `}
            {whenLabel(a.startTime)}
            {a.author?.region ? ` · ${a.author.region}` : ''} <VisibilityIcon v={a.visibility} />
            {a.shared && ' · geteilt'}
          </div>
        </div>
        <span className="points-chip" title="Punkte">
          +{fmt(a.points)}
        </span>
      </div>
      <h3 className="activity-title">{a.title}</h3>
      {a.note && <p className="small text-2 clamp-2">{a.note}</p>}
      <div className="activity-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <span className="label">{s.label}</span>
            <span className="value tnum">{s.value}</span>
          </div>
        ))}
      </div>
      {a.strength && a.strength.length > 0 && !a.route && (
        <div className="tiny text-2">
          {a.strength
            .slice(0, 4)
            .map((s) => (s.topWeight > 0 ? `${s.exercise} ${fmt(s.topWeight, 1)}×${s.topReps}` : `${s.exercise} ${s.reps} Wdh.`))
            .join(' · ')}
          {a.strength.length > 4 && ` · +${a.strength.length - 4}`}
        </div>
      )}
      {(a.route || photo) && (
        <div className={`activity-media ${a.route && photo ? 'two' : ''}`}>
          {a.route && <RouteSvg route={a.route} />}
          {photo && <img src={photo} alt="" loading="lazy" />}
        </div>
      )}
      {a.social && (
        <div className="row social-row">
          <button className={`btn ghost small kudo ${a.social.hasKudo ? 'on' : ''}`} onClick={onKudo} aria-pressed={a.social.hasKudo} aria-label="Kudos geben">
            <IconHeart filled={a.social.hasKudo} /> {a.social.kudos || ''}
          </button>
          <a className="btn ghost small" href={a.href} aria-label="Kommentare">
            <IconComment /> {a.social.comments || ''}
          </a>
        </div>
      )}
    </article>
  );
}
