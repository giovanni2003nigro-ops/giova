-- Giova Fit – Community-Plattform
-- Profile, Aktivitäten (Feed), Folgen, Kudos, Kommentare, Medaillen, Ligen mit Auf- und Abstieg.
--
-- Die Punkte-, Liga- und Medaillenregeln spiegeln src/lib/points.ts, src/lib/leagues.ts und
-- src/lib/medals.ts. Änderungen immer an beiden Stellen machen; `npm run test:db` prüft,
-- dass Server und App gleich rechnen.

-- ============================================================================ Hilfsfunktionen

/** Saisons laufen nach deutscher Zeit (Monatswechsel um Mitternacht in Berlin). */
create or replace function public.app_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Berlin')::date $$;

create or replace function public.current_season() returns text
language sql stable as $$ select to_char(public.app_today(), 'YYYY-MM') $$;

create or replace function public.season_start(p_season text) returns date
language sql immutable as $$ select to_date(p_season || '-01', 'YYYY-MM-DD') $$;

create or replace function public.season_end(p_season text) returns date
language sql immutable as $$ select (to_date(p_season || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date $$;

/** Länge des gemeinsamen Anfangs zweier Geohashes = grobe Nähe. */
create or replace function public.common_prefix(a text, b text) returns integer
language plpgsql immutable as $$
declare i integer := 0;
begin
  if a is null or b is null then return 0; end if;
  while i < least(length(a), length(b)) and substr(a, i + 1, 1) = substr(b, i + 1, 1) loop
    i := i + 1;
  end loop;
  return i;
end $$;

-- ============================================================================ Tabellen

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 50),
  bio text check (char_length(bio) <= 300),
  avatar_url text check (char_length(avatar_url) <= 500),
  sex text check (sex in ('m', 'w')),
  -- 4 Zeichen ≈ 39 × 20 km: genau genug für „in deiner Umgebung“, ohne den Wohnort zu verraten
  home_geohash text check (home_geohash ~ '^[0-9b-hjkmnp-z]{4}$'),
  region_name text check (char_length(region_name) <= 60),
  sports text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_uid text not null check (char_length(client_uid) <= 64),
  sport text not null check (sport in ('laufen', 'radfahren', 'schwimmen', 'wandern', 'rudern', 'hyrox', 'gym', 'powerlifting')),
  title text not null check (char_length(title) between 1 and 100),
  description text check (char_length(description) <= 2000),
  started_at timestamptz not null,
  -- Kalendertag beim Nutzer (entscheidet über die Saison)
  local_date date not null,
  duration_s integer not null check (duration_s > 0 and duration_s <= 86400),
  elapsed_s integer check (elapsed_s >= 0),
  distance_m integer check (distance_m >= 0 and distance_m <= 1000000),
  elevation_m integer check (elevation_m >= 0 and elevation_m <= 20000),
  avg_hr smallint check (avg_hr between 20 and 250),
  max_hr smallint check (max_hr between 20 and 250),
  kcal integer check (kcal between 0 and 20000),
  polyline text check (char_length(polyline) <= 200000),
  -- sportartspezifisch: {"hyrox": {"race": true}, "powerlifting": {"squat": 180, …}, "strength": […]}
  metrics jsonb not null default '{}' check (pg_column_size(metrics) <= 20000),
  photo_path text check (char_length(photo_path) <= 300),
  visibility text not null default 'public' check (visibility in ('public', 'followers', 'private')),
  -- wird vom Trigger berechnet, nie vom Client übernommen
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, client_uid)
);
create index activities_user_date on public.activities (user_id, local_date desc);
create index activities_started on public.activities (started_at desc);
create index activities_user_sport_date on public.activities (user_id, sport, local_date);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on public.follows (followee_id);

