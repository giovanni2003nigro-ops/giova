-- Sicherheits- und Regeltests (RLS, Trigger, Ligen-Beitritt). Läuft mit psql -v ON_ERROR_STOP=1.

-- Hilfsfunktion: als Nutzer handeln
create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cem@example.com');

-- ---------------------------------------------------------------- Profile
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.profiles (id, username, display_name, sex, home_geohash, region_name, sports)
values ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna', 'w', 'u33d', 'Berlin', '{laufen}');

do $$ begin
  insert into public.profiles (id, username, display_name) values ('00000000-0000-0000-0000-00000000000b', 'fake', 'Fake');
  raise exception 'FEHLER: fremdes Profil konnte angelegt werden';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  update public.profiles set username = 'Ungültig!' where id = auth.uid();
  raise exception 'FEHLER: ungültiger Nutzername akzeptiert';
exception when check_violation then null;
end $$;

reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.profiles (id, username, display_name, sex, home_geohash, region_name)
values ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben', 'm', 'u33e', 'Berlin');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.profiles (id, username, display_name, sex, home_geohash, region_name)
values ('00000000-0000-0000-0000-00000000000c', 'cem', 'Cem', 'm', 'u0yj', 'München');

-- Fremdes Profil ändern hat keine Wirkung
update public.profiles set display_name = 'gehackt' where id = '00000000-0000-0000-0000-00000000000a';
reset role;
do $$ begin
  assert (select display_name from public.profiles where username = 'anna') = 'Anna', 'fremdes Profil wurde geändert';
end $$;

-- ---------------------------------------------------------------- Aktivitäten & Punkte
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.activities (user_id, client_uid, sport, title, started_at, local_date, duration_s, distance_m, visibility, points)
values
  ('00000000-0000-0000-0000-00000000000a', 'a-1', 'laufen', 'Öffentlicher Lauf', now() - interval '3 hours', public.app_today(), 3000, 10000, 'public', 99999),
  ('00000000-0000-0000-0000-00000000000a', 'a-2', 'laufen', 'Privater Lauf', now() - interval '2 hours', public.app_today(), 3000, 10000, 'private', 0),
  ('00000000-0000-0000-0000-00000000000a', 'a-3', 'laufen', 'Nur Follower', now() - interval '1 hour', public.app_today(), 3600, 10000, 'followers', 0);

do $$ begin
  assert (select points from public.activities where client_uid = 'a-1') = 120, 'Punkte nicht vom Server berechnet';
end $$;

-- Punkte lassen sich nicht nachträglich hochsetzen
update public.activities set points = 5000 where client_uid = 'a-1';
do $$ begin
  assert (select points from public.activities where client_uid = 'a-1') = 120, 'Punkte manipulierbar';
end $$;

do $$ begin
  insert into public.activities (user_id, client_uid, sport, title, started_at, local_date, duration_s, distance_m)
  values (auth.uid(), 'a-zukunft', 'laufen', 'Zukunft', now() + interval '3 days', public.app_today() + 3, 3000, 10000);
  raise exception 'FEHLER: Aktivität in der Zukunft akzeptiert';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if;
end $$;

do $$ begin
  insert into public.activities (user_id, client_uid, sport, title, started_at, local_date, duration_s)
  values ('00000000-0000-0000-0000-00000000000b', 'fremd', 'gym', 'Fremd', now(), public.app_today(), 3600);
  raise exception 'FEHLER: Aktivität für fremden Nutzer angelegt';
exception when insufficient_privilege then null;
end $$;

-- Unrealistisches Tempo gibt 0 Punkte
insert into public.activities (user_id, client_uid, sport, title, started_at, local_date, duration_s, distance_m)
values (auth.uid(), 'a-auto', 'laufen', 'Mit dem Auto', now() - interval '5 hours', public.app_today(), 600, 10000);
do $$ begin
  assert (select points from public.activities where client_uid = 'a-auto') = 0, 'Autofahrt gibt Punkte';
end $$;

-- ---------------------------------------------------------------- Sichtbarkeit
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.activities where user_id = '00000000-0000-0000-0000-00000000000a') = 2,
    'Ben sollte nur die öffentlichen Aktivitäten sehen';
  assert (select count(*) from public.get_feed('user', null, 20, '00000000-0000-0000-0000-00000000000a')) = 2, 'Feed zeigt Privates';
end $$;

insert into public.follows (follower_id, followee_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.activities where user_id = '00000000-0000-0000-0000-00000000000a') = 3,
    'Follower sollte Follower-Aktivitäten sehen';
  assert (select count(*) from public.get_feed('following')) = 3, 'Following-Feed unvollständig';
  assert (select count(*) from public.get_feed('nearby')) = 2, 'Umgebungs-Feed sollte nur Öffentliches zeigen';
end $$;

do $$ begin
  insert into public.follows (follower_id, followee_id) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a');
  raise exception 'FEHLER: im Namen eines anderen gefolgt';
exception when insufficient_privilege then null;
end $$;

-- Kudos & Kommentare
insert into public.kudos (activity_id, user_id) select id, auth.uid() from public.activities where client_uid = 'a-1';
insert into public.comments (activity_id, user_id, body) select id, auth.uid(), 'Stark! 💪' from public.activities where client_uid = 'a-1';
do $$ begin
  insert into public.kudos (activity_id, user_id)
  select id, auth.uid() from public.activities where client_uid = 'a-2';
  -- a-2 ist privat und für Ben unsichtbar → das Select liefert nichts
  assert not exists (select 1 from public.kudos k join public.activities a on a.id = k.activity_id where a.client_uid = 'a-2'), 'Kudos für Privates';
