import type { PostVerdict } from '../ai/postCheck';
import type { PostCategory, PostStatus, ReportReason } from '../lib/postRules';
import { newUid } from '../lib/sports';
import type { Sport } from '../types';
import { uploadMedia } from './api';
import { currentUserId, requireCloud } from './client';

export interface PostRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  category: PostCategory;
  sport: Sport | null;
  caption: string | null;
  media_type: string;
  media_path: string;
  thumb_path: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  activity_id: string | null;
  status: PostStatus;
  moderation: Partial<PostVerdict> & { mode?: string; note?: string; reviewed_at?: string };
  report_count: number;
  created_at: string;
  likes: number;
  comments: number;
  has_like: boolean;
}

export interface PostCommentRow {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { username: string; display_name: string; avatar_url: string | null } | null;
}

export type PostScope = 'all' | 'following' | 'me' | 'user' | 'review';
export type ModerationMode = 'client' | 'server' | 'manuell';

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export async function getPosts(scope: PostScope, before?: string, userId?: string, limit = 20): Promise<PostRow[]> {
  return check(await requireCloud().rpc('get_posts', { p_scope: scope, p_before: before ?? null, p_limit: limit, p_user: userId ?? null })) as PostRow[];
}

/** Wie wird geprüft? (vom Betreiber in app_config eingestellt) */
export async function moderationMode(): Promise<ModerationMode> {
  const row = check(await requireCloud().from('app_config').select('value').eq('key', 'moderation').maybeSingle()) as { value: { mode?: ModerationMode } } | null;
  return row?.value.mode ?? 'client';
}

export async function amModerator(): Promise<boolean> {
  const uid = currentUserId();
  if (!uid) return false;
  const row = check(await requireCloud().from('moderators').select('user_id').eq('user_id', uid).maybeSingle());
  return !!row;
}

export interface NewPost {
  media: Blob;
  mediaType: string;
  thumb?: Blob;
  /** Video: Einzelbilder (Anfang, Mitte, Ende) */
  frames?: Blob[];
  durationSec?: number;
  width?: number;
  height?: number;
  category: PostCategory;
  sport: Sport | null;
  caption: string;
  verdict: PostVerdict | null;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

/** Lädt Medien in den eigenen Ordner und legt den Beitrag an. Der Server entscheidet über den Status. */
export async function createPost(p: NewPost): Promise<PostRow['status']> {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  const key = newUid();
  const media_path = await uploadMedia(`${uid}/posts/${key}.${EXT[p.mediaType] ?? 'bin'}`, p.media);
  const thumb_path = p.thumb ? await uploadMedia(`${uid}/posts/${key}-thumb.jpg`, p.thumb) : null;
  // Weitere Einzelbilder (Mitte, Ende) für die Server-Prüfung von Videos
  for (const [i, f] of (p.frames ?? []).slice(1, 3).entries()) await uploadMedia(`${uid}/posts/${key}-f${i + 1}.jpg`, f);
  const row = check(
    await sb
      .from('posts')
      .insert({
        user_id: uid,
        category: p.category,
        sport: p.sport,
        caption: p.caption.trim() || null,
        media_type: p.mediaType,
        media_path,
        thumb_path,
        duration_s: p.durationSec ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
        moderation: p.verdict ?? {},
      })
      .select('id, status')
      .single(),
  ) as { id: string; status: PostStatus };
  // Server-Modus: Edge Function prüft mit dem Schlüssel des Betreibers
  if (row.status === 'pruefung' && (await moderationMode()) === 'server') {
    await sb.functions.invoke('moderate-post', { body: { id: row.id } }).catch(() => undefined);
    const fresh = check(await sb.from('posts').select('status').eq('id', row.id).maybeSingle()) as { status: PostStatus } | null;
    return fresh?.status ?? row.status;
  }
  return row.status;
}

export async function deletePost(p: Pick<PostRow, 'id' | 'media_path' | 'thumb_path' | 'user_id'>) {
  const sb = requireCloud();
  check(await sb.from('posts').delete().eq('id', p.id));
  if (p.user_id !== currentUserId()) return;
  const base = p.media_path.replace(/\.[a-z0-9]+$/i, '');
  await sb.storage.from('media').remove([p.media_path, ...(p.thumb_path ? [p.thumb_path, `${base}-f1.jpg`, `${base}-f2.jpg`] : [])]);
}

export async function setPostLike(postId: string, on: boolean) {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  if (on) check(await sb.from('post_likes').upsert({ post_id: postId, user_id: uid }, { ignoreDuplicates: true }));
  else check(await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', uid));
}

export async function listPostComments(postId: string): Promise<PostCommentRow[]> {
  return check(
    await requireCloud()
      .from('post_comments')
      .select('id, post_id, user_id, body, created_at, profiles(username, display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at'),
  ) as unknown as PostCommentRow[];
}

export async function addPostComment(postId: string, body: string) {
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  check(await requireCloud().from('post_comments').insert({ post_id: postId, user_id: uid, body: body.trim().slice(0, 500) }));
}

export async function deletePostComment(id: string) {
  check(await requireCloud().from('post_comments').delete().eq('id', id));
}

export async function reportPost(postId: string, reason: ReportReason, note?: string) {
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  const res = await requireCloud().from('post_reports').insert({ post_id: postId, user_id: uid, reason, note: note?.trim().slice(0, 300) || null });
  // Schon gemeldet → kein Fehler für den Nutzer
  if (res.error && (res.error as { code?: string }).code !== '23505') throw res.error;
}

export async function setBlocked(userId: string, on: boolean) {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  if (on) check(await sb.from('blocks').upsert({ blocker_id: uid, blocked_id: userId }, { ignoreDuplicates: true }));
  else check(await sb.from('blocks').delete().eq('blocker_id', uid).eq('blocked_id', userId));
}

export async function listBlocked() {
  const uid = currentUserId();
  if (!uid) return [];
  return check(
    await requireCloud().from('blocks').select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(username, display_name, avatar_url)').eq('blocker_id', uid),
  ) as unknown as { blocked_id: string; created_at: string; profiles: { username: string; display_name: string; avatar_url: string | null } | null }[];
}

export async function moderatePost(id: string, status: 'sichtbar' | 'abgelehnt' | 'gesperrt', note?: string) {
  check(await requireCloud().rpc('moderate_post', { p_id: id, p_status: status, p_note: note ?? null }));
}
