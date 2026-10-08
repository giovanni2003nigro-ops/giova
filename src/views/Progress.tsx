import { useMemo, useState } from 'react';
import { BarChart, LineChart } from '../components/charts';
import { Card, Seg, Stat } from '../components/ui';
import { useAnalysis, useAppData, useToday } from '../hooks';
import { addDays, formatDayMonth } from '../lib/dates';
import { enduranceSports, strengthLines, tempoSeries, weeklyEndurance } from '../lib/progress';
import { formatClock, SPORT_DEFS } from '../lib/sports';
import { fmt, fmtSigned } from '../lib/stats';
import type { Sport } from '../types';
import { WeightCard } from './Goals';
import { TrendBadge } from './Training';
import { SportIcon } from '../components/SportIcon';

type Tab = 'gewicht' | 'kraft' | 'ausdauer';

/** Entwicklung über die Zeit: Gewicht, Kraft, Ausdauer. */
export function ProgressView() {
  const t = useToday();
  const data = useAppData();
  const analysis = useAnalysis(data);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem('progressTab') as Tab) || 'gewicht';
    } catch {
      return 'gewicht';
    }
  });
  const choose = (v: Tab) => {
    setTab(v);
    try {
      sessionStorage.setItem('progressTab', v);
    } catch {
      /* egal */
    }
  };
  if (!data || !analysis) return null;
  return (
    <div className="content">
      <Seg
        label="Bereich"
        value={tab}
        onChange={choose}
        options={[
          { value: 'gewicht', label: 'Gewicht' },
          { value: 'kraft', label: 'Kraft' },
          { value: 'ausdauer', label: 'Ausdauer' },
        ]}
      />
      {tab === 'gewicht' && <WeightCard today={t} goals={data.goals} />}
      {tab === 'kraft' && <Strength />}
      {tab === 'ausdauer' && <Endurance />}
    </div>
  );
}

function Strength() {
  const t = useToday();
  const data = useAppData()!;
  const analysis = useAnalysis(data)!;
  const lines = useMemo(() => strengthLines(data.sets, addDays(t, -180)), [data.sets, t]);
  const [pick, setPick] = useState<string | null>(null);
  if (!lines.length)
    return (
      <div className="empty">
        Noch zu wenig Kraftdaten – ab 2 Einheiten pro Übung siehst du hier den Verlauf. <a href="#/training">Sätze eintragen</a>
      </div>
    );
  const line = lines.find((l) => l.exercise === pick) ?? lines[0];
  const trend = analysis.trends.find((x) => x.exercise === line.exercise);
  const unit = line.metricType === 'e1rm' ? ' kg' : ' Wdh.';
  return (
    <>
      <div className="chips">
        {lines.slice(0, 10).map((l) => (
          <button key={l.exercise} className="chip" aria-pressed={l.exercise === line.exercise} onClick={() => setPick(l.exercise)}>
            {l.exercise}
          </button>
        ))}
      </div>
      <Card title={line.exercise} action={trend ? <TrendBadge status={trend.status} /> : undefined}>
        <div className="grid-3">
          <Stat tile label={line.metricType === 'e1rm' ? 'e1RM jetzt' : 'Max. Wdh.'} value={fmt(line.last, 1)} unit={unit.trim()} />
          <Stat tile label="Bestwert" value={fmt(line.best, 1)} unit={unit.trim()} />
          <Stat tile label="Seit Start" value={fmtSigned(line.last - line.first, 1)} unit={unit.trim()} />
        </div>
        <LineChart
          ariaLabel={`${line.exercise}: ${line.metricType === 'e1rm' ? 'geschätztes Maximalgewicht' : 'maximale Wiederholungen'} je Einheit`}
          unit={unit}
          series={[{ key: 'm', label: line.metricType === 'e1rm' ? 'e1RM' : 'Wiederholungen', color: 'var(--series-1)', points: line.points, dots: true }]}
        />
        <p className="tiny muted">
          {line.metricType === 'e1rm' ? 'Geschätztes 1RM (Epley) des besten Satzes je Einheit, letzte 6 Monate.' : 'Meiste Wiederholungen je Einheit, letzte 6 Monate.'}
        </p>
      </Card>
    </>
  );
}

function Endurance() {
  const t = useToday();
  const data = useAppData()!;
  const sports = useMemo(() => enduranceSports(data.activities), [data.activities]);
  const [pick, setPick] = useState<Sport | null>(null);
  if (!sports.length)
    return (
      <div className="empty">
        Noch keine Ausdauer-Einheiten. <a href="#/aufzeichnen">Aufzeichnen</a> oder <a href="#/import">von der Uhr importieren</a>.
      </div>
    );
  const sport = pick && sports.includes(pick) ? pick : sports[0];
  const def = SPORT_DEFS[sport];
  const weeks = weeklyEndurance(data.activities, sport, 12, t);
  const tempo = tempoSeries(data.activities, sport, addDays(t, -180));
  const speed = def.pace === 'km/h';
  const tempoUnit = def.pace === 'km/h' ? 'km/h' : def.pace === 'min/100m' ? '/100 m' : def.pace === 'min/500m' ? '/500 m' : '/km';
  const showTempo = (v: number) => (speed ? `${fmt(v, 1)} km/h` : `${formatClock(v * 60)} ${tempoUnit}`);
  const last4 = weeks.slice(-4);
  const avgKm = last4.reduce((s, w) => s + w.km, 0) / 4;
  return (
    <>
      {sports.length > 1 && (
        <div className="chips">
          {sports.map((s) => (
            <button key={s} className="chip" aria-pressed={s === sport} onClick={() => setPick(s)}>
              <SportIcon sport={s} /> {SPORT_DEFS[s].label}
            </button>
          ))}
        </div>
      )}
      <Card title={`$<SportIcon sport={def.key} /> Umfang pro Woche`}>
        <div className="grid-2">
          <Stat tile label="Diese Woche" value={fmt(weeks[weeks.length - 1].km, 1)} unit="km" />
          <Stat tile label="Ø letzte 4 Wochen" value={fmt(avgKm, 1)} unit="km" />
        </div>
        <BarChart
          ariaLabel={`${def.label}: Kilometer pro Woche, letzte 12 Wochen`}
          bars={weeks.map((w) => ({ x: w.week, y: w.km }))}
          unit=" km"
          digits={1}
          valueLabel="Kilometer"
          formatX={(x) => formatDayMonth(x)}
          formatTooltipX={(x) => `Woche ab ${formatDayMonth(x)}`}
        />
      </Card>
      <Card title={speed ? 'Geschwindigkeit je Einheit' : 'Tempo je Einheit'}>
        {tempo.length >= 2 ? (
          <>
            <LineChart
              ariaLabel={`${def.label}: ${speed ? 'Geschwindigkeit' : 'Tempo'} je Einheit, letzte 6 Monate`}
              series={[{ key: 'tempo', label: speed ? 'km/h' : 'Tempo', color: 'var(--series-1)', points: tempo, dots: true }]}
              format={showTempo}
              invert={!speed}
            />
            <p className="tiny muted">{speed ? 'Höher = schneller.' : 'Oben = schneller (weniger Minuten pro Strecke).'} Ab 1 km (Schwimmen 400 m), letzte 6 Monate.</p>
          </>
        ) : (
          <p className="small muted">Ab 2 Einheiten siehst du hier, wie sich dein Tempo entwickelt.</p>
        )}
      </Card>
    </>
  );
}
