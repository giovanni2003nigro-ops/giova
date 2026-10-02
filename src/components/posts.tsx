import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { checkPost, verdictOk, type PostVerdict } from '../ai/postCheck';
import { mediaUrl } from '../cloud/api';
import { cloudError, currentUserId } from '../cloud/client';
import {
  addPostComment,
  createPost,
  deletePost,
  deletePostComment,
  listPostComments,
  moderatePost,
  moderationMode,
  reportPost,
  setBlocked,
  setPostLike,
  type ModerationMode,
  type PostCommentRow,
  type PostRow,
} from '../cloud/posts';
import { useApiKey, useObjectUrl } from '../hooks';
import { compressImage } from '../lib/image';
import {
  CATEGORY_DEFS,
  IMAGE_TYPES,
  MAX_CAPTION,
  MAX_VIDEO_SECONDS,
  POST_CATEGORIES,
  REPORT_REASONS,
  STATUS_LABELS,
  validatePost,
  VIDEO_TYPES,
  type PostCategory,
  type ReportReason,
} from '../lib/postRules';
import { SPORT_DEFS } from '../lib/sports';
import { videoInfo } from '../lib/video';
import type { Sport } from '../types';
import { SPORTS } from '../types';
import { whenLabel } from './activity';
import { IconComment, IconHeart, IconImage, IconSend, IconTrash } from './icons';
import { Avatar } from './people';
import { ErrorBox, Sheet, toast } from './ui';

// ------------------------------------------------------------------ Beitrag erstellen

interface Picked {
  file: Blob;
  type: string;
  preview: Blob;
  frames: Blob[];
  durationSec?: number;
  width?: number;
  height?: number;
}

/**
 * Neuer Sport-Beitrag: Foto/Video wählen, Pflicht-Kategorie, KI-Prüfung, hochladen.
 * Was nicht nach Sport aussieht, wird gar nicht erst hochgeladen.
 */
