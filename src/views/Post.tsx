import { useState } from 'react';
import { addComment, deleteComment, getPost, listComments, listKudos, setKudo, useCloudQuery, useMyProfile } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { activityStats, fromFeed, whenLabel } from '../components/activity';
import { IconComment, IconHeart, IconSend, IconTrash } from '../components/icons';
import { Avatar } from '../components/people';
import { RouteMap } from '../components/RouteMap';
import { Card, ErrorBox, Stat, toast } from '../components/ui';
import { SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';

/** Aktivität aus der Community mit Kudos und Kommentaren. */
export function PostView({ id }: { id?: string }) {
  const { profile } = useMyProfile();
  const post = useCloudQuery(id && cloudEnabled ? () => getPost(id) : null, [id]);
  const comments = useCloudQuery(id && cloudEnabled ? () => listComments(id) : null, [id]);
  const kudos = useCloudQuery(id && cloudEnabled ? () => listKudos(id) : null, [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!cloudEnabled) return <div className="content empty">Kein Community-Server eingerichtet.</div>;
  if (post.error) return <div className="content"><ErrorBox>{cloudError({ message: post.error })}</ErrorBox></div>;
  if (!post.data) return <div className="content empty">{post.loading ? 'Lade …' : 'Aktivität nicht gefunden oder nicht sichtbar.'}</div>;
  const p = post.data;
  const card = fromFeed(p);
  const def = SPORT_DEFS[p.sport];

  const toggleKudo = async () => {
    try {
      await setKudo(p.id, !p.has_kudo);
      post.reload();
      kudos.reload();
    } catch (err) {
      toast(cloudError(err));
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addComment(p.id, text);
      setText('');
      comments.reload();
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <a className="row" href={`#/athlet/${p.user_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <Avatar name={p.display_name} url={p.avatar_url} size={44} />
        <div>
          <strong>{p.display_name}</strong>
          <div className="tiny muted">
            {def.emoji} {def.label} · {whenLabel(card.startTime)}
            {p.region_name ? ` · ${p.region_name}` : ''}
          </div>
        </div>
      </a>
      <div>
        <h1>{p.title}</h1>
        {p.description && <p className="text-2" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{p.description}</p>}
      </div>
      {card.route && card.route.length > 1 && <RouteMap points={card.route} />}
      <Card>
        <div className="grid-3">
          {activityStats(card).map((s) => (
            <Stat key={s.label} tile label={s.label} value={s.value} />
          ))}
          {p.kcal ? <Stat tile label="Kalorien" value={`${fmt(p.kcal)} kcal`} /> : null}
          <Stat tile label="Punkte" value={`+${fmt(p.points)}`} />
        </div>
        {card.strength && card.strength.length > 0 && (
          <table className="data-table">
            <tbody>
              {card.strength.map((s) => (
                <tr key={s.exercise}>
                  <td>{s.exercise}</td>
                  <td>{s.sets} Sätze</td>
                  <td>{s.topWeight > 0 ? `${fmt(s.topWeight, 1)} × ${s.topReps}` : `${s.reps} Wdh.`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {card.photoUrl && <img src={card.photoUrl} alt="Foto zur Aktivität" className="photo-full" />}

      <div className="row">
        <button className={`btn kudo ${p.has_kudo ? 'on' : ''}`} onClick={toggleKudo} disabled={!profile} aria-pressed={p.has_kudo}>
          <IconHeart filled={p.has_kudo} /> {p.kudos} Kudos
        </button>
        <span className="small muted">
          <IconComment className="inline-icon" /> {comments.data?.length ?? p.comments}
        </span>
      </div>
      {kudos.data && kudos.data.length > 0 && (
        <p className="tiny muted">
          Kudos von {kudos.data.slice(0, 5).map((k) => k.profiles?.display_name).filter(Boolean).join(', ')}
          {kudos.data.length > 5 ? ` und ${kudos.data.length - 5} weiteren` : ''}
        </p>
      )}

      <Card title="Kommentare">
        {(comments.data ?? []).map((c) => (
          <div key={c.id} className="comment">
            <Avatar name={c.profiles?.display_name ?? '?'} url={c.profiles?.avatar_url} size={32} />
            <div className="grow">
              <div className="small">
                <strong>{c.profiles?.display_name ?? 'Unbekannt'}</strong>{' '}
                <span className="tiny muted">{new Date(c.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {c.body}
              </div>
            </div>
            {profile && (c.user_id === profile.id || p.user_id === profile.id) && (
              <button
                className="icon-btn sm"
                aria-label="Kommentar löschen"
                onClick={async () => {
                  await deleteComment(c.id).catch((err) => toast(cloudError(err)));
                  comments.reload();
                }}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
        {comments.data?.length === 0 && <p className="small muted">Noch keine Kommentare.</p>}
        {profile ? (
          <div className="composer-row">
            <textarea className="input" rows={1} maxLength={500} placeholder="Kommentar schreiben …" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" onClick={send} disabled={busy || !text.trim()} aria-label="Senden">
              <IconSend />
            </button>
          </div>
        ) : (
          <a href="#/konto" className="small">
            Anmelden, um zu kommentieren
          </a>
        )}
      </Card>
    </div>
  );
}