create table public.kudos (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index comments_activity on public.comments (activity_id, created_at);

-- ============================================================================ Punkte (Spiegel von src/lib/points.ts)

create or replace function public.activity_implausible(p_sport text, p_duration_s integer, p_distance_m integer)
returns boolean language plpgsql immutable as $$
declare
  sec float8 := p_duration_s;
  km float8 := coalesce(p_distance_m, 0)::float8 / 1000.0;
begin
  if sec is null or sec <= 0 or sec > 86400 then return true; end if;
  if km <= 0 then return false; end if;
  return case p_sport
    when 'laufen' then km >= 1 and sec / km < 150
    when 'wandern' then km / (sec / 3600) > 12
    when 'radfahren' then km / (sec / 3600) > 60
    when 'schwimmen' then sec / (km * 10) < 55
    when 'rudern' then sec / (km * 2) < 80
    else false
  end;
end $$;

create or replace function public.activity_points(p_sport text, p_duration_s integer, p_distance_m integer, p_elevation_m integer, p_race boolean)
returns integer language plpgsql immutable as $$
declare
  sec float8;
  km float8;
  mins float8;
  v float8;
begin
  if public.activity_implausible(p_sport, p_duration_s, p_distance_m) then return 0; end if;
  sec := least(p_duration_s, 21600)::float8;
  km := (coalesce(p_distance_m, 0)::float8 / 1000) * (sec / p_duration_s::float8);
  mins := sec / 60;
  case p_sport
    when 'laufen' then
      if km <= 0 then return floor(mins * 1 + 0.5); end if;
      v := sec / km;
      return floor(km * 10 * least(1.5, greatest(0.7, 360 / v)) + 0.5);
    when 'radfahren' then
      if km <= 0 then return floor(mins * 1 + 0.5); end if;
      v := km / (sec / 3600);
      return floor(km * 2.5 * least(1.5, greatest(0.7, v / 25)) + 0.5);
    when 'schwimmen' then
      if km <= 0 then return floor(mins * 1 + 0.5); end if;
      v := sec / (km * 10);
      return floor(km * 40 * least(1.5, greatest(0.7, 150 / v)) + 0.5);
    when 'wandern' then
      if km <= 0 then return floor(mins * 0.5 + 0.5); end if;
      return floor(km * 5 + coalesce(p_elevation_m, 0)::float8 / 10 + 0.5);
    when 'rudern' then
      if km <= 0 then return floor(mins * 1 + 0.5); end if;
      v := sec / (km * 2);
      return floor(km * 8 * least(1.5, greatest(0.7, 150 / v)) + 0.5);
    when 'hyrox' then
      return floor(mins * 2 * (case when coalesce(p_race, false) then 1.5 else 1 end) + 0.5);
    when 'gym' then
      return floor(least(mins, 150) * 1.5 + 0.5);
    when 'powerlifting' then
      return floor(least(mins, 180) * 1.5 + 0.5);
    else
      return 0;
  end case;
end $$;

create or replace function public.activities_before_write() returns trigger
language plpgsql as $$
begin
  if new.started_at > now() + interval '1 day' then
    raise exception 'Aktivitäten in der Zukunft sind nicht erlaubt';
  end if;
  if new.local_date not between (new.started_at at time zone 'UTC')::date - 1 and (new.started_at at time zone 'UTC')::date + 1 then
    raise exception 'local_date passt nicht zur Startzeit';
  end if;
  new.points := public.activity_points(new.sport, new.duration_s, new.distance_m, new.elevation_m,
    coalesce((new.metrics -> 'hyrox' ->> 'race')::boolean, false));
  return new;
end $$;

create trigger activities_before_write before insert or update on public.activities
for each row execute function public.activities_before_write();

-- ============================================================================ Medaillen (Spiegel von src/lib/medals.ts)

create table public.medal_catalog (
  key text primary key,
  points integer not null check (points > 0),
  sport text,
  repeat text not null check (repeat in ('once', 'season'))
);

insert into public.medal_catalog (key, points, sport, repeat) values
  ('erste_aktivitaet', 25, null, 'once'),
  ('lauf_5k', 50, 'laufen', 'once'),
  ('lauf_10k', 100, 'laufen', 'once'),
  ('lauf_hm', 250, 'laufen', 'once'),
  ('lauf_marathon', 500, 'laufen', 'once'),
  ('lauf_sub25_5k', 150, 'laufen', 'once'),
  ('lauf_sub50_10k', 200, 'laufen', 'once'),
  ('rad_100k', 200, 'radfahren', 'once'),
  ('schwimm_1500', 100, 'schwimmen', 'once'),
  ('wandern_1000hm', 100, 'wandern', 'once'),
  ('rudern_10k', 100, 'rudern', 'once'),
  ('lauf_50km_monat', 75, 'laufen', 'season'),
  ('lauf_100km_monat', 150, 'laufen', 'season'),
  ('rad_500km_monat', 150, 'radfahren', 'season'),
  ('schwimm_10km_monat', 150, 'schwimmen', 'season'),
  ('hyrox_finisher', 300, 'hyrox', 'once'),
  ('hyrox_sub90', 400, 'hyrox', 'once'),
  ('hyrox_8_monat', 100, 'hyrox', 'season'),
  ('kraft_12_monat', 100, 'gym', 'season'),
  ('kraft_pr', 50, 'gym', 'season'),
  ('pl_bw_bench', 150, 'powerlifting', 'once'),
  ('pl_2x_deadlift', 250, 'powerlifting', 'once'),
  ('pl_total_500', 300, 'powerlifting', 'once'),
  ('streak_7', 75, null, 'season'),
  ('aktiv_20_monat', 150, null, 'season'),
  ('trainingsziel_4_wochen', 100, null, 'season'),
  ('plan_woche', 100, null, 'season'),
  ('protein_7', 75, null, 'season'),
  ('kalorien_14', 100, null, 'season'),
  ('schlaf_7', 75, null, 'season'),
  ('kraftziel', 200, null, 'season'),
  ('zielgewicht', 300, null, 'once');

create table public.user_medals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  medal_key text not null references public.medal_catalog (key),
  -- '' bei einmaligen Medaillen, sonst die Saison "YYYY-MM"
  period text not null default '',
  earned_on date not null,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, medal_key, period)
);

