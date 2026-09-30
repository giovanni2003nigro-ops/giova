import { useCallback, useEffect, useState } from 'react';
import { db } from '../db';
import { encodePolyline, simplify, trimEnds } from '../lib/geo';
import { MEDAL_BY_KEY } from '../lib/medals';
import type { Activity, Sport, Visibility } from '../types';
import { currentUserId, requireCloud, supabase, useSession } from './client';

// ------------------------------------------------------------------ Typen (Spiegel der Datenbank)

export interface CloudProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  sex: 'm' | 'w' | null;
  home_geohash: string | null;
  region_name: string | null;
  sports: Sport[];
  created_at: string;
}

export interface FeedItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  region_name: string | null;
  sport: Sport;
  title: string;
  description: string | null;
  started_at: string;
  local_date: string;
  duration_s: number;
  distance_m: number | null;
  elevation_m: number | null;
  avg_hr: number | null;
  kcal: number | null;
  polyline: string | null;
  metrics: RemoteMetrics;
  photo_path: string | null;
  visibility: Visibility;
  points: number;
  kudos: number;
  comments: number;
  has_kudo: boolean;
}

export interface RemoteMetrics {
  hyrox?: Activity['hyrox'];
  powerlifting?: Activity['powerlifting'];
  strength?: Activity['strength'];
}

export interface CommentRow {
  id: string;
  activity_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { username: string; display_name: string; avatar_url: string | null } | null;
}

export interface ProfileSummary {
  profile: Omit<CloudProfile, 'home_geohash'>;
  followers: number;
  following: number;
  is_following: boolean;
  follows_me: boolean;
  total_points: number;
  activities: number;
  medals: { key: string; period: string; earned_on: string; points: number }[];
  leagues: { sport: Sport; tier: number }[];
}

export interface LeagueMembership {
  user_id: string;
  sport: Sport;
  season: string;
  tier: number;
  group_id: number | null;
  points: number | null;
  final_rank: number | null;
  outcome: 'auf' | 'ab' | 'bleibt' | null;
  new_tier: number | null;
}

