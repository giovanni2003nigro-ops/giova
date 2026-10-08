import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { openCoach } from '../coachBus';
import { IconCalendar, IconDumbbell, IconFood, IconHome, IconMoon, IconPulse, IconSparkle, IconTarget, IconTrend } from '../components/icons';
import { SportIcon } from '../components/SportIcon';
import { db, useKV } from '../db';
import { useAnalysis, useAppData, useToday } from '../hooks';
import { movingAverage } from '../lib/body';
import { addDays, formatDateLong, formatDuration, weekStart } from '../lib/dates';
import { sumMacros } from '../lib/nutrition';
import { SPORT_DEFS } from '../lib/sports';
import { fmt, fmtSigned } from '../lib/stats';
import { useDayNeeds, useNutrients, useWeekNeeds } from '../needs';
import { GOAL_SHORT, WEEKDAY_SHORT } from '../types';

/**
 * „Ich“: alles rund ums eigene Training und Essen auf einen Blick – Kacheln wie eine For-You-Page.
 * Jede Kachel zeigt das Wichtigste und führt zur ausführlichen Seite.
 */
export function MeView() {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const needs = useDayNeeds(t);
  const week = useWeekNeeds(t);
  const nutrients = useNutrients();
  const onboarded = useKV<boolean>('onboarded', false);
  const meals = useLiveQuery(() => db.meals.where('date').equals(t).toArray(), [t]);
  const weekActs = useLiveQuery(() => db.activities.where('date').aboveOrEqual(weekStart(t)).toArray(), [t]);
  if (!data || !analysis || !needs || !week || !meals || !weekActs) return null;

  const eaten = sumMacros(meals);
  const target = needs.targets;
  const left = Math.round(target.kcal - eaten.kcal);
  const lastNight = data.sleep.find((s) => s.date === t);
  const today = [...needs.done.map((a) => ({ key: a.uid, sport: a.sport, text: a.title, done: true })), ...needs.sessions.map((s) => ({ key: s.id, sport: s.sport, text: `${s.time ? `${s.time} ` : ''}${s.title}`, done: false }))];
  const plannedWeek = week.filter((d) => d.sessions.length || d.done.length).length;
  const doneWeek = week.filter((d) => d.done.length).length;
  const km = weekActs.reduce((s, a) => s + (SPORT_DEFS[a.sport].distance ? (a.distanceM ?? 0) / 1000 : 0), 0);
  const trend = analysis.weight;
  const spark = movingAverage(data.weights.filter((w) => w.date >= addDays(t, -42)));
  const rising = analysis.trends.filter((x) => x.status === 'fortschritt' || x.status === 'starker-fortschritt').length;
  const problems = analysis.recommendations.filter((r) => r.severity === 'warn' || r.severity === 'alert').length;
  const score = analysis.score.total;
  const missing = (nutrients?.check.gaps ?? []).filter((g) => g.status === 'zu-wenig' && g.key !== 'kcal').map((g) => g.label.replace(' an Trainingstagen', '')).slice(0, 2);

  return (
    <div className="content me">
      <div>
        <div className="small muted">{formatDateLong(t)}</div>
        <h1>
          {GOAL_SHORT[data.goals.type]} · Ø {fmt(data.goals.kcal)} kcal
        </h1>
      </div>

      {onboarded === false && (
        <a className="tile tile-start" href="#/start">
          <span className="tile-kicker">Neu hier?</span>
          <strong>Einrichtung starten – 2 Minuten</strong>
          <span className="small">Ziele, Alltag und Training einmal durchgehen. Ich zeige dir, wie alles zusammenhängt.</span>
        </a>
      )}

      <div className="tiles">
        <Tile href="#/heute" icon={<IconHome />} title="Heute">
          <div className="row" style={{ gap: 12 }}>
            <Ring value={eaten.kcal} target={target.kcal} />
            <div className="stack tight">
              <span className="tile-value">{fmt(Math.abs(left))}</span>
              <span className="tiny muted">{left >= 0 ? 'kcal übrig' : 'kcal drüber'}</span>
            </div>
          </div>
          <ul className="tile-list">
            {today.length ? (
              today.slice(0, 2).map((x) => (
                <li key={x.key}>
                  <SportIcon sport={x.sport} size={13} /> {x.text}
                  {x.done ? ' ✓' : ''}
                </li>
              ))
            ) : (
              <li>Ruhetag</li>
            )}
          </ul>
        </Tile>

        <Tile href="#/essen" icon={<IconFood />} title="Essen">
          <MacroBar label="P" value={eaten.protein} target={target.protein} />
          <MacroBar label="KH" value={eaten.carbs} target={target.carbs} />
          <MacroBar label="F" value={eaten.fat} target={target.fat} />
          <span className="tiny muted">{missing.length ? `Zuletzt zu wenig: ${missing.join(', ')}` : 'Tracker · Bedarf · Rezepte · Nährstoffe'}</span>
        </Tile>

        <Tile href="#/einheiten" icon={<IconDumbbell />} title="Training">
          <div className="week-dots" aria-label={`${doneWeek} von ${plannedWeek} Trainingstagen erledigt`}>
            {week.map((d) => (
              <span key={d.date} className={`wd ${d.done.length ? 'done' : d.sessions.length ? 'plan' : ''} ${d.date === t ? 'today' : ''}`}>
                <i />
                {WEEKDAY_SHORT[d.weekday][0]}
              </span>
            ))}
          </div>
          <span className="tile-value">
            {doneWeek}/{plannedWeek || '–'}
          </span>
          <span className="tiny muted">Einheiten diese Woche</span>
        </Tile>

        <Tile href="#/entwicklung" icon={<IconTrend />} title="Entwicklung">
          {spark.length > 1 ? <Sparkline values={spark.map((p) => p.value)} /> : <span className="tiny muted">Gewicht eintragen für den Verlauf</span>}
          <ul className="tile-list">
            {trend && <li>Gewicht {fmt(trend.avg7, 1)} kg{trend.ratePerWeek != null ? ` (${fmtSigned(trend.ratePerWeek, 2)}/Wo.)` : ''}</li>}
            <li>Kraft: {rising ? `${rising} Übung${rising > 1 ? 'en' : ''} steigen` : 'stabil'}</li>
            <li>Ausdauer: {fmt(km, 1)} km diese Woche</li>
          </ul>
        </Tile>

        <Tile href="#/analyse" icon={<IconPulse />} title="Analyse">
          <span className="tile-value big">{score != null ? `${Math.round(score * 100)} %` : '–'}</span>
          <span className="tiny muted">Zielerreichung (7 Tage)</span>
          <span className="small">{problems ? `${problems} Abweichung${problems > 1 ? 'en' : ''}` : 'Alles im Plan ✓'}</span>
        </Tile>

        <button className="tile tile-coach" onClick={() => openCoach()}>
          <span className="tile-head">
            <IconSparkle /> Coach
          </span>
          <span className="small">Frag mich alles – Training, Essen, Schlaf, Pläne.</span>
          <span className="chip">„Was esse ich heute noch?“</span>
        </button>
      </div>

      <div className="tiles small3">
        <Tile href="#/schlaf" icon={<IconMoon />} title="Schlaf">
          <span className="small">{lastNight ? formatDuration(lastNight.durationMin) : 'eintragen'}</span>
        </Tile>
        <Tile href="#/ziele" icon={<IconTarget />} title="Ziele">
          <span className="small">{GOAL_SHORT[data.goals.type]}</span>
        </Tile>
        <Tile href="#/plan" icon={<IconCalendar />} title="Plan">
          <span className="small">{data.plan ? `${data.plan.sessions.length} Einheiten` : 'anlegen'}</span>
        </Tile>
      </div>
    </div>
  );
}

function Tile({ href, icon, title, children }: { href: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <a className="tile" href={href}>
      <span className="tile-head">
        {icon} {title}
      </span>
      {children}
    </a>
  );
}

/** Fortschritt zum Tagesziel als Ring (Wert steht daneben). */
function Ring({ value, target }: { value: number; target: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, target > 0 ? value / target : 0);
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${fmt(value)} von ${fmt(target)} kcal`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--accent-track)" strokeWidth="7" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${c * p} ${c}`}
        transform="rotate(-90 28 28)"
        className="ring-fill"
      />
    </svg>
  );
}

function MacroBar({ label, value, target }: { label: string; value: number; target: number }) {
  const p = Math.min(1, target > 0 ? value / target : 0);
  return (
    <div className="macro-mini">
      <span className="tiny">{label}</span>
      <span className="bar">
        <i style={{ width: `${p * 100}%` }} />
      </span>
      <span className="tiny tnum">{fmt(value)}/{fmt(target)}</span>
    </div>
  );
}

/** Kleiner Verlauf ohne Achsen – die Zahl steht in der Kachel daneben. */
function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
