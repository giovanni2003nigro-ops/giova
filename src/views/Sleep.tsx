import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { BarChart } from '../components/charts';
import { IconTrash } from '../components/icons';
import { Card, Stat, toast } from '../components/ui';
import { db } from '../db';
import { useAppData, useToday } from '../hooks';
import { addDays, dateRange, formatDateShort, formatDuration, relativeDay } from '../lib/dates';
import { sleepDurationMin, summarizeSleep } from '../lib/sleep';
import { fmt } from '../lib/stats';
import type { SleepEntry } from '../types';

const QUALITY_LABELS = ['', 'Sehr schlecht', 'Schlecht', 'Okay', 'Gut', 'Sehr gut'];

export function SleepView() {
  const t = useToday();
  const data = useAppData();
  const entries = useLiveQuery(() => db.sleep.orderBy('date').reverse().toArray(), []) ?? [];

  const [date, setDate] = useState(t);
  const existing = entries.find((e) => e.date === date);
  const last = entries[0];
  const [bedtime, setBedtime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [quality, setQuality] = useState<SleepEntry['quality']>(3);
  const [note, setNote] = useState('');

  // Formular mit vorhandenem Eintrag bzw. den letzten Zeiten vorbelegen
  useEffect(() => {
    const src = existing ?? last;
    if (src) {
      setBedtime(src.bedtime);
      setWakeTime(src.wakeTime);
    }
    setQuality(existing?.quality ?? 3);
    setNote(existing?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, existing?.id, last?.id]);

  const duration = sleepDurationMin(bedtime, wakeTime);
  const target = data?.goals.sleepHours ?? 8;

  const save = async () => {
    const entry: SleepEntry = { date, bedtime, wakeTime, durationMin: duration, quality, ...(note.trim() ? { note: note.trim() } : {}) };
    if (existing?.id != null) await db.sleep.update(existing.id, entry);
    else await db.sleep.add(entry);
    toast(`Schlaf gespeichert: ${formatDuration(duration)}`);
  };

  const stats7 = useMemo(() => summarizeSleep(entries, addDays(t, -6), t, target), [entries, t, target]);
  const stats30 = useMemo(() => summarizeSleep(entries, addDays(t, -29), t, target), [entries, t, target]);
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const chartDays = dateRange(addDays(t, -13), t);

  return (
    <div className="content">
      <Card title="Schlaf eintragen">
        <label className="field">
          <span>Aufgewacht am</span>
          <input className="input" type="date" value={date} max={t} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Ins Bett</span>
            <input className="input" type="time" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
          </label>
          <label className="field">
            <span>Aufgestanden</span>
            <input className="input" type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
          </label>
        </div>
        <div className="hint-box row between">
          <span>Schlafdauer</span>
          <strong className="tnum">{formatDuration(duration)}</strong>
        </div>
        <div className="field">
          <span className="small text-2">
            Qualität: <strong>{QUALITY_LABELS[quality]}</strong>
          </span>
          <div className="quality" role="group" aria-label="Schlafqualität">
            {([1, 2, 3, 4, 5] as const).map((q) => (
              <button key={q} type="button" aria-pressed={quality === q} onClick={() => setQuality(q)} aria-label={`${q} – ${QUALITY_LABELS[q]}`}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>
            Notiz <span className="muted">(optional, z. B. „Kaffee spät“, „Alkohol“)</span>
          </span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn primary block" onClick={save}>
          {existing ? 'Eintrag aktualisieren' : 'Speichern'}
        </button>
      </Card>

      <Card title="Auswertung">
        <div className="grid-2">
          <Stat tile label="Ø Schlaf (7 Tage)" value={stats7.nights ? fmt(stats7.avgMin / 60, 1) : '–'} unit="h" delta={`Ziel ${fmt(target, 1)} h`} />
          <Stat tile label="Ø Qualität" value={stats7.nights ? fmt(stats7.avgQuality, 1) : '–'} unit="/ 5" />
          <Stat tile label="Schlafdefizit (7 Tage)" value={fmt(stats7.debtHours, 1)} unit="h" />
          <Stat
            tile
            label="Regelmäßigkeit"
            value={stats7.nights >= 2 ? `±${fmt(stats7.bedtimeSdMin)}` : '–'}
            unit="min"
            delta={stats7.avgBedtime ? `Ø ins Bett ${stats7.avgBedtime}` : undefined}
          />
        </div>
        {stats30.nights >= 7 && (
          <p className="small text-2">
            Letzte 30 Tage: Ø {fmt(stats30.avgMin / 60, 1)} h, {stats30.nightsBelowTarget} von {stats30.nights} Nächten deutlich unter Ziel.
          </p>
        )}
        <BarChart
          ariaLabel="Schlafdauer pro Nacht"
          bars={chartDays.map((d) => ({ x: d, y: byDate.has(d) ? byDate.get(d)!.durationMin / 60 : null }))}
          target={{ value: target, label: `Ziel ${fmt(target, 1)} h` }}
          unit=" h"
          digits={1}
          valueLabel="Schlaf"
        />
      </Card>

      <Card title="Letzte Nächte">
        {entries.length === 0 && <div className="empty">Noch keine Einträge.</div>}
        <div className="list">
          {entries.slice(0, 14).map((e) => (
            <div className="list-item" key={e.id}>
              <div className="main">
                <div className="title">
                  {relativeDay(e.date) === formatDateShort(e.date) ? formatDateShort(e.date) : relativeDay(e.date)} · {formatDuration(e.durationMin)}
                </div>
                <div className="meta tnum">
                  {e.bedtime}–{e.wakeTime} · Qualität {e.quality}/5{e.note ? ` · ${e.note}` : ''}
                </div>
              </div>
              <button className="icon-btn sm" onClick={() => e.id && db.sleep.delete(e.id)} aria-label="Eintrag löschen">
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
