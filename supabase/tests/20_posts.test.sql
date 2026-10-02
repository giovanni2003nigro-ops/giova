-- Sport-Beiträge: KI-Prüfung, Pflicht-Kategorien, Melden, Blockieren, Moderation, Limits.

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dora@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'emil@example.com'),
  ('00000000-0000-0000-0000-0000000000f1', 'finn@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'gina@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'mo@example.com');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'dora', 'Dora'),
  ('00000000-0000-0000-0000-0000000000e1', 'emil', 'Emil'),
  ('00000000-0000-0000-0000-0000000000f1', 'finn', 'Finn'),
  ('00000000-0000-0000-0000-0000000000a1', 'gina', 'Gina'),
  ('00000000-0000-0000-0000-0000000000b1', 'moderator', 'Mo');
insert into public.follows (follower_id, followee_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1');

-- ---------------------------------------------------------------- KI-Prüfung im Client-Modus
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
insert into public.posts (user_id, category, sport, caption, media_type, media_path, moderation)
values ('00000000-0000-0000-0000-0000000000d1', 'rekord', 'laufen', 'Neue 10-km-Bestzeit!', 'image/jpeg',
        '00000000-0000-0000-0000-0000000000d1/posts/1.jpg', '{"sport": true, "unangemessen": false, "grund": "Läuferin im Ziel"}');
-- KI sagt „kein Sport“ – der Client versucht trotzdem „sichtbar“ zu setzen
insert into public.posts (user_id, category, caption, media_type, media_path, status, moderation)
values ('00000000-0000-0000-0000-0000000000d1', 'training', 'Mein Mittagessen im Restaurant', 'image/jpeg',
        '00000000-0000-0000-0000-0000000000d1/posts/2.jpg', 'sichtbar', '{"sport": false, "unangemessen": false}');
-- Ohne Prüfergebnis (kein KI-Schlüssel) → wartet auf Moderation
insert into public.posts (user_id, category, sport, media_type, media_path, duration_s, thumb_path)
values ('00000000-0000-0000-0000-0000000000d1', 'technik', 'gym', 'video/mp4',
        '00000000-0000-0000-0000-0000000000d1/posts/3.mp4', 42.5, '00000000-0000-0000-0000-0000000000d1/posts/3.jpg');
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/1.jpg') = 'sichtbar', 'Sportbeitrag nicht freigeschaltet';
  assert (select status from public.posts where media_path like '%/2.jpg') = 'pruefung', 'Client konnte „sichtbar“ erzwingen';
  assert (select status from public.posts where media_path like '%/3.mp4') = 'pruefung', 'Ungeprüftes Video sofort sichtbar';
  assert (select moderation ->> 'mode' from public.posts where media_path like '%/1.jpg') = 'client', 'Prüfmodus nicht vermerkt';
end $$;

-- ---------------------------------------------------------------- Pflichtfelder & Limits
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path)
  values (auth.uid(), 'urlaub', 'image/jpeg', auth.uid() || '/posts/x.jpg');
  raise exception 'FEHLER: Nicht-Sport-Kategorie akzeptiert';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.posts (user_id, category, caption, media_type, media_path)
  values (auth.uid(), 'training', 'Rabattcode auf www.shop.de', 'image/jpeg', auth.uid() || '/posts/x.jpg');
  raise exception 'FEHLER: Link im Text akzeptiert';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path, duration_s)
  values (auth.uid(), 'training', 'video/mp4', auth.uid() || '/posts/lang.mp4', 90);
  raise exception 'FEHLER: Video über 60 s akzeptiert';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path)
  values (auth.uid(), 'training', 'video/mp4', auth.uid() || '/posts/ohne.mp4');
  raise exception 'FEHLER: Video ohne Länge akzeptiert';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path)
  values (auth.uid(), 'training', 'image/jpeg', '00000000-0000-0000-0000-0000000000e1/fremd.jpg');
  raise exception 'FEHLER: fremdes Medium verknüpft';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path)
  values ('00000000-0000-0000-0000-0000000000e1', 'training', 'image/jpeg', '00000000-0000-0000-0000-0000000000e1/x.jpg');
  raise exception 'FEHLER: Beitrag für fremden Nutzer angelegt';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.posts set status = 'sichtbar' where media_path like '%/2.jpg';
  raise exception 'FEHLER: Status selbst geändert';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Tageslimit
