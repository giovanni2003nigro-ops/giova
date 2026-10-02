-- Sport-Beiträge: Fotos und kurze Videos (Rekorde, Technik, Sportoutfits, Wettkämpfe …).
--
-- Kontrollmechanismen, damit nur Sport gepostet wird:
--  1. Pflicht-Kategorie (nur Sport-Kategorien) und optionale Sportart – per CHECK erzwungen.
--  2. KI-Prüfung (Claude Vision) von Bild/Video-Einzelbildern + Text vor der Veröffentlichung:
--       mode = 'client' → die App prüft mit dem KI-Schlüssel des Nutzers, nur positive Ergebnisse
--                          werden sofort sichtbar, alles andere wartet auf Moderation.
--       mode = 'server' → jeder Beitrag startet „in Prüfung“, die Edge Function moderate-post
--                          prüft mit dem Server-Schlüssel und schaltet frei oder lehnt ab.
--       mode = 'manuell' → nur Moderatoren schalten frei.
--  3. Melden (kein Sport, unangemessen, Spam, Belästigung): ab N Meldungen automatisch ausgeblendet.
--  4. Blockieren: gegenseitig unsichtbar, keine Kommentare/Likes, Follows werden entfernt.
--  5. Moderatoren prüfen gemeldete und wartende Beiträge (moderate_post).
--  6. Limits: keine Links im Text, Videos max. 60 s, max. Beiträge pro Tag, Medien nur im eigenen Ordner.

-- ============================================================================ Einstellungen & Rollen

create table public.app_config (
  key text primary key,
  value jsonb not null
);
insert into public.app_config (key, value)
values ('moderation', '{"mode": "client", "auto_hide_reports": 3, "max_posts_per_day": 10}');

create table public.moderators (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.moderation_setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value ->> p_key from public.app_config where key = 'moderation'
$$;

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.moderators where user_id = auth.uid())
$$;

-- ============================================================================ Blockieren

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

create or replace function public.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

-- Wer blockiert, folgt nicht mehr – und wird auch nicht mehr verfolgt
create or replace function public.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return null;
end $$;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.blocks_after_insert();

-- ============================================================================ Beiträge

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('rekord', 'technik', 'outfit', 'wettkampf', 'training', 'motivation', 'ernaehrung')),
  sport text check (sport in ('laufen', 'radfahren', 'schwimmen', 'wandern', 'rudern', 'hyrox', 'gym', 'powerlifting')),
  -- Keine Links: Spam und Werbung bleiben draußen
  caption text check (char_length(caption) <= 500 and caption !~* '(https?://|www\.)'),
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime')),
  media_path text not null check (char_length(media_path) <= 300),
  -- Vorschaubild (bei Videos ein Einzelbild)
  thumb_path text check (char_length(thumb_path) <= 300),
  duration_s numeric(5, 1) check (duration_s > 0 and duration_s <= 60),
  width integer check (width between 1 and 10000),
  height integer check (height between 1 and 10000),
  -- optional: Aktivität, zu der der Beitrag gehört (z. B. Rekordlauf)
  activity_id uuid references public.activities (id) on delete set null,
  status text not null default 'pruefung' check (status in ('pruefung', 'sichtbar', 'abgelehnt', 'gesperrt')),
  -- Ergebnis der KI-Prüfung bzw. Moderation
  moderation jsonb not null default '{}' check (pg_column_size(moderation) <= 4000),
  report_count integer not null default 0,
  created_at timestamptz not null default now(),
  -- Videos brauchen eine Länge, Bilder nicht
  check ((media_type like 'video/%') = (duration_s is not null))
);
create index posts_created on public.posts (created_at desc);
create index posts_user on public.posts (user_id, created_at desc);
create index posts_status on public.posts (status, created_at desc);

create or replace function public.posts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mode text := coalesce(public.moderation_setting('mode'), 'client');
  v_ok boolean := coalesce((new.moderation ->> 'sport')::boolean, false)
                  and not coalesce((new.moderation ->> 'unangemessen')::boolean, true);
