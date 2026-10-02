import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { generateCoachReport } from '../ai/coach';
import { useLiveQuery } from 'dexie-react-hooks';
import { ActivityCard, fromLocal } from '../components/activity';
import { IconCamera, IconDumbbell, IconMoon, IconRecord, IconSparkle } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { Card, ErrorBox, Meter, Stat } from '../components/ui';
import { db, useKV } from '../db';
import { navigate, useAnalysis, useApiKey, useAppData, useToday } from '../hooks';
import { addDays, formatDateLong, formatDuration, weekStart } from '../lib/dates';
import { seasonOf } from '../lib/leagues';
import { formatDurationSec } from '../lib/sports';
import { useDayNeeds } from '../needs';
import { sumMacros } from '../lib/nutrition';
import { fmt, fmtSigned } from '../lib/stats';
import type { CoachReport } from '../types';
import { GOAL_SHORT } from '../types';
import { TrendBadge } from './Training';

export function DashboardView() {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const needs = useDayNeeds(t);
  const activities = useLiveQuery(() => db.activities.where('date').aboveOrEqual(addDays(t, -40)).toArray(), [t]);
  const seasonMedalPts = useLiveQuery(() => db.medals.filter((m) => m.date.startsWith(seasonOf(t))).toArray(), [t]);
  if (!data || !analysis) return null;

  const todayMeals = data.meals.filter((m) => m.date === t);
  const eaten = sumMacros(todayMeals);
  const todaySets = data.sets.filter((s) => s.date === t);
  const todayExercises = [...new Set(todaySets.map((s) => s.exercise))];
  const lastNight = data.sleep.find((s) => s.date === t);
  const g = data.goals;
  const target = needs?.targets ?? g;
  const isEmpty = !data.meals.length && !data.sets.length && !data.sleep.length && !data.weights.length && !activities?.length;
  const week = (activities ?? []).filter((a) => a.date >= weekStart(t)).sort((a, b) => b.startTime - a.startTime);
  const seasonPts =
    (activities ?? []).filter((a) => a.date.startsWith(seasonOf(t))).reduce((s, a) => s + a.points, 0) +
    (seasonMedalPts ?? []).reduce((s, m) => s + m.points, 0);

  const problems = analysis.recommendations.filter((r) => r.severity !== 'ok');
  const good = analysis.recommendations.filter((r) => r.severity === 'ok');
  const score = analysis.score.total;

  return (
    <div className="content">
      <div>
        <div className="small muted">{formatDateLong(t)}</div>
        <h1>
          Ziel: {GOAL_SHORT[g.type]} · Ø {fmt(g.kcal)} kcal · {fmt(g.protein)} g Protein
        </h1>
      </div>

      {isEmpty && (
        <Card title="Willkommen bei Giova Fit 👋">
          <ol className="small text-2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>
              Lege unter <a href="#/ziele">Ziele</a> dein Ziel (Defizit, Erhalt, Aufbau, Kraft …), dein Profil und dein Gewicht fest.
            </li>
            <li>
              <a href="#/aufzeichnen">Zeichne</a> Läufe, Radfahrten, Schwimmen, Hyrox oder Gym auf – oder importiere sie von deiner Garmin-Uhr. Jede Aktivität
              bringt Punkte für deine <a href="#/ligen">Liga</a>.
            </li>
            <li>
              Hinterlege deinen <a href="#/plan">Trainingsplan und Alltag</a> – dann berechnet die App deinen Bedarf für jeden Tag.
            </li>
            <li>
              Trage im Gym unter <a href="#/training">Training</a> jeden Satz ein – Übung, Gewicht, Wiederholungen.
            </li>
            <li>
              Erfasse dein <a href="#/essen">Essen</a> – Nährwerttabellen einfach fotografieren.
            </li>
            <li>
              Trag morgens deinen <a href="#/schlaf">Schlaf</a> ein.
            </li>
            <li>
              Für Foto-Erkennung, KI-Plan und Coach den KI-Schlüssel (Claude API) in den <a href="#/einstellungen">Einstellungen</a> hinterlegen.
            </li>
          </ol>
          <p className="small muted">Ich vergleiche dann alles mit deinen Zielen und sage dir, was du ändern solltest.</p>
        </Card>
      )}

      {score != null && (
        <Card>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <div className="stat">
              <span className="label">Zielerreichung (7 Tage)</span>
              <span className="hero">{Math.round(score * 100)} %</span>
            </div>
            <span className="small muted" style={{ textAlign: 'right' }}>
              {problems.filter((p) => p.severity === 'warn' || p.severity === 'alert').length} Abweichungen
              <br />
              {good.length} Ziele im Plan
              <br />
              <span className="tiny">Details hinter dem (!) oben</span>
            </span>
          </div>
          <div className="chips">
            {analysis.score.parts.map((p) => (
              <span className="badge" key={p.key}>
                {p.label} {Math.round(p.value * 100)} %
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="Heute">
        <Meter label="Kalorien" value={eaten.kcal} target={target.kcal} unit=" kcal" />
        <div className="grid-3">
          <Meter compact label="Protein" value={eaten.protein} target={target.protein} unit=" g" />
          <Meter compact label="Kohlenh." value={eaten.carbs} target={target.carbs} unit=" g" />
          <Meter compact label="Fett" value={eaten.fat} target={target.fat} unit=" g" />
        </div>
        {needs && needs.delta !== 0 && (
          <p className="tiny muted">
            Tagesziel angepasst an Training & Alltag ({needs.delta > 0 ? '+' : ''}
            {fmt(needs.delta)} kcal ggü. deinem Schnitt).
          </p>
        )}
        <div className="grid-2">
          <Stat
            tile
            label="Training"
            value={todaySets.length ? `${todaySets.length} Sätze` : '–'}
            delta={todayExercises.length ? todayExercises.slice(0, 3).join(', ') : `${analysis.trainingDays7} von ${g.trainingDays} diese Woche`}
          />
          <Stat
            tile
            label="Letzte Nacht"
            value={lastNight ? formatDuration(lastNight.durationMin) : '–'}
            delta={lastNight ? `Qualität ${lastNight.quality}/5` : 'noch nicht eingetragen'}
          />
        </div>
        {analysis.weight && (
          <p className="small text-2 tnum">
            Gewicht Ø 7 Tage: <strong>{fmt(analysis.weight.avg7, 1)} kg</strong>
            {analysis.weight.ratePerWeek != null && ` · Trend ${fmtSigned(analysis.weight.ratePerWeek, 2)} kg/Woche (Ziel ${fmtSigned(g.weeklyRate, 2)})`}
          </p>
        )}
      </Card>

      <div className="grid-2">
        <button className="btn primary" onClick={() => navigate('aufzeichnen')}>
          <IconRecord /> Aufzeichnen
        </button>
        <button className="btn" onClick={() => navigate('training')}>
          <IconDumbbell /> Satz
        </button>
        <button className="btn" onClick={() => navigate('essen')}>
          <IconCamera /> Scannen
        </button>
        <button className="btn" onClick={() => navigate('schlaf')}>
          <IconMoon /> Schlaf
        </button>
      </div>

      <Card title="Diese Woche" action={<a className="small" href="#/ligen">Liga</a>}>
        <div className="grid-3">
          <Stat tile label="Aktivitäten" value={week.length} />
          <Stat tile label="Zeit" value={formatDurationSec(week.reduce((s, a) => s + a.durationSec, 0))} />
          <Stat tile label="Punkte (Monat)" value={fmt(seasonPts)} />
        </div>
        {week[0] && <ActivityCard a={fromLocal(week[0])} />}
      </Card>

      {analysis.trends.length > 0 && (
        <Card title="Kraftentwicklung" action={<a className="small" href="#/training">Details</a>}>
          <div className="list">
            {analysis.trends.slice(0, 6).map((tr) => (
              <div className="list-item" key={tr.exercise}>
                <div className="main">
                  <div className="title">{tr.exercise}</div>
                </div>
                <TrendBadge status={tr.status} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <CoachReportCard />
    </div>
  );
}

function CoachReportCard() {
  const apiKey = useApiKey();
  const stored = useKV<CoachReport | null>('coachReport', null);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    if (!apiKey) return navigate('einstellungen');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    setStreaming('');
    try {
      await generateCoachReport(apiKey, setStreaming, ctrl.signal);
      setStreaming('');
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const text = busy ? streaming : stored?.text;
  return (
    <Card
      title={
        <div className="row">
          <IconSparkle width={20} height={20} />
          <h2>KI-Coach-Analyse</h2>
        </div>
      }
    >
      <p className="small text-2">
        Die KI wertet Training, Ernährung, Schlaf und Gewicht gegen deine Ziele aus und sagt dir, was du konkret ändern solltest.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      {text ? <Markdown text={text} /> : busy && <div className="typing"><span /><span /><span /></div>}
      {stored && !busy && <p className="tiny muted">Erstellt am {new Date(stored.createdAt).toLocaleString('de-DE')}</p>}
      <button className="btn primary block" onClick={busy ? () => abortRef.current?.abort() : run}>
        {busy ? 'Abbrechen' : !apiKey ? 'API-Schlüssel einrichten' : stored ? 'Neue Analyse erstellen' : 'Analyse erstellen'}
      </button>
    </Card>
  );
}
