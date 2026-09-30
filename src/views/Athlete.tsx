import { useEffect, useState } from 'react';
import { getFeed, getProfileSummary, setFollow, setKudo, useCloudQuery, useMyProfile, type FeedItem } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { ActivityCard, fromFeed } from '../components/activity';
import { Avatar, TierBadge } from '../components/people';
import { Card, ErrorBox, toast } from '../components/ui';
import { MEDAL_BY_KEY } from '../lib/medals';
import { SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';

/** Profil eines anderen Mitglieds. */
export function AthleteView({ id }: { id?: string }) {
  const { profile: me } = useMyProfile();
  const summary = useCloudQuery(id && cloudEnabled ? () => getProfileSummary(id) : null, [id]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || !cloudEnabled) return;
    getFeed('user', undefined, id, 30).then(setItems).catch(() => setItems([]));
  }, [id]);

  if (!cloudEnabled) return <div className="content empty">Kein Community-Server eingerichtet.</div>;
  if (summary.error) return <div className="content"><ErrorBox>{cloudError({ message: summary.error })}</ErrorBox></div>;
  const s = summary.data;
  if (!s) return <div className="content empty">{summary.loading ? 'Lade …' : 'Profil nicht gefunden.'}</div>;
  const isMe = me?.id === s.profile.id;

  const follow = async () => {
    setBusy(true);
    try {
      await setFollow(s.profile.id, !s.is_following);
      summary.reload();
      toast(s.is_following ? 'Nicht mehr gefolgt' : `Du folgst jetzt ${s.profile.display_name}`);
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <Card>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={s.profile.display_name} url={s.profile.avatar_url} size={64} />
          <div className="grow">
            <h2>{s.profile.display_name}</h2>
            <div className="small muted">
              @{s.profile.username}
              {s.profile.region_name ? ` · ${s.profile.region_name}` : ''}
            </div>
            <div className="small text-2">
              <strong>{s.followers}</strong> Follower · <strong>{s.following}</strong> folgt
              {s.follows_me && ' · folgt dir'}
            </div>
          </div>
        </div>
        {s.profile.bio && <p className="small text-2">{s.profile.bio}</p>}
        {!isMe && me && (
          <button className={`btn ${s.is_following ? '' : 'primary'}`} onClick={follow} disabled={busy}>
            {s.is_following ? 'Entfolgen' : 'Folgen'}
          </button>
        )}
        <div className="grid-2">
          <div className="stat stat-tile">
            <span className="label">Punkte gesamt</span>
            <span className="value tnum">{fmt(s.total_points)}</span>
          </div>
          <div className="stat stat-tile">
            <span className="label">Aktivitäten</span>
            <span className="value tnum">{s.activities}</span>
          </div>
        </div>
        {s.leagues.length > 0 && (
          <div className="chips">
            {s.leagues.map((l) => (
              <span key={l.sport} className="row" style={{ gap: 4 }}>
                <span aria-hidden="true">{SPORT_DEFS[l.sport].emoji}</span>
                <TierBadge tier={l.tier} />
              </span>
            ))}
          </div>
        )}
        {s.medals.length > 0 && (
          <div className="chips">
            {s.medals.slice(0, 12).map((m) => (
              <span className="badge" key={`${m.key}${m.period}`}>
                {MEDAL_BY_KEY.get(m.key)?.emoji} {MEDAL_BY_KEY.get(m.key)?.label ?? m.key}
              </span>
            ))}
          </div>
        )}
      </Card>
      {items.map((it) => (
        <ActivityCard
          key={it.id}
          a={fromFeed(it)}
          onKudo={async () => {
            const on = !it.has_kudo;
            setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, has_kudo: on, kudos: x.kudos + (on ? 1 : -1) } : x)));
            await setKudo(it.id, on).catch((err) => toast(cloudError(err)));
          }}
        />
      ))}
      {items.length === 0 && <div className="empty">Keine sichtbaren Aktivitäten.</div>}
    </div>
  );
}