begin
  if split_part(new.media_path, '/', 1) <> new.user_id::text
     or (new.thumb_path is not null and split_part(new.thumb_path, '/', 1) <> new.user_id::text) then
    raise exception 'Medien müssen im eigenen Ordner liegen' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 day')
     >= coalesce(public.moderation_setting('max_posts_per_day')::integer, 10) then
    raise exception 'Tageslimit für Beiträge erreicht – morgen wieder.' using errcode = 'check_violation';
  end if;
  if new.activity_id is not null and not exists (select 1 from public.activities where id = new.activity_id and user_id = new.user_id) then
    raise exception 'Nur eigene Aktivitäten verknüpfbar' using errcode = 'check_violation';
  end if;
  new.report_count := 0;
  new.created_at := now();
  -- Status entscheidet nie der Client allein
  if v_mode = 'client' then
    new.status := case when v_ok then 'sichtbar' else 'pruefung' end;
    new.moderation := jsonb_build_object(
      'mode', 'client',
      'sport', coalesce((new.moderation ->> 'sport')::boolean, false),
      'unangemessen', coalesce((new.moderation ->> 'unangemessen')::boolean, false),
      'grund', left(coalesce(new.moderation ->> 'grund', ''), 300),
      'erkannt', left(coalesce(new.moderation ->> 'erkannt', ''), 300),
      'checked_at', now()
    );
  else
    new.status := 'pruefung';
    new.moderation := jsonb_build_object('mode', v_mode);
  end if;
  return new;
end $$;
create trigger posts_before_insert before insert on public.posts
  for each row execute function public.posts_before_insert();

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500 and body !~* '(https?://|www\.)'),
  created_at timestamptz not null default now()
);
create index post_comments_post on public.post_comments (post_id, created_at);

create table public.post_reports (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('kein_sport', 'unangemessen', 'spam', 'belaestigung', 'sonstiges')),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Meldungen zählen; ab der eingestellten Anzahl wird ein Beitrag bis zur Moderation ausgeblendet
create or replace function public.post_reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := coalesce(public.moderation_setting('auto_hide_reports')::integer, 3);
begin
  update public.posts
     set report_count = report_count + 1,
         status = case when status = 'sichtbar' and report_count + 1 >= v_limit then 'gesperrt' else status end
   where id = new.post_id;
  return null;
end $$;
create trigger post_reports_after_insert after insert on public.post_reports
  for each row execute function public.post_reports_after_insert();

-- ============================================================================ Sichtbarkeit & Funktionen

create or replace function public.can_see_post(p_owner uuid, p_status text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()
      or public.is_moderator()
      or (p_status = 'sichtbar' and not public.is_blocked(auth.uid(), p_owner))
$$;

/** Beiträge: alle, Folge ich, eines Nutzers, eigene oder (Moderatoren) zu prüfende. */
create or replace function public.get_posts(p_scope text default 'all', p_before timestamptz default null, p_limit integer default 20, p_user uuid default null)
returns table (
  id uuid, user_id uuid, username text, display_name text, avatar_url text,
  category text, sport text, caption text, media_type text, media_path text, thumb_path text,
  duration_s numeric, width integer, height integer, activity_id uuid,
  status text, moderation jsonb, report_count integer, created_at timestamptz,
  likes integer, comments integer, has_like boolean
) language sql stable security invoker set search_path = public as $$
  select po.id, po.user_id, p.username, p.display_name, p.avatar_url,
         po.category, po.sport, po.caption, po.media_type, po.media_path, po.thumb_path,
         po.duration_s, po.width, po.height, po.activity_id,
         po.status,
         case when po.user_id = auth.uid() or public.is_moderator() then po.moderation else '{}'::jsonb end,
         case when public.is_moderator() then po.report_count else 0 end,
         po.created_at,
         (select count(*) from public.post_likes l where l.post_id = po.id)::integer,
         (select count(*) from public.post_comments c where c.post_id = po.id)::integer,
         exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_id = auth.uid())
    from public.posts po
    join public.profiles p on p.id = po.user_id
   where (p_before is null or po.created_at < p_before)
     and case p_scope
           when 'me' then po.user_id = auth.uid()
           when 'user' then po.user_id = p_user and (po.status = 'sichtbar' or po.user_id = auth.uid())
           when 'following' then po.status = 'sichtbar' and (po.user_id = auth.uid() or po.user_id in (select followee_id from public.follows where follower_id = auth.uid()))
           when 'review' then public.is_moderator() and (po.status in ('pruefung', 'gesperrt') or po.report_count > 0)
           else po.status = 'sichtbar'
         end
   order by po.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