end $$;
do $$ begin
  assert (select kudos from public.get_feed('following') where title = 'Öffentlicher Lauf') = 1, 'Kudos nicht gezählt';
  assert (select has_kudo from public.get_feed('following') where title = 'Öffentlicher Lauf'), 'has_kudo falsch';
  assert (select comments from public.get_feed('following') where title = 'Öffentlicher Lauf') = 1, 'Kommentare nicht gezählt';
end $$;

-- Cem (nicht Follower) sieht Follower-Aktivität nicht
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.activities where visibility = 'followers') = 0, 'Follower-Aktivität für Fremde sichtbar';
  assert (select count(*) from public.get_feed('nearby')) = 0, 'Umgebung München sollte Berlin nicht zeigen';
end $$;

-- Anonyme Besucher sehen nur Öffentliches und dürfen nichts schreiben
reset role;
select pg_temp.login(null);
do $$ begin
  assert (select count(*) from public.activities) = 2, 'anon sieht Nicht-Öffentliches';
end $$;
do $$ begin
  insert into public.kudos (activity_id, user_id) select id, '00000000-0000-0000-0000-00000000000c' from public.activities limit 1;
  raise exception 'FEHLER: anon konnte Kudos geben';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- Medaillen
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.user_medals (user_id, medal_key, period, earned_on, points)
values (auth.uid(), 'lauf_10k', 'egal', public.app_today(), 100000);
do $$ begin
  assert (select points from public.user_medals where medal_key = 'lauf_10k') = 100, 'Medaillenpunkte nicht aus dem Katalog';
  assert (select period from public.user_medals where medal_key = 'lauf_10k') = '', 'Einmalige Medaille mit Saison';
end $$;
do $$ begin
  insert into public.user_medals (user_id, medal_key, period, earned_on) values (auth.uid(), 'protein_7', '1999-01', public.app_today());
  raise exception 'FEHLER: falsche Saison akzeptiert';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if;
end $$;
do $$ begin
  insert into public.user_medals (user_id, medal_key, earned_on) values (auth.uid(), 'erfunden', public.app_today());
  raise exception 'FEHLER: unbekannte Medaille akzeptiert';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if;
end $$;
insert into public.user_medals (user_id, medal_key, period, earned_on)
values (auth.uid(), 'protein_7', public.current_season(), public.app_today());
do $$ begin
  insert into public.user_medals (user_id, medal_key, period, earned_on) values (auth.uid(), 'protein_7', public.current_season(), public.app_today());
  raise exception 'FEHLER: Medaille doppelt vergeben';
exception when unique_violation then null;
end $$;

-- ---------------------------------------------------------------- Ligen
-- 30 km in 30 Tagen (Silber über den Umfang), Ø 5:20 /km bei ≥ 20 km → Tempo-Schwelle Gold (≤ 5:45)
select public.join_league('laufen');
do $$
declare m public.league_members;
begin
  select * into m from public.league_members where user_id = auth.uid() and sport = 'laufen';
  assert m.season = public.current_season(), 'falsche Saison';
  assert m.tier = 2, format('Einstufung nach Leistung erwartet Gold (2), ist %s', m.tier);
  assert m.group_id is not null, 'keine Gruppe';
  -- idempotent
  assert (public.join_league('laufen')).group_id = m.group_id, 'zweiter Beitritt ändert Gruppe';
end $$;
do $$ begin
  assert (select count(*) from public.league_standings('laufen')) = 1, 'Tabelle leer';
  -- 3 Läufe (auch der private zählt) + Lauf-Medaille + allgemeine Medaille
  assert (select points from public.league_standings('laufen')) = 120 + 120 + 100 + 100 + 75, 'Saisonpunkte falsch';
  assert (select zone from public.league_standings('laufen')) is null, 'Einzelgruppe ohne Zonen';
end $$;

do $$ begin
  perform public.close_season('2026-01');
  raise exception 'FEHLER: Nutzer darf die Saison schließen';
exception when insufficient_privilege then null;
end $$;

-- Ben (keine Aktivitäten, gleiche Region) landet in Bronze, Cem (München) ebenfalls –
-- beide in Bronze: Ben und Cem teilen sich keinen Geohash-Anfang außer „u“ und kommen in dieselbe Gruppe
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.join_league('laufen');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select public.join_league('laufen');
reset role;
do $$ begin
  assert (select tier from public.league_members where user_id = '00000000-0000-0000-0000-00000000000b') = 0, 'Ben nicht Bronze';
  assert (select count(distinct group_id) from public.league_members where tier = 0) = 1, 'Bronze sollte eine Gruppe sein';
  assert (select count(*) from public.league_groups) = 2, 'Gold und Bronze sollten je eine Gruppe haben';
end $$;

-- Konto löschen entfernt alle Community-Daten
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.delete_my_data();
reset role;
do $$ begin
  assert not exists (select 1 from public.profiles where username = 'ben'), 'Profil nicht gelöscht';
  assert not exists (select 1 from public.kudos where user_id = '00000000-0000-0000-0000-00000000000b'), 'Kudos nicht gelöscht';
  assert not exists (select 1 from public.league_members where user_id = '00000000-0000-0000-0000-00000000000b'), 'Liga nicht gelöscht';
end $$;

select 'Sicherheitstests bestanden' as ergebnis;
