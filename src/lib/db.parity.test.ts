/**
 * Abgleich App ↔ Server: prüft gegen eine echte Postgres-Datenbank mit den Supabase-Migrationen,
 * dass Punkte, Liga-Einstufung und Saisonabschluss in SQL genauso rechnen wie in TypeScript.
 * Läuft nur über `npm run test:db` (setzt DB_PSQL), sonst übersprungen.
 */
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Activity, Sport } from '../types';
import { addDays, toISODate } from './dates';
import { closeGroup, LEAGUE_RULES, seasonPoints, seasonRange, sportPerformance } from './leagues';
import { MEDAL_BY_KEY, MEDALS } from './medals';
import { activityPoints } from './points';
import vectors from './points.vectors.json';

const PSQL = process.env.DB_PSQL;

function exec(query: string): string {
  return execSync(`${PSQL} -X -q -At -v ON_ERROR_STOP=1`, { input: query, encoding: 'utf8' }).trim();
}
/** Führt eine Abfrage aus, die genau einen JSON-Wert liefert. */
function sql<T = unknown>(query: string): T {
  const out = exec(query);
  return (out ? JSON.parse(out) : null) as T;
}
const lit = (v: string | number | boolean | null | undefined) =>
  v == null ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);

/** Deterministischer Zufall (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!PSQL)('Server rechnet wie die App', () => {
  it('berechnet dieselben Punkte', () => {
    const rows = (vectors as { sport: Sport; durationSec: number; distanceM?: number; elevationGainM?: number; race?: boolean; points: number }[])
      .map((v) => `(${lit(v.sport)}, ${v.durationSec}, ${lit(v.distanceM)}::int, ${lit(v.elevationGainM)}::int, ${lit(!!v.race)})`)
      .join(',\n');
    const res = sql<number[]>(`select json_agg(public.activity_points(s, d, m, e, r) order by n)
      from (select row_number() over () as n, * from (values ${rows}) t(s, d, m, e, r)) x;`);
    expect(res).toEqual(vectors.map((v) => v.points));

    // Zusätzlich viele Zufallsfälle
    const rand = rng(7);
    const sports: Sport[] = ['laufen', 'radfahren', 'schwimmen', 'wandern', 'rudern', 'hyrox', 'gym', 'powerlifting'];
    const cases = Array.from({ length: 400 }, () => ({
      sport: sports[Math.floor(rand() * sports.length)],
      durationSec: Math.floor(rand() * 30000) + 1,
      distanceM: rand() < 0.15 ? undefined : Math.floor(rand() * 120000),
      elevationGainM: rand() < 0.5 ? undefined : Math.floor(rand() * 3000),
      race: rand() < 0.3,
    }));
    const vals = cases.map((c) => `(${lit(c.sport)}, ${c.durationSec}, ${lit(c.distanceM)}::int, ${lit(c.elevationGainM)}::int, ${c.race})`).join(',\n');
    const got = sql<number[]>(`select json_agg(public.activity_points(s, d, m, e, r) order by n)
      from (select row_number() over () as n, * from (values ${vals}) t(s, d, m, e, r)) x;`);
    expect(got).toEqual(cases.map((c) => activityPoints({ ...c, hyrox: { race: c.race } })));
  });

  it('hat denselben Medaillenkatalog und dieselben Liga-Schwellen', () => {
    const catalog = sql<{ key: string; points: number; sport: string | null; repeat: string }[]>(
      `select json_agg(c order by key) from public.medal_catalog c;`,
    );
    expect(catalog).toEqual(
      MEDALS.map((m) => ({ key: m.key, points: m.points, sport: m.sport ?? null, repeat: m.repeat })).sort((a, b) => (a.key < b.key ? -1 : 1)),
    );
    const rules = sql<{ sport: Sport; window_days: number; volume_metric: string; volume_thresholds: number[]; intensity_metric: string | null; intensity_thresholds: number[] | null; intensity_lower_better: boolean | null; intensity_min_volume: number | null; intensity_window_days: number | null }[]>(
      `select json_agg(r) from public.league_rules r;`,
    );
    for (const r of rules) {
      const ts = LEAGUE_RULES[r.sport];
      expect({ w: r.window_days, m: r.volume_metric, t: r.volume_thresholds }).toEqual({ w: ts.windowDays, m: ts.volume.metric, t: ts.volume.thresholds });
      expect({ m: r.intensity_metric, t: r.intensity_thresholds, lower: r.intensity_lower_better, min: r.intensity_min_volume, w: r.intensity_window_days }).toEqual(
        ts.intensity
          ? { m: ts.intensity.metric, t: ts.intensity.thresholds, lower: ts.intensity.lowerIsBetter, min: ts.intensity.minVolume, w: ts.intensity.windowDays }
          : { m: null, t: null, lower: null, min: null, w: null },
      );
    }
    expect(rules).toHaveLength(Object.keys(LEAGUE_RULES).length);
  });

  it('stuft ein und schließt die Saison ab wie die App', () => {
    const rand = rng(42);
    const now = new Date();
    const season = toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 15, 12)).slice(0, 7);
    const { from, to } = seasonRange(season);
    const sports: Sport[] = ['laufen', 'powerlifting', 'hyrox'];
    const users = Array.from({ length: 37 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      sex: (rand() < 0.4 ? 'w' : 'm') as 'm' | 'w',
      geohash: ['u33d', 'u33e', 'u0yj', 'u1hc', 'u281'][Math.floor(rand() * 5)],
    }));
    const acts: (Activity & { userId: string })[] = [];
    let n = 0;
    for (const u of users) {
      const count = Math.floor(rand() * 14);
      for (let k = 0; k < count; k++) {
        const sport = sports[Math.floor(rand() * sports.length)];
        const date = addDays(to, -Math.floor(rand() * 45));
        const startTime = Date.parse(`${date}T${String(6 + Math.floor(rand() * 12)).padStart(2, '0')}:00:00Z`);
        const a: Partial<Activity> & { sport: Sport } = { sport };
        if (sport === 'laufen') {
          a.distanceM = 3000 + Math.floor(rand() * 18000);
          a.durationSec = Math.round((a.distanceM / 1000) * (190 + rand() * 320));
        } else if (sport === 'hyrox') {
          a.durationSec = 2400 + Math.floor(rand() * 3600);
          a.hyrox = { race: rand() < 0.25 };
        } else {
          a.durationSec = 3600 + Math.floor(rand() * 3600);
          const lift = (lo: number, hi: number) => (rand() < 0.15 ? undefined : Math.round(lo + rand() * (hi - lo)));
          a.powerlifting = { squat: lift(90, 250), bench: lift(50, 180), deadlift: lift(110, 300), bodyweight: rand() < 0.1 ? undefined : Math.round(55 + rand() * 60) };
        }
        const full: Activity & { userId: string } = {
          userId: u.id,
          uid: `p-${++n}`,
          title: 'x',
          date,
          startTime,
          source: 'manuell',
          visibility: 'public',
          createdAt: 0,
          durationSec: a.durationSec!,
          ...a,
          points: 0,
        };
        full.points = activityPoints(full);
        acts.push(full);
      }
    }
    const seasonMedals = MEDALS.filter((m) => m.repeat === 'season');
    const medals = users.flatMap((u) =>
      rand() < 0.5
        ? [{ userId: u.id, key: seasonMedals[Math.floor(rand() * seasonMedals.length)].key, date: addDays(from, Math.floor(rand() * 20)) }]
        : [],
    );
    const members = users.flatMap((u, i) =>
      sports.map((sport) => ({ userId: u.id, sport, tier: Math.floor(rand() * 6), group: i < 20 ? 0 : 1 })),
    );

    const setup = [
      `delete from public.league_members; delete from public.league_groups;`,
      `insert into auth.users (id) values ${users.map((u) => `(${lit(u.id)})`).join(',')};`,
      `insert into public.profiles (id, username, display_name, sex, home_geohash) values ${users
        .map((u, i) => `(${lit(u.id)}, ${lit(`test_${i}`)}, 'T', ${lit(u.sex)}, ${lit(u.geohash)})`)
        .join(',')};`,
      `insert into public.activities (user_id, client_uid, sport, title, started_at, local_date, duration_s, distance_m, metrics) values ${acts
        .map((a) => {
          const metrics = a.hyrox ? { hyrox: a.hyrox } : a.powerlifting ? { powerlifting: a.powerlifting } : {};
          return `(${lit(a.userId)}, ${lit(a.uid)}, ${lit(a.sport)}, 'x', to_timestamp(${a.startTime / 1000}), ${lit(a.date)}, ${a.durationSec}, ${lit(a.distanceM)}::int, ${lit(JSON.stringify(metrics))}::jsonb)`;
        })
        .join(',\n')};`,
      medals.length
        ? `insert into public.user_medals (user_id, medal_key, period, earned_on) values ${medals
            .map((m) => `(${lit(m.userId)}, ${lit(m.key)}, ${lit(m.date.slice(0, 7))}, ${lit(m.date)})`)
            .join(',')};`
        : '',
      ...sports.flatMap((s) => [0, 1].map(() => `insert into public.league_groups (sport, season, tier) values (${lit(s)}, ${lit(season)}, 0);`)),
      `insert into public.league_members (user_id, sport, season, tier, group_id)
         select m.u::uuid, m.s, ${lit(season)}, m.t,
                (select id from public.league_groups g where g.sport = m.s and g.season = ${lit(season)} order by id offset m.g limit 1)
           from (values ${members.map((m) => `(${lit(m.userId)}, ${lit(m.sport)}, ${m.tier}, ${m.group})`).join(',')}) m(u, s, t, g);`,
      `select public.close_season(${lit(season)});`,
    ].join('\n');
    exec(setup);

    const server = sql<
      { user_id: string; sport: Sport; tier: number; group_id: number; points: number; final_rank: number; outcome: string; new_tier: number; perf_tier: number; volume: number; intensity: number | null }[]
    >(`select json_agg(x) from (
         select m.user_id, m.sport, m.tier, m.group_id, m.points, m.final_rank, m.outcome, m.new_tier,
                p.tier as perf_tier, p.volume, p.intensity
           from public.league_members m
           cross join lateral public.sport_performance(m.user_id, m.sport, ${lit(to)}) p
          where m.season = ${lit(season)}) x;`);
    expect(server).toHaveLength(members.length);

    const medalRows = medals.map((m) => ({ ...m, period: m.date.slice(0, 7), points: MEDAL_BY_KEY.get(m.key)!.points, sport: MEDAL_BY_KEY.get(m.key)!.sport }));
    const byGroup = new Map<string, { userId: string; points: number; tier: number; performanceTier: number }[]>();
    for (const row of server) {
      const u = users.find((x) => x.id === row.user_id)!;
      const mine = acts.filter((a) => a.userId === row.user_id);
      const perf = sportPerformance(row.sport, mine, to, { sex: u.sex, bodyweight: null });
      expect(row.perf_tier, `${row.sport} ${row.user_id}`).toBe(perf.tier);
      expect(row.volume).toBeCloseTo(perf.volume, 6);
      if (perf.intensity == null) expect(row.intensity).toBeNull();
      else expect(row.intensity).toBeCloseTo(perf.intensity, 6);
      const pts = seasonPoints(row.sport, season, mine, medalRows.filter((m) => m.userId === row.user_id));
      expect(row.points, `Saisonpunkte ${row.user_id}`).toBe(pts);
      const key = `${row.sport}:${row.group_id}`;
      byGroup.set(key, [...(byGroup.get(key) ?? []), { userId: row.user_id, points: pts, tier: row.tier, performanceTier: perf.tier }]);
    }
    const outcomes = { auf: 0, ab: 0, bleibt: 0 };
    for (const [key, group] of byGroup) {
      for (const r of closeGroup(group)) {
        const row = server.find((s) => `${s.sport}:${s.group_id}` === key && s.user_id === r.userId)!;
        expect({ rank: row.final_rank, outcome: row.outcome, newTier: row.new_tier }).toEqual({ rank: r.rank, outcome: r.outcome, newTier: r.newTier });
        outcomes[r.outcome]++;
      }
    }
    // Das Szenario deckt alle Fälle ab
    expect(outcomes.auf).toBeGreaterThan(0);
    expect(outcomes.ab).toBeGreaterThan(0);
    expect(outcomes.bleibt).toBeGreaterThan(0);

    // Neue Saison: alle mit Punkten sind dabei, in Gruppen à max. 30
    const next = sql<{ sport: string; tier: number; group_id: number | null; carried: boolean }[]>(`select json_agg(x) from (
      select n.sport, n.tier, n.group_id, true as carried from public.league_members n
       where n.season = to_char(public.season_start(${lit(season)}) + interval '1 month', 'YYYY-MM')) x;`) ?? [];
    expect(next.length).toBe(server.filter((s) => s.points > 0).length);
    expect(next.every((m) => m.group_id != null)).toBe(true);
    const sizes = new Map<number, number>();
    for (const m of next) sizes.set(m.group_id!, (sizes.get(m.group_id!) ?? 0) + 1);
    expect(Math.max(...sizes.values())).toBeLessThanOrEqual(30);
    for (const m of next) {
      const prev = server.find((s) => s.sport === m.sport && s.points > 0 && s.new_tier === m.tier);
      expect(prev).toBeDefined();
    }
  });
});
