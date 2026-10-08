import { useEffect, useMemo, useState } from 'react';
import { saveActivity, useShareDefault } from '../activities';
import { ActivityEditor } from '../components/ActivityEditor';
import { IconLock, IconPause, IconPlay, IconStop } from '../components/icons';
import { RouteMap } from '../components/RouteMap';
import { InfoBang } from '../components/InfoBang';
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
import { SportIcon } from '../components/SportIcon';

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
  const [pocket, setPocket] = useState(false);
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

  const live = s.status !== 'idle';
  const distValue = s.distanceM >= 1000 ? fmt(s.distanceM / 1000, 2) : fmt(s.distanceM);
  const distUnit = s.distanceM >= 1000 ? 'km' : 'm';
  const statusText = s.status === 'paused' ? 'Pausiert' : s.autoPaused ? 'Auto-Pause' : live ? 'Aufzeichnung läuft' : 'Bereit';

  return (
    <div className={`tracker2 ${def.gps ? 'with-map' : ''}`}>
      {def.gps && (
        <div className="tk-map">
          <RouteMap points={route} live height={live ? '48vh' : '38vh'} />
          <div className="tk-overlay">
            <span className="tk-pill">
              <SportIcon sport={def.key} size={15} /> {def.label}
            </span>
            {gpsLabel && (
              <span className="tk-pill">
                <span className="status-dot" style={{ background: acc != null && acc <= 20 ? 'var(--good)' : acc != null && acc <= 35 ? 'var(--warning)' : 'var(--critical)' }} />
                {gpsLabel}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="tk-panel">
        {!live && (
          <div className="chips tk-sports" role="group" aria-label="Sportart">
            {SPORTS.filter((x) => SPORT_DEFS[x].gps || x === 'schwimmen' || x === 'hyrox').map((x) => (
              <button key={x} className="chip" aria-pressed={x === sport} onClick={() => setSport(x)}>
                <SportIcon sport={x} /> {SPORT_DEFS[x].label}
              </button>
            ))}
          </div>
        )}

        {gpsError && <ErrorBox>{gpsError}</ErrorBox>}

        <div className={`tk-status ${s.status}`}>
          <span className="tk-dot" /> {statusText}
        </div>
        <div className="tk-time tnum" aria-live="off">
          {formatClock(s.movingMs / 1000)}
        </div>
        {def.gps && (
          <div className="tk-stats">
            <div>
              <span className="tk-value tnum">{distValue}</span>
              <span className="tk-label">{distUnit}</span>
            </div>
            <div>
              <span className="tk-value tnum">{paceText(sport, speed)}</span>
              <span className="tk-label">aktuell {paceUnit(sport)}</span>
            </div>
            <div>
              <span className="tk-value tnum">{paceText(sport, avgSpeed)}</span>
              <span className="tk-label">Ø {paceUnit(sport)}</span>
            </div>
          </div>
        )}
        {(s.backgroundMs ?? 0) > 60_000 && (
          <p className="tiny muted tk-note">
            {formatClock((s.backgroundMs ?? 0) / 1000)} im Hintergrund ohne GPS – die Strecke dazwischen ist als Luftlinie ergänzt. Mit dem Taschenmodus läuft GPS durch.
          </p>
        )}

        <div className="tracker-controls">
          {live && (
            <button className="round-sm" onClick={() => setPocket(true)} aria-label="Taschenmodus">
              <IconLock />
            </button>
          )}
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
          {live && <span className="round-sm placeholder" aria-hidden="true" />}
        </div>
      </div>

      <div className="content tk-below">
        {s.status === 'idle' && (
          <Card>
            <label className="check">
              <input type="checkbox" checked={s.autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
              Auto-Pause (hält die Zeit an, wenn du stehst)
            </label>
            <div className="row between">
              <label className="check">
                <input type="checkbox" checked={voice ?? true} onChange={(e) => setKV('trackerVoice', e.target.checked)} />
                Kilometer-Ansage
              </label>
              <InfoBang title="Aufzeichnen, ohne dass GPS abbricht">
                <p>
                  Browser-Apps dürfen GPS nur nutzen, solange sie sichtbar sind. Sperrst du das Handy oder wechselst die App, pausiert das GPS – die Zeit läuft weiter
                  und die Strecke wird beim Zurückkommen als Luftlinie ergänzt.
                </p>
                <p>
                  <strong>Tipp:</strong> Starte nach dem Loslaufen den <strong>Taschenmodus</strong> (Schloss-Symbol). Der Bildschirm wird schwarz, Berührungen sind
                  gesperrt und GPS läuft ohne Lücke weiter. Für sehr lange Einheiten ist die Uhr mit Import (Garmin/FIT) am zuverlässigsten.
                </p>
              </InfoBang>
            </div>
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

        {live && (
          <button className="btn ghost danger" onClick={discard}>
            Aufzeichnung verwerfen
          </button>
        )}
      </div>

      {pocket && live && (
        <PocketMode
          time={formatClock(s.movingMs / 1000)}
          dist={def.gps ? `${distValue} ${distUnit}` : null}
          pace={def.gps ? `${paceText(sport, avgSpeed)} ${paceUnit(sport)}` : null}
          status={statusText}
          onExit={() => setPocket(false)}
        />
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

/**
 * Taschenmodus: schwarzer Bildschirm mit großen Werten, Berührungen gesperrt.
 * Die App bleibt im Vordergrund – so läuft GPS ohne Unterbrechung weiter.
 * Entsperren: Knopf 1 Sekunde gedrückt halten.
 */
function PocketMode({ time, dist, pace, status, onExit }: { time: string; dist: string | null; pace: string | null; status: string; onExit: () => void }) {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (!hold) return;
    const id = setTimeout(onExit, 1000);
    return () => clearTimeout(id);
  }, [hold, onExit]);
  useEffect(() => {
    const el = document.documentElement;
    void el.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  return (
    <div className="pocket" role="dialog" aria-modal="true" aria-label="Taschenmodus" onContextMenu={(e) => e.preventDefault()}>
      <div className="pocket-status">{status}</div>
      <div className="pocket-time tnum">{time}</div>
      {dist && <div className="pocket-value tnum">{dist}</div>}
      {pace && <div className="pocket-sub tnum">Ø {pace}</div>}
      <button
        className={`pocket-unlock ${hold ? 'holding' : ''}`}
        onPointerDown={() => setHold(true)}
        onPointerUp={() => setHold(false)}
        onPointerLeave={() => setHold(false)}
        onPointerCancel={() => setHold(false)}
        aria-label="Zum Entsperren gedrückt halten"
      >
        <IconLock />
        <span>Gedrückt halten</span>
      </button>
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
          toast('Aktivität gespeichert');
          navigate('aktivitaet', id);
        }}
      />
    </Sheet>
  );
}