export interface StandingRow {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  region_name: string | null;
  points: number;
  tier: number;
  performance_tier: number;
  volume: number;
  intensity: number | null;
  zone: 'auf' | 'ab' | null;
  is_me: boolean;
  group_size: number;
  outcome: 'auf' | 'ab' | 'bleibt' | null;
  new_tier: number | null;
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  region_name: string | null;
  points: number;
  tier: number | null;
  is_me: boolean;
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

// ------------------------------------------------------------------ Konto & Profil

export async function signUp(email: string, password: string) {
  const res = await requireCloud().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (res.error) throw res.error;
  return res.data;
}

export async function signIn(email: string, password: string) {
  const res = await requireCloud().auth.signInWithPassword({ email, password });
  if (res.error) throw res.error;
  return res.data;
}

export async function sendPasswordReset(email: string) {
  const res = await requireCloud().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (res.error) throw res.error;
}

export async function updatePassword(password: string) {
  const res = await requireCloud().auth.updateUser({ password });
  if (res.error) throw res.error;
  return res.data;
}

export async function signOut() {
  await requireCloud().auth.signOut();
}

export async function getMyProfile(): Promise<CloudProfile | null> {
  const uid = currentUserId();
  if (!uid) return null;
  return check(await requireCloud().from('profiles').select('*').eq('id', uid).maybeSingle()) as CloudProfile | null;
}

export async function saveProfile(p: Omit<CloudProfile, 'created_at'>) {
  return check(await requireCloud().from('profiles').upsert(p).select().single()) as CloudProfile;
}

export async function deleteMyData() {
  check(await requireCloud().rpc('delete_my_data'));
  await db.activities.toCollection().modify({ remoteId: undefined, syncedAt: undefined });
  await db.medals.toCollection().modify({ synced: false });
}

// Profil wird an vielen Stellen gebraucht → kleiner gemeinsamer Zwischenspeicher
let profileCache: { uid: string; profile: CloudProfile | null } | null = null;
const profileListeners = new Set<() => void>();

export function invalidateProfile(p?: CloudProfile | null) {
  const uid = currentUserId();
  profileCache = p !== undefined && uid ? { uid, profile: p } : null;
  profileListeners.forEach((l) => l());
}

/** Eigenes Community-Profil: undefined = lädt, null = nicht angemeldet bzw. noch kein Profil. */
export function useMyProfile(): { profile: CloudProfile | null | undefined; reload: () => void } {
  const session = useSession();
  const uid = session?.user.id;
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    profileListeners.add(l);
    return () => {
      profileListeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (!uid || profileCache?.uid === uid) return;
    let alive = true;
    getMyProfile()
      .then((p) => {
        if (!alive) return;
        profileCache = { uid, profile: p };
        profileListeners.forEach((l) => l());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uid]);
  const reload = useCallback(() => invalidateProfile(), []);
  if (session === undefined) return { profile: undefined, reload };
  if (!uid) return { profile: null, reload };
  return { profile: profileCache?.uid === uid ? profileCache.profile : undefined, reload };
}

export async function uploadMedia(path: string, blob: Blob): Promise<string> {
  const sb = requireCloud();
  check(await sb.storage.from('media').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' }));
  return path;
}

export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path || !supabase) return undefined;
  if (/^https?:/.test(path)) return path;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------------ Aktivitäten teilen

/** Route für andere: vereinfacht und auf Wunsch ohne Start/Ziel. */
export function publicPolyline(a: Activity): string | null {
  if (!a.track || a.track.length < 2) return null;
  const pts = a.hideEnds ? trimEnds(a.track) : a.track;
  if (pts.length < 2) return null;
  return encodePolyline(simplify(pts, 4));
}

/** Lädt eine Aktivität hoch bzw. aktualisiert sie (idempotent über die lokale uid). */
export async function publishActivity(a: Activity, visibility: Visibility = a.visibility): Promise<string> {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  let photo_path: string | null = null;
  if (a.photo) photo_path = await uploadMedia(`${uid}/${a.uid}.jpg`, a.photo);
  const metrics: RemoteMetrics = {};
  if (a.hyrox) metrics.hyrox = a.hyrox;
  if (a.powerlifting) metrics.powerlifting = a.powerlifting;
  if (a.strength?.length) metrics.strength = a.strength.slice(0, 30);
  const row = {
    user_id: uid,
    client_uid: a.uid,
    sport: a.sport,
    title: a.title.slice(0, 100) || 'Aktivität',
    description: a.note?.slice(0, 2000) || null,
    started_at: new Date(a.startTime).toISOString(),
    local_date: a.date,
    duration_s: Math.max(1, Math.round(a.durationSec)),
    elapsed_s: a.elapsedSec != null ? Math.round(a.elapsedSec) : null,
    distance_m: a.distanceM != null ? Math.round(a.distanceM) : null,
    elevation_m: a.elevationGainM != null ? Math.round(a.elevationGainM) : null,
    avg_hr: a.avgHr ?? null,
    max_hr: a.maxHr ?? null,
    kcal: a.kcal ?? null,
    polyline: publicPolyline(a),
    metrics,
    photo_path,
    visibility,
  };
  const saved = check(await sb.from('activities').upsert(row, { onConflict: 'user_id,client_uid' }).select('id').single()) as { id: string };
  if (a.id != null) await db.activities.update(a.id, { remoteId: saved.id, syncedAt: Date.now(), visibility });
  return saved.id;
}

export async function unpublishActivity(a: Activity) {
  if (!a.remoteId) return;
  check(await requireCloud().from('activities').delete().eq('id', a.remoteId));
  if (a.id != null) await db.activities.update(a.id, { remoteId: undefined, syncedAt: undefined });
}

/** Meldet lokal verdiente Medaillen an den Server (doppelte werden ignoriert). */
export async function syncMedals(): Promise<number> {
  const uid = currentUserId();
  if (!supabase || !uid) return 0;
  const pending = (await db.medals.toArray()).filter((m) => !m.synced && MEDAL_BY_KEY.has(m.key));
  if (!pending.length) return 0;
  check(
    await supabase.from('user_medals').upsert(
      pending.map((m) => ({ user_id: uid, medal_key: m.key, period: m.period, earned_on: m.date })),
      { onConflict: 'user_id,medal_key,period', ignoreDuplicates: true },
    ),
  );
  await db.medals.bulkUpdate(pending.map((m) => ({ key: m.id, changes: { synced: true } })));
  return pending.length;
}

// ------------------------------------------------------------------ Feed, Kudos, Kommentare

export type FeedScope = 'following' | 'nearby' | 'all' | 'me' | 'user';

export async function getFeed(scope: FeedScope, before?: string, userId?: string, limit = 20): Promise<FeedItem[]> {
  return check(
    await requireCloud().rpc('get_feed', { p_scope: scope, p_before: before ?? null, p_limit: limit, p_user: userId ?? null }),
  ) as FeedItem[];
}

export async function getPost(id: string): Promise<FeedItem | null> {
  const sb = requireCloud();
  const a = check(await sb.from('activities').select('*, profiles(username, display_name, avatar_url, region_name)').eq('id', id).maybeSingle()) as
    | (Omit<FeedItem, 'username' | 'display_name' | 'avatar_url' | 'region_name' | 'kudos' | 'comments' | 'has_kudo'> & {
        profiles: { username: string; display_name: string; avatar_url: string | null; region_name: string | null };
      })
    | null;
  if (!a) return null;
  const [{ count: kudos }, { count: comments }, mine] = await Promise.all([
    sb.from('kudos').select('*', { count: 'exact', head: true }).eq('activity_id', id),
    sb.from('comments').select('*', { count: 'exact', head: true }).eq('activity_id', id),
    currentUserId() ? sb.from('kudos').select('user_id').eq('activity_id', id).eq('user_id', currentUserId()!).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { profiles, ...rest } = a;
  return { ...rest, ...profiles, kudos: kudos ?? 0, comments: comments ?? 0, has_kudo: !!mine.data };
}

export async function setKudo(activityId: string, on: boolean) {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  if (on) check(await sb.from('kudos').upsert({ activity_id: activityId, user_id: uid }, { ignoreDuplicates: true }));
  else check(await sb.from('kudos').delete().eq('activity_id', activityId).eq('user_id', uid));
}

export async function listKudos(activityId: string) {
  return check(
    await requireCloud().from('kudos').select('user_id, profiles(username, display_name, avatar_url)').eq('activity_id', activityId).limit(100),
  ) as unknown as { user_id: string; profiles: { username: string; display_name: string; avatar_url: string | null } | null }[];
}

export async function listComments(activityId: string): Promise<CommentRow[]> {
  return check(
    await requireCloud()
      .from('comments')
      .select('id, activity_id, user_id, body, created_at, profiles(username, display_name, avatar_url)')
      .eq('activity_id', activityId)
      .order('created_at'),
  ) as unknown as CommentRow[];
}

export async function addComment(activityId: string, body: string) {
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  check(await requireCloud().from('comments').insert({ activity_id: activityId, user_id: uid, body: body.trim().slice(0, 500) }));
}

export async function deleteComment(id: string) {
  check(await requireCloud().from('comments').delete().eq('id', id));
}

// ------------------------------------------------------------------ Personen

export async function getProfileSummary(userId: string): Promise<ProfileSummary | null> {
  return check(await requireCloud().rpc('get_profile', { p_user: userId })) as ProfileSummary | null;
}

export async function setFollow(userId: string, on: boolean) {
  const sb = requireCloud();
  const uid = currentUserId();
  if (!uid) throw new Error('Bitte zuerst anmelden.');
  if (on) check(await sb.from('follows').upsert({ follower_id: uid, followee_id: userId }, { ignoreDuplicates: true }));
  else check(await sb.from('follows').delete().eq('follower_id', uid).eq('followee_id', userId));
}

export async function searchProfiles(q: string): Promise<CloudProfile[]> {
  return check(await requireCloud().rpc('search_profiles', { p_query: q })) as CloudProfile[];
}

export async function listFollows(userId: string, dir: 'followers' | 'following') {
  const sb = requireCloud();
  const col = dir === 'followers' ? 'followee_id' : 'follower_id';
  const other = dir === 'followers' ? 'follower_id' : 'followee_id';
  const rows = check(await sb.from('follows').select(other).eq(col, userId).limit(200)) as unknown as Record<string, string>[];
  const ids = rows.map((r) => r[other]);
  if (!ids.length) return [] as CloudProfile[];
  return check(await sb.from('profiles').select('*').in('id', ids)) as CloudProfile[];
}

// ------------------------------------------------------------------ Ligen

export async function myLeagues(season: string): Promise<LeagueMembership[]> {
  const uid = currentUserId();
  if (!uid) return [];
  return check(await requireCloud().from('league_members').select('*').eq('user_id', uid).eq('season', season)) as LeagueMembership[];
}

export async function lastLeagueResults(): Promise<LeagueMembership[]> {
  const uid = currentUserId();
  if (!uid) return [];
  return check(
    await requireCloud().from('league_members').select('*').eq('user_id', uid).not('outcome', 'is', null).order('season', { ascending: false }).limit(20),
  ) as LeagueMembership[];
}

export async function joinLeague(sport: Sport): Promise<LeagueMembership> {
  return check(await requireCloud().rpc('join_league', { p_sport: sport })) as LeagueMembership;
}

export async function leaveLeague(sport: Sport) {
  check(await requireCloud().rpc('leave_league', { p_sport: sport }));
}

export async function getStandings(sport: Sport, season?: string): Promise<StandingRow[]> {
  return check(await requireCloud().rpc('league_standings', { p_sport: sport, p_season: season ?? null })) as StandingRow[];
}

export async function getLeaderboard(sport: Sport, scope: 'region' | 'all'): Promise<LeaderboardRow[]> {
  return check(await requireCloud().rpc('leaderboard', { p_sport: sport, p_scope: scope })) as LeaderboardRow[];
}

// ------------------------------------------------------------------ Hilfs-Hook für Abfragen

export function useCloudQuery<T>(fn: (() => Promise<T>) | null, deps: unknown[]): { data: T | undefined; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!fn) return;
    let alive = true;
    setLoading(true);
    setError('');
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