create or replace function public.user_medals_before_insert() returns trigger
language plpgsql as $$
declare c public.medal_catalog;
begin
  select * into c from public.medal_catalog where key = new.medal_key;
  if not found then raise exception 'Unbekannte Medaille %', new.medal_key; end if;
  if new.earned_on > public.app_today() + 1 then raise exception 'Medaille aus der Zukunft'; end if;
  if c.repeat = 'once' then
    new.period := '';
  elsif new.period is distinct from to_char(new.earned_on, 'YYYY-MM') then
    raise exception 'Saison passt nicht zum Datum';
  end if;
  new.points := c.points;
  return new;
end $$;

create trigger user_medals_before_insert before insert on public.user_medals
for each row execute function public.user_medals_before_insert();

-- ============================================================================ Ligen (Spiegel von src/lib/leagues.ts)

create table public.league_rules (
  sport text primary key,
  window_days integer not null,
  volume_metric text not null,
  volume_thresholds float8[] not null check (array_length(volume_thresholds, 1) = 5),
  intensity_metric text,
  intensity_thresholds float8[] check (array_length(intensity_thresholds, 1) = 5),
  intensity_lower_better boolean,
  intensity_min_volume float8,
  intensity_window_days integer
);

insert into public.league_rules values
  ('laufen', 30, 'km', '{30,60,100,160,240}', 'pace_km', '{390,345,300,260,225}', true, 20, 30),
  ('radfahren', 30, 'km', '{150,300,500,800,1200}', 'kmh', '{22,25,28,31,34}', false, 100, 30),
  ('schwimmen', 30, 'km', '{5,10,18,28,40}', 'pace_100m', '{150,130,115,100,85}', true, 3, 30),
  ('wandern', 30, 'km', '{20,40,70,100,150}', 'elevation', '{1000,2500,4000,6000,9000}', false, 0, 30),
  ('rudern', 30, 'km', '{20,50,90,140,200}', 'pace_500m', '{160,145,130,118,108}', true, 10, 30),
  ('hyrox', 30, 'hours', '{6,12,18,25,35}', 'race_time', '{6300,5700,5100,4500,3900}', true, 0, 365),
  ('gym', 30, 'sessions', '{6,10,14,18,22}', null, null, null, null, null),
  ('powerlifting', 30, 'sessions', '{4,8,12,16,20}', 'dots', '{200,270,330,390,450}', false, 0, 90);

create table public.league_groups (
  id bigint generated always as identity primary key,
  sport text not null references public.league_rules (sport),
  season text not null check (season ~ '^\d{4}-\d{2}$'),
  tier smallint not null check (tier between 0 and 5),
  -- Geohash des ersten Mitglieds: neue Mitglieder kommen in die nächstgelegene Gruppe
  geohash text,
  created_at timestamptz not null default now()
);
create index league_groups_lookup on public.league_groups (sport, season, tier);

create table public.league_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null references public.league_rules (sport),
  season text not null check (season ~ '^\d{4}-\d{2}$'),
  tier smallint not null check (tier between 0 and 5),
  group_id bigint references public.league_groups (id) on delete set null,
  geohash text,
  -- nach Saisonende gesetzt
  points integer,
  final_rank integer,
  outcome text check (outcome in ('auf', 'ab', 'bleibt')),
  new_tier smallint check (new_tier between 0 and 5),
  joined_at timestamptz not null default now(),
  primary key (user_id, sport, season)
);
create index league_members_group on public.league_members (group_id);

