import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getProfileSummary, useCloudQuery, useMyProfile } from '../cloud/api';
import { cloudEnabled } from '../cloud/client';
import { ActivityCard, fromLocal } from '../components/activity';
import { IconCalendar, IconChat, IconChevronRight, IconDumbbell, IconGear, IconMedal, IconMoon, IconSparkle, IconTarget, IconUser } from '../components/icons';
import { Avatar, TierBadge } from '../components/people';
import { Card } from '../components/ui';
import { db, useKV } from '../db';
import { useToday } from '../hooks';
import { addDays } from '../lib/dates';
import { seasonOf, sportPerformance } from '../lib/leagues';
import { MEDAL_BY_KEY } from '../lib/medals';
import { formatDistance, formatDurationSec, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Profile, Sport } from '../types';
import { SportIcon } from '../components/SportIcon';
import { useCommunity } from '../lib/features';

const LINKS = [
  { href: '#/start', label: 'Einrichtung', sub: 'Ziele, Alltag und Training Schritt für Schritt – mit Erklärung', Icon: IconSparkle },
  { href: '#/plan', label: 'Trainingsplan & Alltag', sub: 'Grundlage für deinen KI-Ernährungsplan', Icon: IconCalendar },
  { href: '#/ziele', label: 'Ziele & Körper', sub: 'Ziel, Kalorien, Gewicht, Kraftziele', Icon: IconTarget },
  { href: '#/schlaf', label: 'Schlaf', sub: 'Dauer, Qualität, Regelmäßigkeit', Icon: IconMoon },
  { href: '#/training', label: 'Krafttraining', sub: 'Sätze eintragen, Verlauf & Analyse', Icon: IconDumbbell },
  { href: '#/medaillen', label: 'Medaillen', sub: 'Erreichte Ziele & Bonuspunkte', Icon: IconMedal },
  { href: '#/coach', label: 'Coach', sub: 'Fragen zu Training & Ernährung', Icon: IconChat },
  { href: '#/einstellungen', label: 'Einstellungen', sub: 'API-Schlüssel, Darstellung, Sicherung', Icon: IconGear },
];

