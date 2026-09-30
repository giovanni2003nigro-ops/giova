import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getLeaderboard, getStandings, joinLeague, lastLeagueResults, myLeagues, useCloudQuery, useMyProfile, type LeagueMembership } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { IconMedal, IconTrophy } from '../components/icons';
import { Avatar, TierBadge } from '../components/people';
import { Card, ErrorBox, Seg, toast } from '../components/ui';
import { db, useKV } from '../db';
import { navigate, useToday } from '../hooks';
import {
  daysLeftInSeason,
  formatMetric,
  LEAGUE_RULES,
  seasonLabel,
  seasonOf,
  seasonPoints,
  sportPerformance,
  TIERS,
  zoneSize,
} from '../lib/leagues';
import { MEDAL_BY_KEY } from '../lib/medals';
import { POINTS_RULES } from '../lib/points';
import { SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Profile, Sport } from '../types';
import { SPORTS } from '../types';

export function LeaguesView() {
  const t = useToday();
  const season = seasonOf(t);
  const activities = useLiveQuery(() => db.activities.toArray(), []);
  const medals = useLiveQuery(() => db.medals.toArray(), []);
  const weights = useLiveQuery(() => db.weights.orderBy('date').toArray(), []);
  const profile = useKV<Profile | null>('profile', null);
  const { profile: cloudProfile } = useMyProfile();

  const sportsByUse = useMemo(() => {
    const count = new Map<Sport, number>();
    for (const a of activities ?? []) count.set(a.sport, (count.get(a.sport) ?? 0) + 1);
    for (const s of cloudProfile?.sports ?? []) count.set(s, (count.get(s) ?? 0) + 0.5);
    return [...SPORTS].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
  }, [activities, cloudProfile]);
  const [picked, setPicked] = useState<Sport | null>(null);
  const sport = picked ?? sportsByUse[0];

  if (!activities || !medals) return null;
  const bodyweight = weights?.length ? weights[weights.length - 1].weight : null;
  const perf = sportPerformance(sport, activities, t, { sex: profile?.sex ?? cloudProfile?.sex ?? 'm', bodyweight });
  const medalRows = medals.map((m) => ({ ...m, sport: MEDAL_BY_KEY.get(m.key)?.sport }));
  const points = seasonPoints(sport, season, activities, medalRows);
  const rule = LEAGUE_RULES[sport];
  const next = perf.tier < TIERS.length - 1 ? perf.tier : null;

  return (
    <div className="content">
      <div className="row between">
        <div>
          <div className="small muted">Saison</div>
          <h1>{seasonLabel(season)}</h1>
        </div>
        <span className="badge">{daysLeftInSeason(t) === 1 ? 'letzter Tag' : `noch ${daysLeftInSeason(t)} Tage`}</span>
      </div>

      <div className="chips" role="group" aria-label="Sportart">
        {sportsByUse.map((s) => (
          <button key={s} className="chip" aria-pressed={s === sport} onClick={() => setPicked(s)}>
            {SPORT_DEFS[s].emoji} {SPORT_DEFS[s].label}
          </button>
        ))}
      </div>

      <Card>
        <div className="row between">
          <div className="stat">
            <span className="label">Deine Leistung reicht für</span>
            <TierBadge tier={perf.tier} large />
          </div>
          <div className="stat" style={{ textAlign: 'right' }}>
            <span className="label">Punkte diese Saison</span>
            <span className="hero" style={{ fontSize: '2rem' }}>
              {fmt(points)}
            </span>
          </div>
        </div>
        <div className="stack">
          <ProgressRow
            label={rule.volume.label}
            value={formatMetric(rule.volume.metric, perf.volume)}
            target={next != null ? formatMetric(rule.volume.metric, rule.volume.thresholds[next]) : null}
            progress={perf.nextVolumeProgress}
          />
          {rule.intensity && (
            <ProgressRow
              label={`${rule.intensity.label}${rule.intensity.minVolume ? ` (ab ${fmt(rule.intensity.minVolume)} ${rule.volume.metric === 'km' ? 'km' : ''})` : ''}`}
              value={perf.intensity != null ? formatMetric(rule.intensity.metric, perf.intensity) : '–'}
              target={next != null ? formatMetric(rule.intensity.metric, rule.intensity.thresholds[next]) : null}
              progress={perf.nextIntensityProgress}
            />
          )}
        </div>
        <p className="tiny muted">
          {next != null
            ? `Für ${TIERS[next + 1].label} reicht eins von beiden: ${rule.volume.label} oder ${rule.intensity?.label ?? ''}. Zeitraum: letzte ${rule.windowDays} Tage.`.replace(' oder .', '.')
            : 'Höchste Stufe erreicht – stark!'}
        </p>
        <details className="table-view">
          <summary>Alle Ligen & Schwellen</summary>
          <table className="data-table">
            <thead>
              <tr>
                <th>Liga</th>
                <th>{rule.volume.label}</th>
                {rule.intensity && <th>{rule.intensity.label}</th>}
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier) => (
                <tr key={tier.key} style={tier.index === perf.tier ? { fontWeight: 650 } : undefined}>
                  <td>
                    {tier.emoji} {tier.label}
                  </td>
                  <td>{tier.index === 0 ? 'Start' : `≥ ${formatMetric(rule.volume.metric, rule.volume.thresholds[tier.index - 1])}`}</td>
                  {rule.intensity && (
                    <td>
                      {tier.index === 0
                        ? '–'
                        : `${rule.intensity.lowerIsBetter ? '≤' : '≥'} ${formatMetric(rule.intensity.metric, rule.intensity.thresholds[tier.index - 1])}`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      {cloudEnabled ? (
        cloudProfile ? (
          <CommunityLeague sport={sport} season={season} />
        ) : cloudProfile === null ? (
          <Card title="Rangliste mit anderen">
            <p className="small text-2">
              Melde dich an, um in deiner Liga gegen Leute mit ähnlichem Niveau aus deiner Umgebung anzutreten – mit Auf- und Abstieg am Monatsende.
            </p>
            <a className="btn primary" href="#/konto">
              Konto erstellen / anmelden
            </a>
          </Card>
        ) : null
      ) : (
        <Card title="Rangliste mit anderen">
          <p className="small text-2">
            Für Ranglisten, Gruppen in deiner Umgebung sowie Auf- und Abstieg braucht die App einen Community-Server. Deine Leistungsstufe, Punkte und
            Medaillen funktionieren schon jetzt lokal.
          </p>
        </Card>
      )}

      <button className="btn" onClick={() => navigate('medaillen')}>
        <IconMedal /> Medaillen & Bonuspunkte
      </button>

      <Card title="So funktioniert’s">
        <ul className="small text-2 rules">
          <li>
            <strong>Punkte:</strong> {POINTS_RULES[sport]}. Medaillen geben Bonuspunkte – Sport-Medaillen in ihrer Liga, allgemeine in allen.
          </li>
          <li>
            <strong>Gruppen:</strong> Du trittst in deiner Liga gegen bis zu 29 andere aus deiner Umgebung an.
          </li>
          <li>
            <strong>Aufstieg:</strong> Top 20 % deiner Gruppe am Monatsende – oder sofort, wenn deine Leistung die Schwelle einer höheren Liga erreicht.
          </li>
          <li>
            <strong>Abstieg:</strong> Untere 20 %, wenn du die Schwelle deiner Liga nicht hältst, oder wenn du im ganzen Monat keine Punkte sammelst.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function ProgressRow({ label, value, target, progress }: { label: string; value: string; target: string | null; progress: number | null }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="tnum">
          <span className="v">{value}</span>
          {target && <span className="muted"> / {target}</span>}
        </span>
      </div>
      {progress != null && (
        <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={label}>
          <div className="meter-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function CommunityLeague({ sport, season }: { sport: Sport; season: string }) {
  const [tab, setTab] = useState<'gruppe' | 'region' | 'alle'>('gruppe');
  const [busy, setBusy] = useState(false);
  const leagues = useCloudQuery(() => myLeagues(season), [season]);
  const membership: LeagueMembership | undefined = leagues.data?.find((m) => m.sport === sport);
  const standings = useCloudQuery(membership && tab === 'gruppe' ? () => getStandings(sport) : null, [sport, membership?.group_id, tab]);
  const board = useCloudQuery(tab !== 'gruppe' ? () => getLeaderboard(sport, tab === 'region' ? 'region' : 'all') : null, [sport, tab]);
  const results = useCloudQuery(() => lastLeagueResults(), []);
  const last = results.data?.find((r) => r.sport === sport);

  const join = async () => {
    setBusy(true);
    try {
      const m = await joinLeague(sport);
      toast(`Willkommen in der Liga ${TIERS[m.tier].label}!`);
      leagues.reload();
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = standings.data ?? [];
  const n = rows[0]?.group_size ?? rows.length;
  const zone = zoneSize(n);

  return (
    <>
      {last && last.outcome && last.season !== season && (
        <div className={`rec ${last.outcome === 'auf' ? 'ok' : last.outcome === 'ab' ? 'warn' : 'info'}`}>
          <IconTrophy className="rec-icon" />
          <div>
            <h3>
              {last.outcome === 'auf' ? 'Aufgestiegen! 🎉' : last.outcome === 'ab' ? 'Abgestiegen' : 'Klasse gehalten'} – {seasonLabel(last.season)}
            </h3>
            <p>
              Platz {last.final_rank} mit {fmt(last.points ?? 0)} Punkten → jetzt {TIERS[last.new_tier ?? last.tier].label}.
            </p>
          </div>
        </div>
      )}
      <Seg
        label="Rangliste"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'gruppe', label: 'Meine Liga' },
          { value: 'region', label: 'Umgebung' },
          { value: 'alle', label: 'Alle' },
        ]}
      />
      {tab === 'gruppe' && !leagues.loading && !membership && (
        <Card title={`${SPORT_DEFS[sport].label}-Liga beitreten`}>
          <p className="small text-2">Du wirst nach deiner Leistung der letzten 30 Tage eingestuft und einer Gruppe in deiner Nähe zugeteilt.</p>
          <button className="btn primary" onClick={join} disabled={busy}>
            {busy ? 'Trete bei …' : 'Liga beitreten'}
          </button>
        </Card>
      )}
      {(leagues.error || standings.error || board.error) && <ErrorBox>{cloudError({ message: leagues.error || standings.error || board.error })}</ErrorBox>}
      {tab === 'gruppe' && membership && (
        <Card
          title={
            <div className="row">
              <TierBadge tier={membership.tier} />
              <span className="small muted">Gruppe #{membership.group_id} · {n} Teilnehmer</span>
            </div>
          }
        >
          {zone > 0 ? (
            <p className="tiny muted">
              ▲ Aufstieg: Platz 1–{zone} · ▼ Abstieg: Platz {n - zone + 1}–{n}
            </p>
          ) : (
            <p className="tiny muted">Ab 5 Teilnehmern gibt es Auf- und Abstiegsplätze. Bis dahin zählt die Leistungsschwelle.</p>
          )}
          <div className="standings">
            {rows.map((r) => (
              <a key={r.user_id} href={`#/athlet/${r.user_id}`} className={`standing ${r.zone ?? ''} ${r.is_me ? 'me' : ''}`}>
                <span className="rank tnum">{r.rank}</span>
                <Avatar name={r.display_name} url={r.avatar_url} size={32} />
                <span className="grow">
                  <span className="name">{r.display_name}</span>
                  <span className="tiny muted">
                    {r.region_name ?? ''} {r.performance_tier > r.tier ? '· Schwelle für Aufstieg erreicht ▲' : ''}
                  </span>
                </span>
                <span className="tnum pts">{fmt(r.points)}</span>
              </a>
            ))}
            {standings.loading && !rows.length && <div className="empty">Lade Tabelle …</div>}
          </div>
        </Card>
      )}
      {tab !== 'gruppe' && (
        <Card title={tab === 'region' ? 'Bestenliste in deiner Umgebung' : 'Bestenliste gesamt'}>
          <div className="standings">
            {(board.data ?? []).map((r) => (
              <a key={r.user_id} href={`#/athlet/${r.user_id}`} className={`standing ${r.is_me ? 'me' : ''}`}>
                <span className="rank tnum">{r.rank}</span>
                <Avatar name={r.display_name} url={r.avatar_url} size={32} />
                <span className="grow">
                  <span className="name">{r.display_name}</span>
                  <span className="tiny muted">
                    {r.region_name ?? ''} {r.tier != null ? `· ${TIERS[r.tier].emoji} ${TIERS[r.tier].label}` : ''}
                  </span>
                </span>
                <span className="tnum pts">{fmt(r.points)}</span>
              </a>
            ))}
            {board.loading && <div className="empty">Lade …</div>}
            {!board.loading && board.data?.length === 0 && <div className="empty">Diese Saison noch keine Einträge.</div>}
          </div>
          {tab === 'region' && <p className="tiny muted">Umgebung ≈ 150 km um deinen Heimatort (im Konto festlegen).</p>}
        </Card>
      )}
    </>
  );
}
