import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Card } from '../components/ui';
import { db, getKV } from '../db';
import { useToday } from '../hooks';
import { formatDateShort } from '../lib/dates';
import { seasonLabel, seasonOf } from '../lib/leagues';
import { CATEGORY_LABELS, medalProgress, type MedalCategory } from '../lib/medals';
import { SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Goals, TrainingPlan } from '../types';
import { DEFAULT_GOALS } from '../types';

export function MedalsView() {
  const t = useToday();
  const data = useLiveQuery(async () => {
    const [activities, sets, meals, sleep, weights, goals, plan, earned] = await Promise.all([
      db.activities.toArray(),
      db.sets.toArray(),
      db.meals.toArray(),
      db.sleep.toArray(),
      db.weights.toArray(),
      getKV<Goals>('goals', DEFAULT_GOALS),
      getKV<TrainingPlan | null>('trainingPlan', null),
      db.medals.toArray(),
    ]);
    return { ctx: { today: t, activities, sets, meals, sleep, weights, goals, plan }, earned };
  }, [t]);
  const progress = useMemo(() => (data ? medalProgress(data.ctx) : []), [data]);
  if (!data) return null;

  const season = seasonOf(t);
  const earnedIds = new Set(data.earned.map((m) => m.id));
  const totalPoints = data.earned.reduce((s, m) => s + m.points, 0);
  const seasonPts = data.earned.filter((m) => m.date.startsWith(season)).reduce((s, m) => s + m.points, 0);
  const byCat = new Map<MedalCategory, typeof progress>();
  for (const p of progress) byCat.set(p.def.category, [...(byCat.get(p.def.category) ?? []), p]);

  return (
    <div className="content">
      <Card>
        <div className="grid-3">
          <div className="stat">
            <span className="label">Medaillen</span>
            <span className="value">{data.earned.length}</span>
          </div>
          <div className="stat">
            <span className="label">Bonuspunkte gesamt</span>
            <span className="value">{fmt(totalPoints)}</span>
          </div>
          <div className="stat">
            <span className="label">{seasonLabel(season)}</span>
            <span className="value">+{fmt(seasonPts)}</span>
          </div>
        </div>
        <p className="tiny muted">Monats-Medaillen (🔁) kannst du jede Saison neu verdienen. Die Punkte zählen in deinen Ligen.</p>
      </Card>

      {[...byCat.entries()].map(([cat, list]) => (
        <Card key={cat} title={CATEGORY_LABELS[cat]}>
          <div className="medal-grid">
            {list.map(({ def, check }) => {
              const id = def.repeat === 'once' ? `${def.key}:` : `${def.key}:${season}`;
              const got = earnedIds.has(id);
              const earned = data.earned.find((m) => m.id === id);
              const times = data.earned.filter((m) => m.key === def.key).length;
              return (
                <div key={def.key} className={`medal ${got ? 'got' : ''}`}>
                  <span className="medal-emoji" aria-hidden="true">
                    {def.emoji}
                  </span>
                  <div className="grow">
                    <div className="title">
                      {def.label} {def.repeat === 'season' && <span title="jede Saison neu">🔁</span>}
                    </div>
                    <div className="tiny muted">
                      {def.description}
                      {def.sport ? ` · ${SPORT_DEFS[def.sport].label}` : ''}
                    </div>
                    {got ? (
                      <div className="tiny" style={{ color: 'var(--good-text)', fontWeight: 600 }}>
                        ✓ {earned ? formatDateShort(earned.date) : ''} {times > 1 ? `· ${times}× verdient` : ''}
                      </div>
                    ) : (
                      <>
                        <div className="meter-track thin" role="progressbar" aria-valuenow={Math.round(check.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={def.label}>
                          <div className="meter-fill" style={{ width: `${Math.round(check.progress * 100)}%` }} />
                        </div>
                        <div className="tiny muted tnum">{check.text}</div>
                      </>
                    )}
                  </div>
                  <span className="points-chip">+{def.points}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
