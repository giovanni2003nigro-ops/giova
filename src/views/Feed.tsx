import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getFeed, searchProfiles, setFollow, setKudo, useMyProfile, type CloudProfile, type FeedItem, type FeedScope } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { ActivityCard, fromFeed, fromLocal } from '../components/activity';
import { IconPlus, IconSearch } from '../components/icons';
import { PostCard, PostComposer, ReviewCard } from '../components/posts';
import { amModerator, getPosts, type PostRow, type PostScope } from '../cloud/posts';
import { Avatar } from '../components/people';
import { Card, ErrorBox, Seg, toast } from '../components/ui';
import { db } from '../db';

/** Community-Feed: Aktivitäten von Leuten, denen du folgst, aus deiner Umgebung oder von allen. */
export function FeedView() {
  const { profile } = useMyProfile();
  if (!cloudEnabled || profile === null) return <LocalFeed loggedOut={cloudEnabled} />;
  if (profile === undefined) return <div className="content empty">Lade …</div>;
  return <CommunityTabs />;
}

/** Aktivitäten (Strava-Stil) und Sport-Beiträge (Fotos/Videos) */
function CommunityTabs() {
  const [tab, setTab] = useState<'aktivitaeten' | 'beitraege'>(() => {
    try {
      return sessionStorage.getItem('feedTab') === 'beitraege' ? 'beitraege' : 'aktivitaeten';
    } catch {
      return 'aktivitaeten';
    }
  });
  return (
    <>
      <div className="content" style={{ paddingBottom: 0 }}>
        <Seg
          label="Community"
          value={tab}
          onChange={(t) => {
            setTab(t);
            try {
              sessionStorage.setItem('feedTab', t);
            } catch {
              /* egal */
            }
          }}
          options={[
            { value: 'aktivitaeten', label: 'Aktivitäten' },
            { value: 'beitraege', label: 'Beiträge' },
          ]}
        />
      </div>
      {tab === 'aktivitaeten' ? <CloudFeed /> : <PostsFeed />}
    </>
  );
}

/** Sport-Beiträge: nur Sport, KI-geprüft, meldbar. */
function PostsFeed() {
  const [scope, setScope] = useState<PostScope>('all');
  const [items, setItems] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [compose, setCompose] = useState(false);
  const [moderator, setModerator] = useState(false);

  useEffect(() => {
    amModerator()
      .then(setModerator)
      .catch(() => setModerator(false));
  }, []);

  const load = async (reset: boolean) => {
    setLoading(true);
    setError('');
    try {
      const before = reset ? undefined : items[items.length - 1]?.created_at;
      const page = await getPosts(scope, before);
      setItems((xs) => (reset ? page : [...xs, ...page]));
      setDone(page.length < 20);
    } catch (err) {
      setError(cloudError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const update = (p: PostRow) => setItems((xs) => xs.map((x) => (x.id === p.id ? p : x)));
  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));

  return (
    <div className="content">
      <div className="row">
        <div className="grow">
          <Seg
            label="Beiträge"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Alle' },
              { value: 'following', label: 'Folge ich' },
              { value: 'me', label: 'Meine' },
              ...(moderator ? [{ value: 'review' as const, label: 'Prüfen' }] : []),
            ]}
          />
        </div>
        <button className="btn primary" onClick={() => setCompose(true)} aria-label="Beitrag posten">
          <IconPlus />
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {scope === 'review'
        ? items.map((p) => <ReviewCard key={p.id} post={p} onDone={() => remove(p.id)} />)
        : items.map((p) => <PostCard key={p.id} post={p} onChange={update} onRemove={() => remove(p.id)} />)}
      {!loading && items.length === 0 && !error && (
        <div className="empty">
          {scope === 'review' ? 'Nichts zu prüfen. ✓' : scope === 'me' ? 'Du hast noch nichts gepostet.' : 'Noch keine Beiträge.'}{' '}
          {scope !== 'review' && (
            <button className="linklike" onClick={() => setCompose(true)}>
              Zeig deinen Rekord, deine Technik oder dein Sportoutfit.
            </button>
          )}
        </div>
      )}
      {loading && <div className="empty">Lade …</div>}
      {!loading && !done && items.length > 0 && (
        <button className="btn" onClick={() => load(false)}>
          Mehr laden
        </button>
      )}
      {compose && <PostComposer onClose={() => setCompose(false)} onPosted={() => (scope === 'me' ? load(true) : setScope('me'))} />}
    </div>
  );
}

