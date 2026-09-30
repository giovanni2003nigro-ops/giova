import { useEffect, useMemo, useState } from 'react';
import { saveActivity, useShareDefault } from '../activities';
import { ActivityEditor } from '../components/ActivityEditor';
import { IconPause, IconPlay, IconStop } from '../components/icons';
import { RouteMap } from '../components/RouteMap';
import { Card, ErrorBox, Sheet, toast } from '../components/ui';
import { setKV, useKV } from '../db';
import { navigate } from '../hooks';
import { toISODate } from '../lib/dates';
import { trackStats } from '../lib/geo';
import { activityTitle, formatClock, formatDistance, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import { currentSpeed, liveLaps, type TrackerState } from '../lib/tracker';
import {
  coolDown,
  finishTracking,
  pauseTracking,
  resetTracking,
  resumeTracking,
  setAutoPause,
  startTracking,
  useGpsError,
  useTracker,
  warmUp,
} from '../trackerStore';
import type { Sport } from '../types';
import { SPORTS } from '../types';

function paceText(sport: Sport, speed: number | null): string {
  if (!speed || speed <= 0.2) return '–';
  const kind = SPORT_DEFS[sport].pace;
  if (kind === 'km/h') return `${fmt(speed * 3.6, 1)}`;
  const per = kind === 'min/100m' ? 100 : kind === 'min/500m' ? 500 : 1000;
  const sec = per / speed;
  return sec > 3600 ? '–' : formatClock(sec);
}

function paceUnit(sport: Sport): string {
  const kind = SPORT_DEFS[sport].pace;
  return kind === 'km/h' ? 'km/h' : kind === 'min/100m' ? '/100 m' : kind === 'min/500m' ? '/500 m' : '/km';
}

export function TrackerView({ sportParam }: { sportParam?: string }) {
  const s = useTracker();
  const gpsError = useGpsError();
  const shareDefault = useShareDefault();
  const voice = useKV<boolean>('trackerVoice', true);
  const initialSport = (SPORTS as readonly string[]).includes(sportParam ?? '') ? (sportParam as Sport) : s.sport;
  const [sport, setSport] = useState<Sport>(s.status === 'idle' ? initialSport : s.sport);
  const [finished, setFinished] = useState<TrackerState | null>(null);
  const [, setNow] = useState(0);
  const def = SPORT_DEFS[sport];

  useEffect(() => {
    if (s.status === 'idle') warmUp(sport);
    return () => coolDown();
  }, [sport, s.status]);

  // Anzeige jede Sekunde aktualisieren (Zeit läuft auch ohne neue GPS-Punkte)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const route = useMemo(() => s.points.map((p) => [p.lat, p.lon] as [number, number]), [s.points]);
  const laps = useMemo(() => liveLaps(s), [s]);
  const avgSpeed = s.movingMs > 0 && s.distanceM > 0 ? s.distanceM / (s.movingMs / 1000) : null;
  const speed = currentSpeed(s);
  const acc = s.accuracy;
  const gpsLabel = !def.gps ? null : acc == null ? 'Suche GPS …' : acc <= 10 ? 'GPS sehr gut' : acc <= 20 ? 'GPS gut' : acc <= 35 ? 'GPS schwach' : 'GPS zu ungenau';

  const finish = () => {
    if (s.movingMs < 30_000 && s.distanceM < 50) {
      if (!confirm('Die Aufzeichnung ist sehr kurz. Verwerfen?')) return;
      finishTracking();
      resetTracking();
      return;
    }
    setFinished(finishTracking());
  };

  const discard = () => {
    if (!confirm('Aufzeichnung wirklich verwerfen?')) return;
    finishTracking();
    resetTracking();
    setFinished(null);
  };

  return (
    <div className="content tracker">
      {s.status === 'idle' && (
        <div className="chips" role="group" aria-label="Sportart">
          {SPORTS.filter((x) => SPORT_DEFS[x].gps || x === 'schwimmen' || x === 'hyrox').map((x) => (
            <button key={x} className="chip" aria-pressed={x === sport} onClick={() => setSport(x)}>
              {SPORT_DEFS[x].emoji} {SPORT_DEFS[x].label}
            </button>
          ))}
        </div>
      )}

      {def.gps && <RouteMap points={route} live height={s.status === 'idle' ? 220 : 280} />}

      {gpsError && <ErrorBox>{gpsError}</ErrorBox>}

      <Card>
        <div className="row between">
          <span className="badge">
            {def.emoji} {def.label}
          </span>
          {gpsLabel && (
            <span className="badge">
              <span className="status-dot" style={{ background: acc != null && acc <= 20 ? 'var(--good)' : acc != null && acc <= 35 ? 'var(--warning)' : 'var(--critical)' }} />
              {gpsLabel}
            </span>
          )}
        </div>
        <div className="tracker-time tnum" aria-live="off">
          {formatClock(s.movingMs / 1000)}
        </div>
        {s.autoPaused && <div className="badge" style={{ alignSelf: 'center' }}>Auto-Pause</div>}
        {s.status === 'paused' && <div className="badge" style={{ alignSelf: 'center' }}>Pausiert</div>}
        {def.gps && (
          <div className="grid-3 tracker-stats">
            <div className="stat">
              <span className="label">Distanz</span>
              <span className="value tnum">{s.distanceM >= 1000 ? fmt(s.distanceM / 1000, 2) : fmt(s.distanceM)}</span>
              <span className="delta">{s.distanceM >= 1000 ? 'km' : 'm'}</span>
            </div>
            <div className="stat">
              <span className="label">Aktuell</span>
              <span className="value tnum">{paceText(sport, speed)}</span>
              <span className="delta">{paceUnit(sport)}</span>
            </div>
            <div className="stat">
              <span className="label">Ø</span>
              <span className="value tnum">{paceText(sport, avgSpeed)}</span>
              <span className="delta">{paceUnit(sport)}</span>
            </div>
          </div>
        )}
      </Card>

      <div className="tracker-controls">
        {s.status === 'idle' && (
          <button className="big-round start" onClick={() => startTracking(sport)} aria-label="Aufzeichnung starten">
            <IconPlay />
            <span>Start</span>
          </button>
        )}
        {s.status === 'running' && (
          <button className="big-round" onClick={pauseTracking} aria-label="Pausieren">
            <IconPause />
            <span>Pause</span>
          </button>
        )}
        {s.status === 'paused' && (
          <>
            <button className="big-round start" onClick={resumeTracking} aria-label="Weiter">
              <IconPlay />
              <span>Weiter</span>
            </button>
            <button className="big-round stop" onClick={finish} aria-label="Beenden">
              <IconStop />
              <span>Beenden</span>
            </button>
          </>
        )}
      </div>

      {s.status === 'idle' && (
        <Card>
          <label className="check">
            <input type="checkbox" checked={s.autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
            Auto-Pause (hält die Zeit an, wenn du stehst)
          </label>
          <label className="check">
            <input type="checkbox" checked={voice ?? true} onChange={(e) => setKV('trackerVoice', e.target.checked)} />
            Kilometer-Ansage
          </label>
          <p className="tiny muted">
            Der Bildschirm bleibt während der Aufzeichnung an. Sperrst du das Handy oder wechselst die App, kann der Browser das GPS anhalten –
            für lange Einheiten ist die Aufzeichnung mit der Uhr und der Import (Garmin/FIT) am zuverlässigsten.
          </p>
        </Card>
      )}

      {laps.length > 0 && (
        <Card title="Kilometer">
          <table className="data-table">
            <thead>
              <tr>
                <th>km</th>
                <th>Zeit</th>
              </tr>
            </thead>
            <tbody>
              {[...laps].reverse().map((l) => (
                <tr key={l.index}>
                  <td>{l.index}</td>
                  <td>{formatClock(l.durationSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {s.status !== 'idle' && (
        <button className="btn ghost danger" onClick={discard}>
          Aufzeichnung verwerfen
        </button>
      )}

      {finished && (
        <SaveSheet
          state={finished}
          visibility={shareDefault}
          onClose={() => {
            // Zurück zur pausierten Aufzeichnung
            setFinished(null);
          }}
        />
      )}
    </div>
  );
}

function SaveSheet({ state, visibility, onClose }: { state: TrackerState; visibility: 'public' | 'followers' | 'private'; onClose: () => void }) {
  const stats = useMemo(() => trackStats(state.points), [state.points]);
  const start = state.startTime ?? Date.now();
  const initial = {
    sport: state.sport,
    title: activityTitle(state.sport, start),
    date: toISODate(new Date(start)),
    startTime: start,
    durationSec: Math.round(state.movingMs / 1000),
    elapsedSec: Math.round((Date.now() - start) / 1000),
    distanceM: SPORT_DEFS[state.sport].gps ? Math.round(state.distanceM) : undefined,
    elevationGainM: stats.elevationGainM || undefined,
    track: state.points.length > 1 ? state.points : undefined,
    source: 'tracker' as const,
    visibility,
    hideEnds: true,
  };
  return (
    <Sheet title="Aktivität speichern" onClose={onClose}>
      <p className="small text-2">
        {formatClock(initial.durationSec)}
        {initial.distanceM ? ` · ${formatDistance(initial.distanceM)}` : ''}
      </p>
      <ActivityEditor
        initial={initial}
        hasTrack={!!initial.track}
        lockSport
        submitLabel="Speichern"
        onSubmit={async (d) => {
          const id = await saveActivity(d);
          resetTracking();
          toast('Aktivität gespeichert 🎉');
          navigate('aktivitaet', id);
        }}
      />
    </Sheet>
  );
}