/** Moderation: freischalten, ablehnen oder sperren – nur für Moderatoren. */
create or replace function public.moderate_post(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then
    raise exception 'Nur für Moderatoren' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('sichtbar', 'abgelehnt', 'gesperrt') then
    raise exception 'Ungültiger Status' using errcode = 'check_violation';
  end if;
  update public.posts
     set status = p_status,
         report_count = case when p_status = 'sichtbar' then 0 else report_count end,
         moderation = moderation || jsonb_build_object('reviewed_by', auth.uid(), 'reviewed_at', now(), 'note', left(coalesce(p_note, ''), 300))
   where id = p_id;
  -- Freigegeben → alte Meldungen erledigt
  if p_status = 'sichtbar' then
    delete from public.post_reports where post_id = p_id;
  end if;
end $$;

-- ============================================================================ Row Level Security

alter table public.app_config enable row level security;
alter table public.moderators enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_reports enable row level security;

create policy "Einstellungen lesen" on public.app_config for select using (true);
create policy "Eigene Moderatorenrolle sehen" on public.moderators for select using (user_id = auth.uid());

create policy "Eigene Blockierungen" on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy "Blockieren" on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy "Entblocken" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

create policy "Sichtbare Beiträge lesen" on public.posts for select using (public.can_see_post(user_id, status));
create policy "Eigene Beiträge anlegen" on public.posts for insert to authenticated with check (user_id = auth.uid());
create policy "Eigene Beiträge löschen" on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_moderator());

create policy "Likes sichtbarer Beiträge" on public.post_likes for select
  using (exists (select 1 from public.posts po where po.id = post_id));
create policy "Liken" on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts po where po.id = post_id and po.status = 'sichtbar'));
create policy "Like zurücknehmen" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy "Kommentare sichtbarer Beiträge" on public.post_comments for select
  using (exists (select 1 from public.posts po where po.id = post_id) and not public.is_blocked(auth.uid(), user_id));
create policy "Beiträge kommentieren" on public.post_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts po where po.id = post_id and po.status = 'sichtbar' and not public.is_blocked(auth.uid(), po.user_id))
  );
create policy "Beitragskommentar löschen" on public.post_comments for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator() or exists (select 1 from public.posts po where po.id = post_id and po.user_id = auth.uid()));

create policy "Eigene Meldungen sehen" on public.post_reports for select to authenticated using (user_id = auth.uid() or public.is_moderator());
create policy "Melden" on public.post_reports for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts po where po.id = post_id and po.user_id <> auth.uid()));

-- ============================================================================ Rechte

grant select on public.app_config, public.moderators, public.blocks, public.posts, public.post_likes, public.post_comments, public.post_reports to anon, authenticated;
grant insert, delete on public.blocks, public.posts, public.post_likes, public.post_comments to authenticated;
grant insert on public.post_reports to authenticated;
-- Edge Function (Server-Prüfung) arbeitet mit der service_role
grant select, insert, update, delete on public.posts, public.post_reports, public.app_config to service_role;

revoke execute on function public.moderate_post(uuid, text, text) from public, anon;
grant execute on function public.moderate_post(uuid, text, text) to authenticated;
