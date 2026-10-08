import { useLiveQuery } from 'dexie-react-hooks';
import { ActivityCard, fromLocal } from '../components/activity';
import { IconCalendar, IconDumbbell, IconRecord } from '../components/icons';
import { Card, Stat } from '../components/ui';
import { db } from '../db';
import { navigate, useToday } from '../hooks';
import { addDays, weekStart } from '../lib/dates';
import { formatDurationSec } from '../lib/sports';
import { fmt } from '../lib/stats';
import { useWeekNeeds } from '../needs';
import { INTENSITY_LABELS, WEEKDAY_LABELS } from '../types';
import { SportIcon } from '../components/SportIcon';

/** Training: Woche aus Plan + Erledigtem, Schnellstart und letzte Einheiten. */
export function TrainingHubView() {
  const t = useToday();
  const week = useWeekNeeds(t);
  const recent = useLiveQuery(() => db.activities.orderBy('startTime').reverse().limit(6).toArray(), []);
  const thisWeek = useLiveQuery(() => db.activities.where('date').aboveOrEqual(weekStart(t)).toArray(), [t]);
  const lastWeek = useLiveQuery(() => db.activities.where('date').between(addDays(weekStart(t), -7), weekStart(t), true, false).toArray(), [t]);
  if (!week || !recent || !thisWeek || !lastWeek) return null;
  const sec = thisWeek.reduce((s, a) => s + a.durationSec, 0);
  const pts = thisWeek.reduce((s, a) => s + a.points, 0);
  const planned = week.filter((d) => d.sessions.length || d.done.length).length;
  const done = week.filter((d) => d.done.length).length;

  return (
    <div className="content">
      <div className="grid-3">
        <Stat tile label="Erledigt" value={`${done}/${planned || '–'}`} delta="Trainingstage" />
        <Stat tile label="Zeit" value={formatDurationSec(sec)} delta={`Vorwoche ${formatDurationSec(lastWeek.reduce((s, a) => s + a.durationSec, 0))}`} />
        <Stat tile label="Punkte" value={fmt(pts)} delta={`Vorwoche ${fmt(lastWeek.reduce((s, a) => s + a.points, 0))}`} />
      </div>

      <Card title="Diese Woche" action={<a className="small" href="#/plan">Plan bearbeiten</a>}>
        <div className="week-list">
          {week.map((d) => {
            const isToday = d.date === t;
            const past = d.date < t;
            return (
              <div key={d.date} className={`week-row ${isToday ? 'today' : ''}`}>
                <span className="wd-label">{WEEKDAY_LABELS[d.weekday].slice(0, 2)}</span>
                <div className="grow stack tight">
                  {d.done.map((a) => (
                    <a key={a.uid} href={`#/aktivitaet/${a.id}`} className="session done">
                      <SportIcon sport={a.sport} /> {a.title} ✓
                    </a>
                  ))}
                  {d.sessions.map((s) => (
                    <span key={s.id} className={`session ${past ? 'missed' : ''}`}>
                      <SportIcon sport={s.sport} /> {s.time ? `${s.time} ` : ''}
                      {s.title} · {s.durationMin} min · {INTENSITY_LABELS[s.intensity]}
                    </span>
                  ))}
                  {!d.done.length && !d.sessions.length && <span className="tiny muted">Ruhetag</span>}
                </div>
                <span className="tiny muted tnum">{fmt(d.targets.kcal)} kcal</span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid-3">
        <button className="btn tall primary" onClick={() => navigate('aufzeichnen')}>
          <IconRecord /> Aufzeichnen
        </button>
        <button className="btn tall" onClick={() => navigate('training')}>
          <IconDumbbell /> Kraft
        </button>
        <button className="btn tall" onClick={() => navigate('plan')}>
          <IconCalendar /> Plan
        </button>
      </div>

      <div className="section-title">Letzte Einheiten</div>
      {recent.length === 0 && (
        <div className="empty">
          Noch keine Einheiten. <a href="#/aufzeichnen">Jetzt aufzeichnen</a> oder <a href="#/import">von der Uhr importieren</a>.
        </div>
      )}
      {recent.map((a) => (
        <ActivityCard key={a.id} a={fromLocal(a)} />
      ))}
      {recent.length > 0 && (
        <a className="btn ghost small" href="#/profil" style={{ alignSelf: 'center' }}>
          Alle Aktivitäten im Profil
        </a>
      )}
    </div>
  );
}