export function PostComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const apiKey = useApiKey();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [category, setCategory] = useState<PostCategory | ''>('');
  const [sport, setSport] = useState<Sport | ''>('');
  const [caption, setCaption] = useState('');
  const [step, setStep] = useState<'' | 'lesen' | 'pruefen' | 'hochladen'>('');
  const [verdict, setVerdict] = useState<PostVerdict | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ModerationMode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrl = useObjectUrl(picked?.preview);

  useEffect(() => {
    moderationMode()
      .then(setMode)
      .catch(() => setMode('client'));
    return () => abortRef.current?.abort();
  }, []);

  const pick = async (f: File) => {
    setError('');
    setVerdict(null);
    setStep('lesen');
    try {
      if (VIDEO_TYPES.includes(f.type)) {
        const info = await videoInfo(f);
        if (info.durationSec > MAX_VIDEO_SECONDS) throw new Error(`Videos dürfen höchstens ${MAX_VIDEO_SECONDS} Sekunden lang sein (dieses: ${Math.round(info.durationSec)} s).`);
        setPicked({ file: f, type: f.type, preview: info.frames[0], frames: info.frames, durationSec: info.durationSec, width: info.width, height: info.height });
      } else if (IMAGE_TYPES.includes(f.type) || f.type.startsWith('image/')) {
        const img = await compressImage(f, 1600, 0.86);
        const bmp = await createImageBitmap(img);
        setPicked({ file: img, type: 'image/jpeg', preview: img, frames: [img], width: bmp.width, height: bmp.height });
        bmp.close();
      } else throw new Error('Nur Fotos oder Videos.');
    } catch (err) {
      setPicked(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStep('');
    }
  };

  const submit = async () => {
    const problem = validatePost({ category, caption, mediaType: picked?.type, durationSec: picked?.durationSec, sizeBytes: picked?.file.size });
    if (problem || !picked || !category) return setError(problem ?? 'Bitte alles ausfüllen.');
    setError('');
    let v: PostVerdict | null = null;
    // Client-Modus: erst prüfen, dann hochladen – abgelehnte Inhalte verlassen das Handy nicht
    if (mode !== 'server' && apiKey) {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStep('pruefen');
      try {
        v = await checkPost(apiKey, { images: picked.frames, caption, category, sport: sport || null, video: picked.type.startsWith('video/') }, ctrl.signal);
      } catch (err) {
        setStep('');
        return setError(errorMessage(err));
      }
      setVerdict(v);
      if (!verdictOk(v)) {
        setStep('');
        return;
      }
    }
    setStep('hochladen');
    try {
      const status = await createPost({
        media: picked.file,
        mediaType: picked.type,
        thumb: picked.type.startsWith('video/') ? picked.preview : undefined,
        frames: picked.type.startsWith('video/') ? picked.frames : undefined,
        durationSec: picked.durationSec,
        width: picked.width,
        height: picked.height,
        category,
        sport: sport || null,
        caption,
        verdict: v,
      });
      toast(status === 'sichtbar' ? 'Beitrag veröffentlicht 🎉' : status === 'abgelehnt' ? 'Beitrag abgelehnt – kein Sportbezug erkannt' : 'Beitrag wird geprüft');
      onPosted();
      onClose();
    } catch (err) {
      setError(cloudError(err));
    } finally {
      setStep('');
    }
  };

  const busy = step !== '';
  return (
    <Sheet title="Sport-Beitrag posten" onClose={onClose}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = '';
        }}
      />
      <button className={`post-pick ${previewUrl ? 'has' : ''}`} onClick={() => fileRef.current?.click()} disabled={busy}>
        {previewUrl ? (
          <>
            <img src={previewUrl} alt="Vorschau" />
            {picked?.durationSec && <span className="post-duration">▶ {Math.round(picked.durationSec)} s</span>}
          </>
        ) : (
          <span className="stack" style={{ alignItems: 'center' }}>
            <IconImage width={32} height={32} />
            <span>{step === 'lesen' ? 'Lese …' : 'Foto oder Video (max. 60 s) wählen'}</span>
          </span>
        )}
      </button>

      <div className="field">
        <span>Kategorie (Pflicht – nur Sport)</span>
        <div className="chips wrap">
          {POST_CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)} title={CATEGORY_DEFS[c].hint}>
              {CATEGORY_DEFS[c].emoji} {CATEGORY_DEFS[c].label}
            </button>
          ))}
        </div>
        {category && <span className="tiny muted">{CATEGORY_DEFS[category].hint}</span>}
      </div>
      <label className="field">
        <span>Sportart (optional)</span>
        <select className="input" value={sport} onChange={(e) => setSport(e.target.value as Sport | '')}>
          <option value="">–</option>
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {SPORT_DEFS[s].emoji} {SPORT_DEFS[s].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Text</span>
        <textarea className="input" rows={3} maxLength={MAX_CAPTION} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="z. B. Neue 5-km-Bestzeit: 19:42 🔥" />
      </label>

      {verdict && !verdictOk(verdict) && (
        <ErrorBox>
          <strong>Nicht veröffentlicht:</strong> {verdict.grund || 'Kein klarer Sportbezug erkannt.'}
          {verdict.erkannt && <div className="small">Erkannt: {verdict.erkannt}</div>}
        </ErrorBox>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      <button className="btn primary block" onClick={submit} disabled={busy || !picked}>
        {step === 'pruefen' ? 'KI prüft auf Sportbezug …' : step === 'hochladen' ? 'Lade hoch …' : mode === 'server' || apiKey ? 'Prüfen & posten' : 'Zur Prüfung einreichen'}
      </button>
      <p className="tiny muted">
        Erlaubt sind nur Sport-Inhalte: Rekorde, Technik, Training, Wettkämpfe, Sportoutfits, Motivation, Sporternährung. Jeder Beitrag wird{' '}
        {mode === 'server' ? 'vom Server per KI geprüft' : apiKey ? 'vor dem Hochladen per KI geprüft' : 'ohne KI-Schlüssel von einem Moderator geprüft'}; gemeldete
        Beiträge werden ausgeblendet. Keine Links.
      </p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Beitragskarte

export function PostCard({ post, onChange, onRemove }: { post: PostRow; onChange: (p: PostRow) => void; onRemove: () => void }) {
  const [comments, setComments] = useState(false);
  const [menu, setMenu] = useState(false);
  const mine = post.user_id === currentUserId();
  const video = post.media_type.startsWith('video/');
  const cat = CATEGORY_DEFS[post.category];

  const like = async () => {
    const on = !post.has_like;
    onChange({ ...post, has_like: on, likes: post.likes + (on ? 1 : -1) });
    try {
      await setPostLike(post.id, on);
    } catch (err) {
      onChange(post);
      toast(cloudError(err));
    }
  };

  return (
    <article className="card post-card">
      <div className="row" style={{ gap: 10 }}>
        <a href={`#/athlet/${post.user_id}`} aria-label={post.display_name}>
          <Avatar name={post.display_name} url={post.avatar_url} size={40} />
        </a>
        <div className="grow">
          <a href={`#/athlet/${post.user_id}`} className="small author">
            {post.display_name}
          </a>
          <div className="tiny muted">
            {whenLabel(Date.parse(post.created_at))}
            {post.sport ? ` · ${SPORT_DEFS[post.sport].emoji} ${SPORT_DEFS[post.sport].label}` : ''}
          </div>
        </div>
        <span className="badge">
          {cat.emoji} {cat.label}
        </span>
        <button className="icon-btn sm" onClick={() => setMenu(true)} aria-label="Mehr">
          ⋯
        </button>
      </div>
      {post.status !== 'sichtbar' && (
        <div className={`post-status ${post.status}`}>
          {STATUS_LABELS[post.status]}
          {post.moderation?.grund ? ` – ${post.moderation.grund}` : ''}
          {post.moderation?.note ? ` – ${post.moderation.note}` : ''}
        </div>
      )}
      <div className="post-media">
        {video ? (
          <video src={mediaUrl(post.media_path)} poster={mediaUrl(post.thumb_path)} controls playsInline preload="none" />
        ) : (
          <img src={mediaUrl(post.media_path)} alt={post.caption ?? `${cat.label}-Beitrag`} loading="lazy" />
        )}
      </div>
      {post.caption && <p className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{post.caption}</p>}
      <div className="row">
        <button className={`btn small kudo ${post.has_like ? 'on' : ''}`} onClick={like} disabled={post.status !== 'sichtbar'} aria-pressed={post.has_like}>
          <IconHeart filled={post.has_like} /> {post.likes}
        </button>
        <button className="btn small" onClick={() => setComments(true)}>
          <IconComment /> {post.comments}
        </button>
      </div>
      {comments && <PostCommentsSheet post={post} onClose={() => setComments(false)} onCount={(n) => onChange({ ...post, comments: n })} />}
      {menu && <PostMenu post={post} mine={mine} onClose={() => setMenu(false)} onRemove={onRemove} />}
    </article>
  );
}

function PostMenu({ post, mine, onClose, onRemove }: { post: PostRow; mine: boolean; onClose: () => void; onRemove: () => void }) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>, msg: string, remove = false) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      if (remove) onRemove();
      onClose();
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={mine ? 'Dein Beitrag' : 'Beitrag'} onClose={onClose}>
      {mine ? (
        <button className="btn danger block" disabled={busy} onClick={() => confirm('Beitrag löschen?') && act(() => deletePost(post), 'Beitrag gelöscht', true)}>
          <IconTrash /> Beitrag löschen
        </button>
      ) : (
        <>
          <div className="field">
            <span>Melden – warum?</span>
            <div className="stack">
              {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
                <label key={r} className="check">
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  {REPORT_REASONS[r]}
                </label>
              ))}
            </div>
          </div>
          {reason && <input className="input" maxLength={300} placeholder="Anmerkung (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
          <button className="btn block" disabled={!reason || busy} onClick={() => reason && act(() => reportPost(post.id, reason, note), 'Danke – wir schauen uns das an.', true)}>
            Beitrag melden
          </button>
          <button
            className="btn danger block"
            disabled={busy}
            onClick={() =>
              confirm(`${post.display_name} blockieren? Ihr seht gegenseitig keine Beiträge mehr und folgt euch nicht mehr.`) &&
              act(() => setBlocked(post.user_id, true), `${post.display_name} blockiert`, true)
            }
          >
            {post.display_name} blockieren
          </button>
          <p className="tiny muted">Nach mehreren Meldungen wird ein Beitrag automatisch ausgeblendet, bis ein Moderator ihn prüft.</p>
        </>
      )}
    </Sheet>
  );
}

