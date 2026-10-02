import { useEffect, useState } from 'react';
import { getFeed, getProfileSummary, setFollow, setKudo, useCloudQuery, useMyProfile, type FeedItem } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { ActivityCard, fromFeed } from '../components/activity';
import { Avatar, TierBadge } from '../components/people';
import { PostCard } from '../components/posts';
import { Card, ErrorBox, Seg, Sheet, toast } from '../components/ui';
import { getPosts, setBlocked, type PostRow } from '../cloud/posts';
import { mediaUrl } from '../cloud/api';
import { MEDAL_BY_KEY } from '../lib/medals';
import { SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';

/** Profil eines anderen Mitglieds. */
export function AthleteView({ id }: { id?: string }) {
  const { profile: me } = useMyProfile();
  const summary = useCloudQuery(id && cloudEnabled ? () => getProfileSummary(id) : null, [id]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [tab, setTab] = useState<'aktivitaeten' | 'beitraege'>('aktivitaeten');
  const [open, setOpen] = useState<PostRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || !cloudEnabled) return;
    getFeed('user', undefined, id, 30).then(setItems).catch(() => setItems([]));
    getPosts('user', undefined, id, 50).then(setPosts).catch(() => setPosts([]));
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
          <div className="grid-2">
            <button className={`btn ${s.is_following ? '' : 'primary'}`} onClick={follow} disabled={busy}>
              {s.is_following ? 'Entfolgen' : 'Folgen'}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`${s.profile.display_name} blockieren? Ihr seht gegenseitig keine Beiträge mehr und folgt euch nicht mehr. Aufheben unter Konto.`)) return;
                try {
                  await setBlocked(s.profile.id, true);
                  toast(`${s.profile.display_name} blockiert`);
                  setPosts([]);
                  summary.reload();
                } catch (err) {
                  toast(cloudError(err));
                }
              }}
            >
              Blockieren
            </button>
          </div>
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
      <Seg
        label="Inhalte"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'aktivitaeten', label: `Aktivitäten (${items.length})` },
          { value: 'beitraege', label: `Beiträge (${posts.length})` },
        ]}
      />
      {tab === 'beitraege' && (
        <>
          {posts.length > 0 ? (
            <div className="post-grid">
              {posts.map((p) => (
                <button key={p.id} onClick={() => setOpen(p)} aria-label={p.caption ?? 'Beitrag öffnen'}>
                  <img src={mediaUrl(p.thumb_path ?? p.media_path)} alt="" loading="lazy" />
                  {p.duration_s ? <span className="post-duration">▶ {Math.round(p.duration_s)} s</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">Noch keine Beiträge.</div>
          )}
          {open && (
            <Sheet title="Beitrag" onClose={() => setOpen(null)}>
              <PostCard
                post={open}
                onChange={(p) => {
                  setOpen(p);
                  setPosts((xs) => xs.map((x) => (x.id === p.id ? p : x)));
                }}
                onRemove={() => {
                  setPosts((xs) => xs.filter((x) => x.id !== open.id));
                  setOpen(null);
                }}
              />
            </Sheet>
          )}
        </>
      )}
      {tab === 'aktivitaeten' && items.map((it) => (
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
      {tab === 'aktivitaeten' && items.length === 0 && <div className="empty">Keine sichtbaren Aktivitäten.</div>}
    </div>
  );
}
