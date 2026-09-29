import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { generateCoachReport } from '../ai/coach';
import { IconCamera, IconDumbbell, IconFood, IconMoon, IconSparkle } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { Card, ErrorBox, Meter, RecommendationItem, Stat } from '../components/ui';
import { useKV } from '../db';
import { navigate, useAnalysis, useApiKey, useAppData, useToday } from '../hooks';
import { formatDateLong, formatDuration } from '../lib/dates';
import { sumMacros } from '../lib/nutrition';
import { fmt, fmtSigned } from '../lib/stats';
import type { CoachReport } from '../types';
import { GOAL_SHORT } from '../types';
import { TrendBadge } from './Training';

export function DashboardView() {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const [showOk, setShowOk] = useState(false);
  if (!data || !analysis) return null;

  const todayMeals = data.meals.filter((m) => m.date === t);
  const eaten = sumMacros(todayMeals);
  const todaySets = data.sets.filter((s) => s.date === t);
  const todayExercises = [...new Set(todaySets.map((s) => s.exercise))];
  const lastNight = data.sleep.find((s) => s.date === t);
  const g = data.goals;
  const isEmpty = !data.meals.length && !data.sets.length && !data.sleep.length && !data.weights.length;

  const problems = analysis.recommendations.filter((r) => r.severity !== 'ok');
  const good = analysis.recommendations.filter((r) => r.severity === 'ok');
  const score = analysis.score.total;

  return (
    <div className="content">
      <div>
        <div className="small muted">{formatDateLong(t)}</div>
        <h1>
          Ziel: {GOAL_SHORT[g.type]} · {fmt(g.kcal)} kcal · {fmt(g.protein)} g Protein
        </h1>
      </div>

      {isEmpty && (
        <Card title="Willkommen bei Giova Fit 👋">
          <ol className="small text-2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>
              Lege unter <a href="#/ziele">Ziele</a> dein Ziel (Defizit, Erhalt, Aufbau, Kraft …), dein Profil und dein Gewicht fest.
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
              Für Foto-Erkennung und Coach-Chat den Claude-API-Schlüssel in den <a href="#/einstellungen">Einstellungen</a> hinterlegen.
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
        <Meter label="Kalorien" value={eaten.kcal} target={g.kcal} unit=" kcal" />
        <div className="grid-3">
          <Meter compact label="Protein" value={eaten.protein} target={g.protein} unit=" g" />
          <Meter compact label="Kohlenh." value={eaten.carbs} target={g.carbs} unit=" g" />
          <Meter compact label="Fett" value={eaten.fat} target={g.fat} unit=" g" />
        </div>
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
        <button className="btn" onClick={() => navigate('training')}>
          <IconDumbbell /> Satz
        </button>
        <button className="btn" onClick={() => navigate('essen')}>
          <IconFood /> Essen
        </button>
        <button className="btn" onClick={() => navigate('essen')}>
          <IconCamera /> Scannen
        </button>
        <button className="btn" onClick={() => navigate('schlaf')}>
          <IconMoon /> Schlaf
        </button>
      </div>

      <div className="section-title">Zielabgleich & Empfehlungen</div>
      <Card>
        {problems.map((r) => (
          <RecommendationItem key={r.id} rec={r} />
        ))}
        {problems.length === 0 && <p className="small text-2">Keine Abweichungen – alles im Plan. 💪</p>}
        {good.length > 0 && (
          <>
            <button className="btn ghost small" onClick={() => setShowOk((v) => !v)} style={{ alignSelf: 'flex-start' }}>
              {showOk ? 'Ausblenden' : `Was gut läuft (${good.length})`}
            </button>
            {showOk && good.map((r) => <RecommendationItem key={r.id} rec={r} />)}
          </>
        )}
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

      {analysis.insights.length > 0 && (
        <Card title="Zusammenhänge">
          {analysis.insights.map((i) => (
            <div key={i.id} className="hint-box">
              <strong>{i.title}</strong>
              <div>{i.detail}</div>
              <div style={{ marginTop: 4 }}>→ {i.conclusion}</div>
            </div>
          ))}
          <p className="tiny muted">Vergleich jeder Einheit mit der vorherigen Einheit derselben Übung. Aussagekräftiger, je mehr Daten du einträgst.</p>
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
        Claude wertet Training, Ernährung, Schlaf und Gewicht gegen deine Ziele aus und sagt dir, was du konkret ändern solltest.
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
