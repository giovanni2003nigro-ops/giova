import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { generateCoachReport } from '../ai/coach';
import { IconCamera, IconDumbbell, IconMoon, IconRecord, IconSparkle } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { Card, ErrorBox, Meter, Stat } from '../components/ui';
import { useKV } from '../db';
import { navigate, useAnalysis, useApiKey, useAppData, useToday } from '../hooks';
import { formatDateLong, formatDuration } from '../lib/dates';
import { SPORT_DEFS } from '../lib/sports';
import { useDayNeeds } from '../needs';
import { sumMacros } from '../lib/nutrition';
import { fmt, fmtSigned } from '../lib/stats';
import type { CoachReport } from '../types';
import { GOAL_SHORT, INTENSITY_LABELS } from '../types';
import { SportIcon } from '../components/SportIcon';

/** „Heute“: Kalorien & Makros, Training des Tages, letzte Nacht und Gewicht. */
export function DashboardView() {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const needs = useDayNeeds(t);
  if (!data || !analysis) return null;

  const todayMeals = data.meals.filter((m) => m.date === t);
  const eaten = sumMacros(todayMeals);
  const todaySets = data.sets.filter((s) => s.date === t);
  const todayExercises = [...new Set(todaySets.map((s) => s.exercise))];
  const lastNight = data.sleep.find((s) => s.date === t);
  const g = data.goals;
  const target = needs?.targets ?? g;

  return (
    <div className="content">
      <div>
        <div className="small muted">{formatDateLong(t)}</div>
        <h1>
          Ziel: {GOAL_SHORT[g.type]} · Ø {fmt(g.kcal)} kcal · {fmt(g.protein)} g Protein
        </h1>
      </div>

      <Card title="Essen heute" action={<a className="small" href="#/essen">Tagebuch</a>}>
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
      </Card>

      <Card title="Training heute" action={<a className="small" href="#/einheiten">Woche</a>}>
        {needs && (needs.done.length > 0 || needs.sessions.length > 0) ? (
          <div className="list">
            {needs.done.map((a) => (
              <a key={a.uid} className="list-item" href={`#/aktivitaet/${a.id}`}>
                <span className="sport-dot" aria-hidden="true"><SportIcon sport={a.sport} /></span>
                <div className="main">
                  <div className="title">{a.title} ✓</div>
                  <div className="meta">+{fmt(a.points)} Punkte</div>
                </div>
              </a>
            ))}
            {needs.sessions.map((s) => (
              <div key={s.id} className="list-item">
                <span className="sport-dot" aria-hidden="true"><SportIcon sport={s.sport} /></span>
                <div className="main">
                  <div className="title">{s.title}</div>
                  <div className="meta">
                    {s.time ? `${s.time} · ` : ''}
                    {s.durationMin} min · {INTENSITY_LABELS[s.intensity]}
                  </div>
                </div>
                <button
                  className="btn small primary"
                  onClick={() => (SPORT_DEFS[s.sport].gps || s.sport === 'schwimmen' || s.sport === 'hyrox' ? navigate('tracker', s.sport) : navigate('training'))}
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="small text-2">Heute ist kein Training geplant – Ruhetag.</p>
        )}
        {todaySets.length > 0 && (
          <p className="tiny muted">
            {todaySets.length} Sätze: {todayExercises.slice(0, 3).join(', ')}
          </p>
        )}
      </Card>

      <div className="grid-2">
        <Stat tile label="Letzte Nacht" value={lastNight ? formatDuration(lastNight.durationMin) : '–'} delta={lastNight ? `Qualität ${lastNight.quality}/5` : 'noch nicht eingetragen'} />
        <Stat
          tile
          label="Gewicht Ø 7 Tage"
          value={analysis.weight ? `${fmt(analysis.weight.avg7, 1)} kg` : '–'}
          delta={analysis.weight?.ratePerWeek != null ? `${fmtSigned(analysis.weight.ratePerWeek, 2)} kg/Woche (Ziel ${fmtSigned(g.weeklyRate, 2)})` : undefined}
        />
      </div>

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
    </div>
  );
}

export function CoachReportCard() {
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
          <h2>Coach-Analyse</h2>
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