update public.app_config set value = value || '{"max_posts_per_day": 3}' where key = 'moderation';
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  insert into public.posts (user_id, category, media_type, media_path) values (auth.uid(), 'training', 'image/jpeg', auth.uid() || '/posts/4.jpg');
  raise exception 'FEHLER: Tageslimit ignoriert';
exception when check_violation then null;
end $$;
reset role;
update public.app_config set value = value || '{"max_posts_per_day": 10}' where key = 'moderation';

-- ---------------------------------------------------------------- Sichtbarkeit, Likes, Kommentare
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  assert (select count(*) from public.posts where user_id = '00000000-0000-0000-0000-0000000000d1') = 1, 'Ungeprüfte Beiträge für andere sichtbar';
  assert (select count(*) from public.get_posts('all')) = 1, 'get_posts zeigt ungeprüfte Beiträge';
  assert (select count(*) from public.get_posts('following')) = 1, 'Folge-ich-Feed falsch';
  assert (select moderation from public.get_posts('all') limit 1) = '{}'::jsonb, 'Prüfdetails für Fremde sichtbar';
end $$;
insert into public.post_likes (post_id, user_id) select id, auth.uid() from public.posts where media_path like '%/1.jpg';
insert into public.post_comments (post_id, user_id, body) select id, auth.uid(), 'Stark! 🔥' from public.posts where media_path like '%/1.jpg';
do $$ begin
  insert into public.post_comments (post_id, user_id, body) select id, auth.uid(), 'Schau auf https://spam.example' from public.posts where media_path like '%/1.jpg';
  raise exception 'FEHLER: Link im Kommentar akzeptiert';
exception when check_violation then null;
end $$;
do $$ begin
  assert (select likes from public.get_posts('all') limit 1) = 1 and (select has_like from public.get_posts('all') limit 1), 'Like fehlt';
  assert (select comments from public.get_posts('all') limit 1) = 1, 'Kommentar fehlt';
end $$;
reset role;
select pg_temp.login(null);
do $$ begin
  assert (select count(*) from public.get_posts('all')) = 1, 'Gäste sehen freigegebene Beiträge nicht';
end $$;
reset role;

-- ---------------------------------------------------------------- Melden → automatisch ausblenden
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  insert into public.post_reports (post_id, user_id, reason) select id, auth.uid(), 'spam' from public.posts where media_path like '%/1.jpg';
  raise exception 'FEHLER: eigener Beitrag meldbar';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
insert into public.post_reports (post_id, user_id, reason) select id, auth.uid(), 'kein_sport' from public.posts where media_path like '%/1.jpg';
do $$ begin
  insert into public.post_reports (post_id, user_id, reason) select id, auth.uid(), 'spam' from public.posts where media_path like '%/1.jpg';
  raise exception 'FEHLER: doppelt gemeldet';
exception when unique_violation then null;
end $$;
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
insert into public.post_reports (post_id, user_id, reason) select id, auth.uid(), 'kein_sport' from public.posts where media_path like '%/1.jpg';
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/1.jpg') = 'sichtbar', 'Nach 2 Meldungen schon ausgeblendet';
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.post_reports (post_id, user_id, reason, note) select id, auth.uid(), 'unangemessen', 'kein Sport zu sehen' from public.posts where media_path like '%/1.jpg';
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/1.jpg') = 'gesperrt', 'Nach 3 Meldungen nicht ausgeblendet';
  assert (select report_count from public.posts where media_path like '%/1.jpg') = 3, 'Meldungen nicht gezählt';
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  assert (select count(*) from public.get_posts('all')) = 0, 'Gesperrter Beitrag weiter sichtbar';
  assert (select count(*) from public.post_reports) = 1, 'Fremde Meldungen sichtbar';
end $$;
reset role;

-- ---------------------------------------------------------------- Moderation
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  perform public.moderate_post((select id from public.posts limit 1), 'sichtbar');
  raise exception 'FEHLER: Nutzer konnte moderieren';
exception when insufficient_privilege then null;
end $$;
reset role;
insert into public.moderators (user_id) values ('00000000-0000-0000-0000-0000000000b1');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  assert (select count(*) from public.get_posts('review')) = 3, 'Moderator sieht nicht alle zu prüfenden Beiträge';
  assert (select max(report_count) from public.get_posts('review')) = 3, 'Moderator sieht Meldungen nicht';
