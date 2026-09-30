-- Supabase-spezifische Teile: monatlicher Saisonabschluss (pg_cron) und Speicher für Fotos.
-- Beide Blöcke laufen nur, wenn die Erweiterung bzw. das Storage-Schema vorhanden ist.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 00:15 UTC am Monatsersten = nach Mitternacht in Berlin → Vormonat abschließen
    perform cron.schedule(
      'giova-close-season',
      '15 0 1 * *',
      $cron$select public.close_season(to_char(public.app_today() - 1, 'YYYY-MM'))$cron$
    );
  else
    raise notice 'pg_cron ist nicht verfügbar: close_season(<Saison>) bitte monatlich selbst aufrufen.';
  end if;
exception when insufficient_privilege then
  raise notice 'pg_cron konnte nicht eingerichtet werden (%). In Supabase unter Database → Extensions aktivieren.', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
    execute $p$create policy "Medien lesen" on storage.objects for select using (bucket_id = 'media')$p$;
    execute $p$create policy "Eigene Medien hochladen" on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "Eigene Medien ersetzen" on storage.objects for update to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "Eigene Medien löschen" on storage.objects for delete to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
