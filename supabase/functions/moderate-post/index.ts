// Supabase Edge Function: KI-Prüfung neuer Beiträge auf dem Server (Modus „server“).
//
// Einrichten:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
//   supabase functions deploy moderate-post
//   update public.app_config set value = value || '{"mode": "server"}' where key = 'moderation';
//
// Die App ruft die Funktion nach dem Hochladen mit { id } auf. Sie prüft nur Beiträge,
// die noch „in Prüfung“ sind und noch nicht geprüft wurden – mehrfaches Aufrufen kostet nichts.
// Prompt und Schema entsprechen src/ai/postCheck.ts (bei Änderungen beide anpassen).

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';

const MODEL = 'claude-sonnet-5-5';
const CATEGORIES = ['rekord', 'technik', 'training', 'wettkampf', 'outfit', 'motivation', 'ernaehrung'] as const;

const Verdict = z.object({
  sport: z.boolean().describe('true, wenn Bild/Video und Text klar einen Sportbezug haben'),
  unangemessen: z.boolean().describe('true bei Nacktheit, Gewalt, Hass, Drogen, Werbung/Spam oder sichtbaren privaten Daten'),
  kategorie: z.enum(CATEGORIES).describe('Am besten passende Kategorie'),
  erkannt: z.string().describe('Was ist zu sehen? Ein kurzer Satz'),
  grund: z.string().describe('Kurze Begründung für den Nutzer, besonders wenn abgelehnt'),
});

const RULES = `Du prüfst Beiträge für eine Sport-Community (Laufen, Radfahren, Schwimmen, Wandern, Rudern, Hyrox, Gym, Powerlifting). Erlaubt sind NUR Beiträge mit klarem Sportbezug, zum Beispiel:
- Rekorde und Ergebnisse (Uhr/Anzeige mit Zeit, Hantel mit Gewicht, Zieleinlauf)
- Technik und Anleitungen (wie man läuft, Kniebeuge, Kraulzug …)
- Trainingseinheiten, Workouts, Trainingsorte
- Wettkämpfe (Startnummer, Rennen, Hyrox, Meet)
- Sportoutfits und Ausrüstung (Laufschuhe, Trikot, Gürtel, Uhr)
- Motivation und Fortschritt im Sport
- Sporternährung (Meal-Prep, Verpflegung im Wettkampf)

Nicht erlaubt: Beiträge ohne Sportbezug (Urlaub, Essen ohne Sportbezug, Selfies ohne Sport, Memes, Politik), Nacktheit oder sexualisierte Darstellung, Gewalt, Hass, Drogen, Werbung/Spam/Links, sichtbare private Daten Dritter (Adressen, Kennzeichen, Ausweise).
Ein Sportoutfit-Foto in Sportkleidung ist erlaubt, wenn es nicht sexualisiert ist. Bewerte Bild(er) UND Text zusammen. Bei Videos siehst du Einzelbilder vom Anfang, aus der Mitte und vom Ende.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return json({ error: 'id fehlt' }, 400);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: cfg } = await sb.from('app_config').select('value').eq('key', 'moderation').maybeSingle();
    if ((cfg?.value as { mode?: string } | undefined)?.mode !== 'server') return json({ skipped: 'Modus ist nicht „server“' });

    const { data: post, error } = await sb.from('posts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!post) return json({ error: 'Beitrag nicht gefunden' }, 404);
    if (post.status !== 'pruefung' || post.moderation?.checked_at) return json({ status: post.status });

    // Bilder: Foto selbst bzw. Einzelbilder des Videos (Vorschau + Mitte + Ende)
    const video = String(post.media_type).startsWith('video/');
    const base = String(post.media_path).replace(/\.[a-z0-9]+$/i, '');
    const paths = video ? [post.thumb_path, `${base}-f1.jpg`, `${base}-f2.jpg`].filter(Boolean) : [post.media_path];
    const images: { data: string; type: string }[] = [];
    for (const p of paths) {
      const { data } = await sb.storage.from('media').download(p);
      if (data) images.push({ data: toBase64(await data.arrayBuffer()), type: data.type || 'image/jpeg' });
    }
    if (!images.length) return json({ error: 'Keine Bilder zum Prüfen gefunden' }, 422);

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: RULES,
      output_config: { effort: 'low', format: betaZodOutputFormat(Verdict) },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.type as 'image/jpeg', data: i.data } })),
            {
              type: 'text' as const,
              text: `${video ? 'Video (Einzelbilder oben)' : 'Foto'}. Gewählte Kategorie: ${post.category}${post.sport ? `, Sportart: ${post.sport}` : ''}.\nText des Beitrags: ${post.caption ? `„${post.caption}“` : '(kein Text)'}\n\nDarf das veröffentlicht werden?`,
            },
          ],
        },
      ],
    } as never);

    const v =
      res.stop_reason === 'refusal' || !res.parsed_output
        ? { sport: false, unangemessen: true, kategorie: post.category, erkannt: '', grund: 'Von der KI-Prüfung abgelehnt.' }
        : (res.parsed_output as z.infer<typeof Verdict>);
    const status = v.sport && !v.unangemessen ? 'sichtbar' : 'abgelehnt';
    const { error: upd } = await sb
      .from('posts')
      .update({ status, moderation: { ...post.moderation, ...v, mode: 'server', checked_at: new Date().toISOString() } })
      .eq('id', id)
      .eq('status', 'pruefung');
    if (upd) throw upd;
    return json({ status, grund: v.grund });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