end $$;
select public.moderate_post(id, 'sichtbar', 'Lauf ist klar zu sehen') from public.posts where media_path like '%/1.jpg';
select public.moderate_post(id, 'abgelehnt', 'Kein Sportbezug') from public.posts where media_path like '%/2.jpg';
select public.moderate_post(id, 'sichtbar') from public.posts where media_path like '%/3.mp4';
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/1.jpg') = 'sichtbar', 'Freigabe fehlgeschlagen';
  assert (select report_count from public.posts where media_path like '%/1.jpg') = 0, 'Meldungen nicht zurückgesetzt';
  assert not exists (select 1 from public.post_reports), 'Erledigte Meldungen nicht gelöscht';
  assert (select status from public.posts where media_path like '%/2.jpg') = 'abgelehnt', 'Ablehnung fehlgeschlagen';
  assert (select moderation ->> 'note' from public.posts where media_path like '%/2.jpg') = 'Kein Sportbezug', 'Begründung fehlt';
end $$;

-- ---------------------------------------------------------------- Blockieren
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
insert into public.posts (user_id, category, sport, media_type, media_path, moderation)
values (auth.uid(), 'outfit', 'laufen', 'image/webp', auth.uid() || '/posts/e1.webp', '{"sport": true, "unangemessen": false}');
insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-0000-0000-0000000000d1');
do $$ begin
  assert (select count(*) from public.get_posts('all') where user_id = '00000000-0000-0000-0000-0000000000d1') = 0, 'Blockierte Person weiter sichtbar';
  assert (select count(*) from public.post_comments where user_id = '00000000-0000-0000-0000-0000000000d1') = 0, 'Kommentare Blockierter sichtbar';
end $$;
reset role;
select set_config('test.post_e1', id::text, false) from public.posts where media_path like '%/e1.webp';
do $$ begin
  assert not exists (select 1 from public.follows where follower_id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1')
                                               and followee_id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1')),
    'Follows nach Blockieren nicht entfernt';
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  assert (select count(*) from public.get_posts('all') where user_id = '00000000-0000-0000-0000-0000000000e1') = 0, 'Blockierende Person sieht man weiter';
  assert (select count(*) from public.blocks) = 0, 'Fremde Blockierungen sichtbar';
end $$;
do $$ begin
  insert into public.post_comments (post_id, user_id, body) values (current_setting('test.post_e1')::uuid, auth.uid(), 'Hallo?');
  raise exception 'FEHLER: Kommentar trotz Blockierung';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.post_likes (post_id, user_id) values (current_setting('test.post_e1')::uuid, auth.uid());
  raise exception 'FEHLER: Like trotz Blockierung';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
delete from public.blocks where blocker_id = auth.uid();
do $$ begin
  assert (select count(*) from public.get_posts('all') where user_id = '00000000-0000-0000-0000-0000000000d1') = 2, 'Nach Entblocken nicht wieder sichtbar';
end $$;
reset role;

-- ---------------------------------------------------------------- Server-Modus: Edge Function entscheidet
update public.app_config set value = value || '{"mode": "server"}' where key = 'moderation';
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
insert into public.posts (user_id, category, sport, media_type, media_path, moderation)
values (auth.uid(), 'wettkampf', 'hyrox', 'image/jpeg', auth.uid() || '/posts/f1.jpg', '{"sport": true, "unangemessen": false}');
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/f1.jpg') = 'pruefung', 'Server-Modus: Client-Ergebnis wurde übernommen';
end $$;
set role service_role;
update public.posts set status = 'sichtbar', moderation = moderation || '{"sport": true}' where media_path like '%/f1.jpg';
reset role;
do $$ begin
  assert (select status from public.posts where media_path like '%/f1.jpg') = 'sichtbar', 'Edge Function konnte nicht freischalten';
end $$;
update public.app_config set value = value || '{"mode": "client"}' where key = 'moderation';

-- ---------------------------------------------------------------- Konto löschen
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.delete_my_data();
reset role;
do $$ begin
  assert not exists (select 1 from public.posts where user_id = '00000000-0000-0000-0000-0000000000d1'), 'Beiträge nach Kontolöschung übrig';
end $$;

select 'Beitragstests bestanden' as ergebnis;