function PostCommentsSheet({ post, onClose, onCount }: { post: PostRow; onClose: () => void; onCount: (n: number) => void }) {
  const [list, setList] = useState<PostCommentRow[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const me = currentUserId();
  const load = async () => {
    try {
      const rows = await listPostComments(post.id);
      setList(rows);
      onCount(rows.length);
    } catch (err) {
      toast(cloudError(err));
      setList([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  const send = async () => {
    if (!text.trim()) return;
    if (/(https?:\/\/|www\.)/i.test(text)) return toast('Links sind nicht erlaubt.');
    setBusy(true);
    try {
      await addPostComment(post.id, text);
      setText('');
      await load();
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Kommentare" onClose={onClose}>
      {list === null && <div className="empty">Lade …</div>}
      {list?.length === 0 && <p className="small muted">Noch keine Kommentare.</p>}
      {list?.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.profiles?.display_name ?? '?'} url={c.profiles?.avatar_url} size={32} />
          <div className="grow">
            <div className="small">
              <strong>{c.profiles?.display_name ?? 'Unbekannt'}</strong> <span className="tiny muted">{whenLabel(Date.parse(c.created_at))}</span>
            </div>
            <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {c.body}
            </div>
          </div>
          {me && (c.user_id === me || post.user_id === me) && (
            <button
              className="icon-btn sm"
              aria-label="Kommentar löschen"
              onClick={async () => {
                await deletePostComment(c.id).catch((err) => toast(cloudError(err)));
                void load();
              }}
            >
              <IconTrash />
            </button>
          )}
        </div>
      ))}
      {me && post.status === 'sichtbar' && (
        <div className="composer-row">
          <textarea className="input" rows={1} maxLength={500} placeholder="Kommentar schreiben …" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" onClick={send} disabled={busy || !text.trim()} aria-label="Senden">
            <IconSend />
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ Moderation

/** Für Moderatoren: wartende und gemeldete Beiträge freigeben, ablehnen oder sperren. */
export function ReviewCard({ post, onDone }: { post: PostRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (status: 'sichtbar' | 'abgelehnt' | 'gesperrt') => {
    setBusy(true);
    try {
      await moderatePost(post.id, status, note);
      toast(status === 'sichtbar' ? 'Freigegeben' : status === 'abgelehnt' ? 'Abgelehnt' : 'Gesperrt');
      onDone();
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <PostCard post={post} onChange={() => undefined} onRemove={onDone} />
      <div className="card tight">
        <div className="small">
          <strong>{STATUS_LABELS[post.status]}</strong> · {post.report_count} Meldung{post.report_count === 1 ? '' : 'en'}
          {post.moderation?.mode ? ` · Prüfung: ${post.moderation.mode}` : ''}
        </div>
        {post.moderation?.erkannt && <div className="tiny muted">KI erkannt: {post.moderation.erkannt}</div>}
        <input className="input" placeholder="Begründung (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <div className="grid-3">
          <button className="btn primary" disabled={busy} onClick={() => decide('sichtbar')}>
            Freigeben
          </button>
          <button className="btn" disabled={busy} onClick={() => decide('abgelehnt')}>
            Ablehnen
          </button>
          <button className="btn danger" disabled={busy} onClick={() => decide('gesperrt')}>
            Sperren
          </button>
        </div>
      </div>
    </div>
  );
}