function LocalFeed({ loggedOut }: { loggedOut: boolean }) {
  const list = useLiveQuery(() => db.activities.orderBy('startTime').reverse().limit(30).toArray(), []) ?? [];
  return (
    <div className="content">
      <Card title={loggedOut ? 'Werde Teil der Community' : 'Community'}>
        {loggedOut ? (
          <>
            <p className="small text-2">
              Teile Läufe, Schwimmeinheiten, Hyrox- und Gym-Sessions, folge Freunden, gib Kudos und miss dich in Ligen mit Leuten aus deiner Umgebung.
            </p>
            <a className="btn primary" href="#/konto">
              Konto erstellen / anmelden
            </a>
          </>
        ) : (
          <p className="small text-2">
            Für Feed, Kudos und Ranglisten braucht die App einen Community-Server (Supabase). Wie das geht, steht in der README. Bis dahin siehst du hier deine
            eigenen Aktivitäten.
          </p>
        )}
      </Card>
      {list.length === 0 && (
        <div className="empty">
          Noch keine Aktivitäten – <a href="#/aufzeichnen">jetzt aufzeichnen</a>.
        </div>
      )}
      {list.map((a) => (
        <ActivityCard key={a.id} a={fromLocal(a)} />
      ))}
    </div>
  );
}

function CloudFeed() {
  const [scope, setScope] = useState<FeedScope>('following');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(false);

  const load = async (reset: boolean) => {
    setLoading(true);
    setError('');
    try {
      const before = reset ? undefined : items[items.length - 1]?.started_at;
      const page = await getFeed(scope, before);
      setItems((xs) => (reset ? page : [...xs, ...page]));
      setDone(page.length < 20);
    } catch (err) {
      setError(cloudError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const kudo = async (it: FeedItem) => {
    const on = !it.has_kudo;
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, has_kudo: on, kudos: x.kudos + (on ? 1 : -1) } : x)));
    try {
      await setKudo(it.id, on);
    } catch (err) {
      toast(cloudError(err));
      setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
    }
  };

  return (
    <div className="content">
      <div className="row">
        <div className="grow">
          <Seg
            label="Feed"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'following', label: 'Folge ich' },
              { value: 'nearby', label: 'Umgebung' },
              { value: 'all', label: 'Alle' },
            ]}
          />
        </div>
        <button className="icon-btn" onClick={() => setSearch((v) => !v)} aria-label="Personen suchen" aria-pressed={search}>
          <IconSearch />
        </button>
      </div>
      {search && <PeopleSearch />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {items.map((it) => (
        <ActivityCard key={it.id} a={fromFeed(it)} onKudo={() => kudo(it)} />
      ))}
      {!loading && items.length === 0 && !error && (
        <div className="empty">
          {scope === 'following' ? (
            <>
              Noch nichts hier. Folge Leuten aus deiner <button className="linklike" onClick={() => setScope('nearby')}>Umgebung</button> oder teile deine erste
              Aktivität.
            </>
          ) : (
            'Noch keine Aktivitäten.'
          )}
        </div>
      )}
      {loading && <div className="empty">Lade …</div>}
      {!loading && !done && items.length > 0 && (
        <button className="btn" onClick={() => load(false)}>
          Mehr laden
        </button>
      )}
    </div>
  );
}

function PeopleSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<(CloudProfile & { following?: boolean })[]>([]);
  const { profile } = useMyProfile();
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    const id = setTimeout(() => {
      searchProfiles(q.trim())
        .then(setRes)
        .catch(() => setRes([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <Card className="tight">
      <input className="input" placeholder="Name oder @nutzername" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Personen suchen" autoFocus />
      <div className="list">
        {res
          .filter((p) => p.id !== profile?.id)
          .map((p) => (
            <div className="list-item" key={p.id}>
              <Avatar name={p.display_name} url={p.avatar_url} />
              <a className="main" href={`#/athlet/${p.id}`}>
                <div className="title">{p.display_name}</div>
                <div className="meta">
                  @{p.username}
                  {p.region_name ? ` · ${p.region_name}` : ''}
                </div>
              </a>
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    await setFollow(p.id, !p.following);
                    setRes((xs) => xs.map((x) => (x.id === p.id ? { ...x, following: !p.following } : x)));
                  } catch (err) {
                    toast(cloudError(err));
                  }
                }}
              >
                {p.following ? 'Entfolgen' : 'Folgen'}
              </button>
            </div>
          ))}
      </div>
    </Card>
  );
}