create or replace function public.dots(p_total float8, p_bw float8, p_sex text) returns float8
language plpgsql immutable as $$
declare
  bw float8;
  d float8;
begin
  if p_total is null or p_bw is null or p_total <= 0 or p_bw <= 0 then return 0; end if;
  if coalesce(p_sex, 'm') = 'w' then
    bw := least(150, greatest(40, p_bw));
    d := -57.96288 + 13.6175032 * bw + -0.1126655495 * bw ^ 2 + 0.0005158568 * bw ^ 3 + -0.0000010706 * bw ^ 4;
  else
    bw := least(210, greatest(40, p_bw));
    d := -307.75076 + 24.0900756 * bw + -0.1918759221 * bw ^ 2 + 0.0007391293 * bw ^ 3 + -0.000001093 * bw ^ 4;
  end if;
  return p_total * 500 / d;
end $$;

/** Umfang, Intensität und Leistungsstufe einer Sportart zum Stichtag. */
create or replace function public.sport_performance(p_user uuid, p_sport text, p_on date)
returns table (activities integer, volume float8, intensity float8, intensity_volume float8, tier integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  r public.league_rules;
  v_n integer;
  v_km float8;
  v_sec float8;
  d_km float8;
  d_sec float8;
  v_elev float8;
  v_race float8;
  v_sq float8;
  v_be float8;
  v_dl float8;
  v_bw float8;
  v_sex text;
  i integer;
  by_vol boolean;
  by_int boolean;
begin
  select * into r from public.league_rules where sport = p_sport;
  select count(*), coalesce(sum(distance_m), 0) / 1000.0, coalesce(sum(duration_s), 0)
    into v_n, v_km, v_sec
    from public.activities a
   where a.user_id = p_user and a.sport = p_sport and a.points > 0
     and a.local_date > p_on - r.window_days and a.local_date <= p_on;
  activities := v_n;
  volume := case r.volume_metric when 'km' then v_km when 'hours' then v_sec / 3600 else v_n end;
  intensity := null;
  intensity_volume := volume;
  if r.intensity_metric is not null then
    select coalesce(sum(coalesce(elevation_m, 0)), 0),
           min(duration_s) filter (where coalesce((metrics -> 'hyrox' ->> 'race')::boolean, false)),
           max((metrics -> 'powerlifting' ->> 'squat')::float8),
           max((metrics -> 'powerlifting' ->> 'bench')::float8),
           max((metrics -> 'powerlifting' ->> 'deadlift')::float8)
      into v_elev, v_race, v_sq, v_be, v_dl
      from public.activities a
     where a.user_id = p_user and a.sport = p_sport and a.points > 0
       and a.local_date > p_on - r.intensity_window_days and a.local_date <= p_on;
    -- nur Aktivitäten mit Distanz fürs Tempo
    select coalesce(sum(distance_m), 0) / 1000.0, coalesce(sum(duration_s), 0)
      into d_km, d_sec
      from public.activities a
     where a.user_id = p_user and a.sport = p_sport and a.points > 0 and coalesce(a.distance_m, 0) > 0
       and a.local_date > p_on - r.intensity_window_days and a.local_date <= p_on;
    if r.intensity_window_days <> r.window_days then intensity_volume := d_km; end if;
    intensity := case r.intensity_metric
      when 'pace_km' then case when d_km > 0 then d_sec / d_km end
      when 'pace_100m' then case when d_km > 0 then d_sec / (d_km * 10) end
      when 'pace_500m' then case when d_km > 0 then d_sec / (d_km * 2) end
      when 'kmh' then case when d_sec > 0 then d_km / (d_sec / 3600) end
      when 'elevation' then v_elev
      when 'race_time' then v_race
      else null
    end;
    if r.intensity_metric = 'dots' then
      select (metrics -> 'powerlifting' ->> 'bodyweight')::float8 into v_bw
        from public.activities a
       where a.user_id = p_user and a.sport = p_sport and a.points > 0
         and a.local_date > p_on - r.intensity_window_days and a.local_date <= p_on
         and (metrics -> 'powerlifting' ->> 'bodyweight') is not null
       order by a.started_at desc limit 1;
      select sex into v_sex from public.profiles where id = p_user;
      intensity := case when v_bw > 0 and v_sq > 0 and v_be > 0 and v_dl > 0
        then public.dots(v_sq + v_be + v_dl, v_bw, v_sex) end;
    end if;
  end if;
  tier := 0;
  for i in 1..5 loop
    by_vol := volume >= r.volume_thresholds[i];
    by_int := r.intensity_metric is not null and intensity is not null and intensity_volume >= r.intensity_min_volume
      and (case when r.intensity_lower_better then intensity <= r.intensity_thresholds[i] else intensity >= r.intensity_thresholds[i] end);
    if by_vol or by_int then tier := i; end if;
  end loop;
  return next;
end $$;

/** Saisonpunkte: Aktivitäten der Sportart + Medaillen dieser Sportart + allgemeine Medaillen. */
create or replace function public.season_points(p_user uuid, p_sport text, p_season text)
returns integer language sql stable security definer set search_path = public as $$
  select (
    coalesce((select sum(points) from public.activities
               where user_id = p_user and sport = p_sport
                 and local_date between public.season_start(p_season) and public.season_end(p_season)), 0)
    + coalesce((select sum(um.points) from public.user_medals um
                  join public.medal_catalog mc on mc.key = um.medal_key
                 where um.user_id = p_user and (mc.sport is null or mc.sport = p_sport)
                   and um.earned_on between public.season_start(p_season) and public.season_end(p_season)), 0)
  )::integer
$$;

create or replace function public.zone_size(n integer) returns integer
language sql immutable as $$ select case when n >= 5 then greatest(1, round(n * 0.2))::integer else 0 end $$;

/** Nächstgelegene Gruppe mit freiem Platz – sonst eine neue. */
create or replace function public.pick_group(p_sport text, p_season text, p_tier integer, p_geohash text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select g.id into v_id
    from public.league_groups g
    cross join lateral (select count(*) as n from public.league_members m where m.group_id = g.id) c
   where g.sport = p_sport and g.season = p_season and g.tier = p_tier and c.n < 30
     and (p_geohash is null or g.geohash is null or public.common_prefix(g.geohash, p_geohash) >= 1)
   order by public.common_prefix(g.geohash, p_geohash) desc, c.n asc, g.id
   limit 1;
  if v_id is null then
    insert into public.league_groups (sport, season, tier, geohash) values (p_sport, p_season, p_tier, p_geohash)
    returning id into v_id;
  end if;
  return v_id;
end $$;

/** Tritt der Liga einer Sportart für die laufende Saison bei (idempotent). */
create or replace function public.join_league(p_sport text)
returns public.league_members language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season text := public.current_season();
  v_m public.league_members;
  v_last integer;
  v_perf integer;
  v_geo text;
begin
  if v_uid is null then raise exception 'Bitte zuerst anmelden'; end if;
  if not exists (select 1 from public.league_rules where sport = p_sport) then raise exception 'Unbekannte Sportart %', p_sport; end if;
  select * into v_m from public.league_members where user_id = v_uid and sport = p_sport and season = v_season;
  if found then return v_m; end if;
  select home_geohash into v_geo from public.profiles where id = v_uid;
  if not found then raise exception 'Bitte zuerst ein Profil anlegen'; end if;
  -- Zuletzt erreichte Liga, mindestens aber die Stufe der aktuellen Leistung
  select coalesce(new_tier, tier) into v_last from public.league_members
   where user_id = v_uid and sport = p_sport and season < v_season order by season desc limit 1;
  select tier into v_perf from public.sport_performance(v_uid, p_sport, public.app_today());
  insert into public.league_members (user_id, sport, season, tier, geohash, group_id)
  values (v_uid, p_sport, v_season, greatest(coalesce(v_last, 0), v_perf), v_geo,
          public.pick_group(p_sport, v_season, greatest(coalesce(v_last, 0), v_perf), v_geo))
  returning * into v_m;
  return v_m;
end $$;

create or replace function public.leave_league(p_sport text) returns void
language sql security definer set search_path = public as $$
  delete from public.league_members where user_id = auth.uid() and sport = p_sport and season = public.current_season()
$$;

/** Teilt Mitglieder einer Saison ohne Gruppe nach Region (Geohash-Reihenfolge) in Gruppen à max. 30. */
create or replace function public.form_groups(p_season text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  g integer;
  ids bigint[];
  v_id bigint;
  i integer;
begin
  for r in select sport, tier, count(*) as n from public.league_members
            where season = p_season and group_id is null group by sport, tier loop
    g := ceil(r.n / 30.0);
    ids := '{}';
    for i in 1..g loop
      insert into public.league_groups (sport, season, tier) values (r.sport, p_season, r.tier) returning id into v_id;
      ids := ids || v_id;
    end loop;
    update public.league_members m set group_id = ids[t.bucket]
      from (select user_id, ntile(g) over (order by geohash collate "C" nulls last, user_id::text collate "C") as bucket
              from public.league_members
             where season = p_season and sport = r.sport and tier = r.tier and group_id is null) t
     where m.user_id = t.user_id and m.season = p_season and m.sport = r.sport;
    update public.league_groups lg set geohash = (select min(geohash collate "C") from public.league_members where group_id = lg.id)
     where lg.id = any (ids);
  end loop;
end $$;

/**
 * Saisonabschluss (Spiegel von closeGroup in src/lib/leagues.ts):
 * Rang je Gruppe, Auf-/Abstieg, neue Saison für alle aktiven Mitglieder, neue Gruppen.
 * Läuft monatlich per pg_cron und ist idempotent.
 */
create or replace function public.close_season(p_season text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_next text := to_char(public.season_start(p_season) + interval '1 month', 'YYYY-MM');
  v_end date := public.season_end(p_season);
  v_count integer;
begin
  with st as (
    select m.user_id, m.sport, m.tier, m.group_id,
           public.season_points(m.user_id, m.sport, p_season) as pts,
           (select p.tier from public.sport_performance(m.user_id, m.sport, v_end) p) as perf
      from public.league_members m
     where m.season = p_season
  ), ranked as (
    select st.*,
           row_number() over (partition by st.sport, st.group_id order by st.pts desc, st.user_id::text collate "C") as rnk,
           count(*) over (partition by st.sport, st.group_id) as n
      from st
  ), decided as (
    select ranked.*, public.zone_size(n::integer) as z,
           (tier < 5 and ((rnk <= public.zone_size(n::integer) and pts > 0) or perf > tier)) as promote
      from ranked
  ), outcome as (
    select decided.*,
           (not promote and tier > 0 and ((rnk > n - z and perf < tier) or pts <= 0)) as relegate
      from decided
  )
  update public.league_members m
     set points = o.pts,
         final_rank = o.rnk,
         outcome = case when o.promote then 'auf' when o.relegate then 'ab' else 'bleibt' end,
         new_tier = case when o.promote then least(5, greatest(o.tier + 1, o.perf))
                         when o.relegate then o.tier - 1 else o.tier end
    from outcome o
   where m.user_id = o.user_id and m.sport = o.sport and m.season = p_season;
  get diagnostics v_count = row_count;

  -- Wer in der Saison aktiv war, ist automatisch in der nächsten dabei
  insert into public.league_members (user_id, sport, season, tier, geohash)
  select m.user_id, m.sport, v_next, m.new_tier, p.home_geohash
    from public.league_members m join public.profiles p on p.id = m.user_id
   where m.season = p_season and m.points > 0
  on conflict do nothing;
  perform public.form_groups(v_next);
  return v_count;
end $$;

/** Tabelle der eigenen Gruppe mit Auf- und Abstiegszone. */
create or replace function public.league_standings(p_sport text, p_season text default null)
returns table (
  rank integer, user_id uuid, username text, display_name text, avatar_url text, region_name text,
  points integer, tier integer, performance_tier integer, volume float8, intensity float8,
  zone text, is_me boolean, group_size integer, outcome text, new_tier integer
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_season text := coalesce(p_season, public.current_season());
  v_group bigint;
  v_on date := least(public.season_end(coalesce(p_season, public.current_season())), public.app_today());
begin
  select m.group_id into v_group from public.league_members m
   where m.user_id = auth.uid() and m.sport = p_sport and m.season = v_season;
  if v_group is null then return; end if;
  return query
  with base as (
    select m.user_id, m.tier, m.outcome, m.new_tier, pr.username, pr.display_name, pr.avatar_url, pr.region_name,
           coalesce(m.points, public.season_points(m.user_id, p_sport, v_season)) as pts,
           perf.tier as ptier, perf.volume as vol, perf.intensity as inten
      from public.league_members m
      join public.profiles pr on pr.id = m.user_id
      cross join lateral public.sport_performance(m.user_id, p_sport, v_on) perf
     where m.group_id = v_group and m.season = v_season
  ), ranked as (
    select base.*, row_number() over (order by pts desc, base.user_id::text collate "C")::integer as rnk, count(*) over ()::integer as n
      from base
  )
  select r.rnk, r.user_id, r.username, r.display_name, r.avatar_url, r.region_name, r.pts, r.tier::integer, r.ptier, r.vol, r.inten,
         case when r.rnk <= public.zone_size(r.n) and r.pts > 0 then 'auf'
              when r.rnk > r.n - public.zone_size(r.n) then 'ab' end,
         r.user_id = auth.uid(), r.n, r.outcome, r.new_tier::integer
    from ranked r order by r.rnk;
end $$;

/** Bestenliste einer Sportart in der Region (gleicher Geohash-Anfang) oder insgesamt. */
create or replace function public.leaderboard(p_sport text, p_scope text default 'region', p_season text default null)
returns table (rank integer, user_id uuid, username text, display_name text, avatar_url text, region_name text, points integer, tier integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_season text := coalesce(p_season, public.current_season());
  v_prefix text;
begin
  select left(home_geohash, 3) into v_prefix from public.profiles where id = auth.uid();
  return query
  with pts as (
    select a.user_id, sum(a.points)::integer as p
      from public.activities a
     where a.sport = p_sport and a.local_date between public.season_start(v_season) and public.season_end(v_season)
     group by a.user_id
  )
  select (row_number() over (order by pts.p desc, pts.user_id::text collate "C"))::integer, pts.user_id, pr.username, pr.display_name,
         pr.avatar_url, pr.region_name, pts.p,
         (select m.tier::integer from public.league_members m where m.user_id = pts.user_id and m.sport = p_sport and m.season = v_season),
         pts.user_id = auth.uid()
    from pts join public.profiles pr on pr.id = pts.user_id
   where p_scope <> 'region' or (v_prefix is not null and left(pr.home_geohash, 3) = v_prefix)
   order by pts.p desc, pts.user_id::text collate "C"
   limit 100;
end $$;

-- ============================================================================ Feed & Profile

/** Feed: eigene + gefolgte, Umgebung, eigene oder die eines Nutzers. RLS entscheidet über die Sichtbarkeit. */
create or replace function public.get_feed(p_scope text default 'following', p_before timestamptz default null, p_limit integer default 20, p_user uuid default null)
returns table (
  id uuid, user_id uuid, username text, display_name text, avatar_url text, region_name text,
  sport text, title text, description text, started_at timestamptz, local_date date,
  duration_s integer, distance_m integer, elevation_m integer, avg_hr smallint, kcal integer,
  polyline text, metrics jsonb, photo_path text, visibility text, points integer,
  kudos integer, comments integer, has_kudo boolean
) language sql stable security invoker set search_path = public as $$
  select a.id, a.user_id, p.username, p.display_name, p.avatar_url, p.region_name,
         a.sport, a.title, a.description, a.started_at, a.local_date,
         a.duration_s, a.distance_m, a.elevation_m, a.avg_hr, a.kcal,
         a.polyline, a.metrics, a.photo_path, a.visibility, a.points,
         (select count(*) from public.kudos k where k.activity_id = a.id)::integer,
         (select count(*) from public.comments c where c.activity_id = a.id)::integer,
         exists (select 1 from public.kudos k where k.activity_id = a.id and k.user_id = auth.uid())
    from public.activities a
    join public.profiles p on p.id = a.user_id
   where (p_before is null or a.started_at < p_before)
     and case p_scope
           when 'me' then a.user_id = auth.uid()
           when 'user' then a.user_id = p_user
           when 'nearby' then a.visibility = 'public' and left(p.home_geohash, 3) = (select left(home_geohash, 3) from public.profiles where id = auth.uid())
           when 'all' then a.visibility = 'public'
           else a.user_id = auth.uid() or a.user_id in (select followee_id from public.follows where follower_id = auth.uid())
         end
   order by a.started_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create or replace function public.get_profile(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', to_jsonb(p) - 'home_geohash',
    'followers', (select count(*) from public.follows where followee_id = p.id),
    'following', (select count(*) from public.follows where follower_id = p.id),
    'is_following', exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p.id),
    'follows_me', exists (select 1 from public.follows where follower_id = p.id and followee_id = auth.uid()),
    'total_points', coalesce((select sum(points) from public.activities where user_id = p.id), 0)
                    + coalesce((select sum(points) from public.user_medals where user_id = p.id), 0),
    'activities', (select count(*) from public.activities where user_id = p.id),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('key', medal_key, 'period', period, 'earned_on', earned_on, 'points', points) order by earned_on desc)
                          from public.user_medals where user_id = p.id), '[]'::jsonb),
    'leagues', coalesce((select jsonb_agg(jsonb_build_object('sport', sport, 'tier', tier) order by sport)
                           from public.league_members where user_id = p.id and season = public.current_season()), '[]'::jsonb)
  )
  from public.profiles p where p.id = p_user
$$;

create or replace function public.search_profiles(p_query text)
returns setof public.profiles language sql stable security invoker set search_path = public as $$
  select * from public.profiles
   where username ilike '%' || replace(replace(p_query, '%', ''), '_', '\_') || '%'
      or display_name ilike '%' || replace(replace(p_query, '%', ''), '_', '\_') || '%'
   order by username limit 20
$$;

/** Löscht alle Community-Daten des angemeldeten Nutzers (Profil, Aktivitäten, Ligen …). */
create or replace function public.delete_my_data() returns void
language sql security definer set search_path = public as $$
  delete from public.profiles where id = auth.uid()
$$;

-- ============================================================================ Row Level Security

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.follows enable row level security;
alter table public.kudos enable row level security;
alter table public.comments enable row level security;
alter table public.medal_catalog enable row level security;
alter table public.user_medals enable row level security;
alter table public.league_rules enable row level security;
alter table public.league_groups enable row level security;
alter table public.league_members enable row level security;

create policy "Profile sind öffentlich" on public.profiles for select using (true);
create policy "Eigenes Profil anlegen" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Eigenes Profil löschen" on public.profiles for delete to authenticated using (id = auth.uid());

create or replace function public.can_see_activity(p_owner uuid, p_visibility text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_visibility = 'public'
      or p_owner = auth.uid()
      or (p_visibility = 'followers' and exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_owner))
$$;

create policy "Sichtbare Aktivitäten lesen" on public.activities for select using (public.can_see_activity(user_id, visibility));
create policy "Eigene Aktivitäten anlegen" on public.activities for insert to authenticated with check (user_id = auth.uid());
create policy "Eigene Aktivitäten ändern" on public.activities for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Eigene Aktivitäten löschen" on public.activities for delete to authenticated using (user_id = auth.uid());

create policy "Follows lesen" on public.follows for select using (true);
create policy "Selbst folgen" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "Entfolgen" on public.follows for delete to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());

create policy "Kudos sichtbarer Aktivitäten" on public.kudos for select
  using (exists (select 1 from public.activities a where a.id = activity_id));
create policy "Kudos geben" on public.kudos for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.activities a where a.id = activity_id));
create policy "Kudos zurücknehmen" on public.kudos for delete to authenticated using (user_id = auth.uid());