export function ProfileView() {
  const t = useToday();
  const activities = useLiveQuery(() => db.activities.orderBy('startTime').reverse().toArray(), []);
  const medals = useLiveQuery(() => db.medals.orderBy('earnedAt').reverse().toArray(), []);
  const weights = useLiveQuery(() => db.weights.orderBy('date').toArray(), []);
  const localProfile = useKV<Profile | null>('profile', null);
  const { profile } = useMyProfile();
  const community = useCommunity();
  const summary = useCloudQuery(profile ? () => getProfileSummary(profile.id) : null, [profile?.id]);
  const [filter, setFilter] = useState<Sport | 'alle'>('alle');
  const [limit, setLimit] = useState(10);

  const month = seasonOf(t);
  const bySport = useMemo(() => {
    const out = new Map<Sport, { n: number; dist: number; sec: number; pts: number }>();
    for (const a of activities ?? []) {
      if (!a.date.startsWith(month)) continue;
      const r = out.get(a.sport) ?? { n: 0, dist: 0, sec: 0, pts: 0 };
      r.n++;
      r.dist += a.distanceM ?? 0;
      r.sec += a.durationSec;
      r.pts += a.points;
      out.set(a.sport, r);
    }
    return [...out.entries()].sort((a, b) => b[1].pts - a[1].pts);
  }, [activities, month]);
  const usedSports = useMemo(() => [...new Set((activities ?? []).map((a) => a.sport))], [activities]);

  if (!activities || !medals) return null;
  const totalPoints = activities.reduce((s, a) => s + a.points, 0) + medals.reduce((s, m) => s + m.points, 0);
  const bw = weights?.length ? weights[weights.length - 1].weight : null;
  const list = activities.filter((a) => filter === 'alle' || a.sport === filter);
  const week = activities.filter((a) => a.date > addDays(t, -7));

  return (
    <div className="content">
      <Card>
        <div className="row" style={{ gap: 14 }}>
          {profile ? <Avatar name={profile.display_name} url={profile.avatar_url} size={64} /> : <span className="avatar" style={{ width: 64, height: 64 }}><IconUser width={30} height={30} /></span>}
          <div className="grow">
            <h2>{profile?.display_name ?? 'Dein Profil'}</h2>
            <div className="small muted">{profile ? `@${profile.username}${profile.region_name ? ` · ${profile.region_name}` : ''}` : cloudEnabled ? 'Nicht angemeldet' : 'Nur auf diesem Gerät'}</div>
            {summary.data && (
              <div className="small text-2">
                <strong>{summary.data.followers}</strong> Follower · <strong>{summary.data.following}</strong> folge ich
              </div>
            )}
          </div>
          {cloudEnabled && community && (
            <a className="btn small" href="#/konto">
              {profile ? 'Konto' : 'Anmelden'}
            </a>
          )}
        </div>
        <div className="grid-3">
          <div className="stat stat-tile">
            <span className="label">Punkte gesamt</span>
            <span className="value tnum">{fmt(totalPoints)}</span>
          </div>
          <div className="stat stat-tile">
            <span className="label">Aktivitäten</span>
            <span className="value tnum">{activities.length}</span>
          </div>
          <div className="stat stat-tile">
            <span className="label">Diese Woche</span>
            <span className="value tnum">{week.length}</span>
            <span className="delta">{formatDurationSec(week.reduce((s, a) => s + a.durationSec, 0))}</span>
          </div>
        </div>
      </Card>

      {bySport.length > 0 && (
        <Card title="Dieser Monat" action={community ? <a className="small" href="#/ligen">Ligen</a> : undefined}>
          <div className="list">
            {bySport.map(([s, r]) => {
              const perf = sportPerformance(s, activities, t, { sex: localProfile?.sex ?? 'm', bodyweight: bw });
              return (
                <div className="list-item" key={s}>
                  <span className="sport-dot" aria-hidden="true">
                    <SportIcon sport={s} />
                  </span>
                  <div className="main">
                    <div className="title">{SPORT_DEFS[s].label}</div>
                    <div className="meta tnum">
                      {r.n}× · {r.dist > 0 ? `${formatDistance(r.dist)} · ` : ''}
                      {formatDurationSec(r.sec)} · {fmt(r.pts)} Punkte
                    </div>
                  </div>
                  <TierBadge tier={perf.tier} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {medals.length > 0 && (
        <Card title={`Medaillen (${medals.length})`} action={<a className="small" href="#/medaillen">Alle</a>}>
          <div className="chips">
            {medals.slice(0, 12).map((m) => (
              <span className="badge" key={m.id} title={MEDAL_BY_KEY.get(m.key)?.description}>
                <IconMedal className="inline-icon" /> {MEDAL_BY_KEY.get(m.key)?.label}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card className="tight">
        <nav className="menu">
          {LINKS.map(({ href, label, sub, Icon }) => (
            <a key={href} href={href} className="menu-item">
              <Icon />
              <span className="grow">
                <span className="title">{label}</span>
                <span className="tiny muted">{sub}</span>
              </span>
              <IconChevronRight className="muted" />
            </a>
          ))}
        </nav>
      </Card>

      <div className="section-title">Aktivitäten</div>
      {usedSports.length > 1 && (
        <div className="chips">
          <button className="chip" aria-pressed={filter === 'alle'} onClick={() => setFilter('alle')}>
            Alle
          </button>
          {usedSports.map((s) => (
            <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              <SportIcon sport={s} /> {SPORT_DEFS[s].label}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && (
        <div className="empty">
          Noch keine Aktivitäten. <a href="#/aufzeichnen">Jetzt aufzeichnen</a> oder <a href="#/import">von der Uhr importieren</a>.
        </div>
      )}
      {list.slice(0, limit).map((a) => (
        <ActivityCard key={a.id} a={fromLocal(a)} />
      ))}
      {list.length > limit && (
        <button className="btn" onClick={() => setLimit((l) => l + 20)}>
          Mehr anzeigen
        </button>
      )}
    </div>
  );
}