create policy "Kommentare sichtbarer Aktivitäten" on public.comments for select
  using (exists (select 1 from public.activities a where a.id = activity_id));
create policy "Kommentieren" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.activities a where a.id = activity_id));
create policy "Kommentar löschen" on public.comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.activities a where a.id = activity_id and a.user_id = auth.uid()));

create policy "Medaillenkatalog lesen" on public.medal_catalog for select using (true);
create policy "Medaillen lesen" on public.user_medals for select using (true);
create policy "Eigene Medaillen melden" on public.user_medals for insert to authenticated with check (user_id = auth.uid());

create policy "Ligaregeln lesen" on public.league_rules for select using (true);
create policy "Gruppen lesen" on public.league_groups for select using (true);
create policy "Ligen lesen" on public.league_members for select using (true);

-- ============================================================================ Rechte

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.profiles, public.activities, public.follows, public.kudos, public.comments to authenticated;
grant insert on public.user_medals to authenticated;

-- Interne Funktionen nur für den Server bzw. pg_cron
revoke execute on function public.close_season(text) from public, anon, authenticated;
revoke execute on function public.form_groups(text) from public, anon, authenticated;
revoke execute on function public.pick_group(text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.delete_my_data() from public, anon;
revoke execute on function public.join_league(text) from public, anon;
revoke execute on function public.leave_league(text) from public, anon;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.join_league(text) to authenticated;
grant execute on function public.leave_league(text) to authenticated;
