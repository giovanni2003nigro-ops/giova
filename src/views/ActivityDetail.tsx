import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { deleteActivity, updateActivity } from '../activities';
import { publishActivity, unpublishActivity, useMyProfile } from '../cloud/api';
import { cloudEnabled, cloudError } from '../cloud/client';
import { activityStats, fromLocal, whenLabel } from '../components/activity';
import { ActivityEditor } from '../components/ActivityEditor';
import { IconEdit, IconShare, IconTrash, IconMedal } from '../components/icons';
import { RouteMap } from '../components/RouteMap';
import { StorySheet } from '../components/StorySheet';
import { InfoBang } from '../components/InfoBang';
import { Card, Seg, Sheet, Stat, toast } from '../components/ui';
import { db } from '../db';
import { navigate, useObjectUrl } from '../hooks';
import { splits, type Split } from '../lib/geo';
import { MEDAL_BY_KEY } from '../lib/medals';
import { POINTS_RULES } from '../lib/points';
import { formatClock, formatDistance, formatDurationSec, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Activity, Sport, Visibility } from '../types';
import { VISIBILITY_LABELS } from '../types';
import { SportIcon } from '../components/SportIcon';
import { useCommunity } from '../lib/features';

export function ActivityDetailView({ id }: { id?: string }) {
  const activity = useLiveQuery(() => (id ? db.activities.get(Number(id)) : undefined), [id]);
  const medals = useLiveQuery(async () => (activity ? db.medals.filter((m) => m.date === activity.date).toArray() : []), [activity?.date]);
  const [editing, setEditing] = useState(false);
  const [story, setStory] = useState(false);
  const photo = useObjectUrl(activity?.photo);
  const route = useMemo(() => activity?.track?.map((p) => [p.lat, p.lon] as [number, number]) ?? [], [activity?.track]);
  const splitRows = useMemo(() => (activity?.track && SPORT_DEFS[activity.sport].distance ? splits(activity.track, activity.sport === 'schwimmen' ? 100 : 1000) : []), [activity]);
  const [hover, setHover] = useState<number | null>(null);
  const community = useCommunity();

  if (activity === undefined && id) return null;
  if (!activity) return <div className="content empty">Aktivität nicht gefunden.</div>;
  const def = SPORT_DEFS[activity.sport];
  const stats = activityStats(activity);
  const extra: { label: string; value: string }[] = [];
  if (activity.elapsedSec && activity.elapsedSec - activity.durationSec > 60) extra.push({ label: 'Gesamtzeit', value: formatClock(activity.elapsedSec) });
  if (activity.kcal) extra.push({ label: 'Kalorien', value: `${fmt(activity.kcal)} kcal` });
  if (activity.avgHr && !stats.some((s) => s.label === 'Ø Puls')) extra.push({ label: 'Ø Puls', value: `${activity.avgHr} bpm` });
  if (activity.maxHr) extra.push({ label: 'Max. Puls', value: `${activity.maxHr} bpm` });
  if (activity.rpe) extra.push({ label: 'Anstrengung', value: `${activity.rpe}/10` });
  const related = (medals ?? []).filter((m) => MEDAL_BY_KEY.get(m.key)?.sport === activity.sport);

  const highlight = hover != null && activity.track ? pointAtSplit(activity.track, splitRows, hover) : null;

  return (
    <div className="content">
      <div>
        <div className="small muted">
          <SportIcon sport={def.key} /> {def.label} · {whenLabel(activity.startTime)}
          {community && ` · ${VISIBILITY_LABELS[activity.visibility]}`}
        </div>
        <h1>{activity.title}</h1>
        {activity.note && <p className="text-2" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{activity.note}</p>}
      </div>

      {route.length > 1 && <RouteMap points={route} highlight={highlight} />}

      <Card>
        <div className="grid-3">
          {[...stats, ...extra].map((s) => (
            <Stat key={s.label} tile label={s.label} value={s.value} />
          ))}
        </div>
        <div className="hint-box row between">
          <span>
            <strong>+{fmt(activity.points)} Punkte</strong>
            {community ? ' für Rangliste & Liga' : ''} · {POINTS_RULES[activity.sport]}
          </span>
          {activity.points === 0 && (
            <InfoBang title="Keine Punkte" tone="warn">
              <p>Die Werte wirken unrealistisch (z. B. zu schnell für die Sportart) – dafür gibt es keine Punkte. Prüfe Distanz und Dauer.</p>
            </InfoBang>
          )}
        </div>
        {related.length > 0 && (
          <div className="chips">
            {related.map((m) => (
              <span key={m.id} className="badge">
                <IconMedal className="inline-icon" /> {MEDAL_BY_KEY.get(m.key)?.label} +{m.points}
              </span>
            ))}
          </div>
        )}
      </Card>

      <button className="btn primary block" onClick={() => setStory(true)}>
        <IconShare /> Als Story teilen
      </button>

      {splitRows.length > 1 && <SplitsCard sport={activity.sport} rows={splitRows} onHover={setHover} />}

      {activity.strength && activity.strength.length > 0 && (
        <Card title="Übungen">
          <table className="data-table">
            <thead>
              <tr>
                <th>Übung</th>
                <th>Sätze</th>
                <th>Bester Satz</th>
                <th>e1RM</th>
              </tr>
            </thead>
            <tbody>
              {activity.strength.map((s) => (
                <tr key={s.exercise}>
                  <td>{s.exercise}</td>
                  <td>{s.sets}</td>
                  <td>{s.topWeight > 0 ? `${fmt(s.topWeight, 1)} × ${s.topReps}` : `${s.reps} Wdh.`}</td>
                  <td>{s.bestE1RM > 0 ? `${fmt(s.bestE1RM, 1)} kg` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {photo && <img src={photo} alt="Foto zur Aktivität" className="photo-full" />}

      <ShareCard activity={activity} />

      <div className="grid-2">
        <button className="btn" onClick={() => setEditing(true)}>
          <IconEdit /> Bearbeiten
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm('Aktivität löschen? Das kann nicht rückgängig gemacht werden.')) return;
            await deleteActivity(activity);
            toast('Aktivität gelöscht');
            navigate('profil');
          }}
        >
          <IconTrash /> Löschen
        </button>
      </div>

      {story && <StorySheet activity={fromLocal(activity)} photo={activity.photo} onClose={() => setStory(false)} />}

      {editing && (
        <Sheet title="Aktivität bearbeiten" onClose={() => setEditing(false)}>
          <ActivityEditor
            initial={activity}
            hasTrack={!!activity.track}
            onSubmit={async (d) => {
              await updateActivity(activity.id!, d);
              setEditing(false);
              toast('Gespeichert');
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function pointAtSplit(track: NonNullable<Activity['track']>, rows: Split[], i: number): [number, number] | null {
  // Ende des Splits i ≈ Punkt, an dem die kumulierte Zeit erreicht ist
  const t = track[0].t + rows.slice(0, i + 1).reduce((s, r) => s + r.durationSec, 0) * 1000;
  const p = track.find((x) => x.t >= t) ?? track[track.length - 1];
  return [p.lat, p.lon];
}

function SplitsCard({ sport, rows, onHover }: { sport: Sport; rows: Split[]; onHover: (i: number | null) => void }) {
  const unit = sport === 'schwimmen' ? 100 : 1000;
  const paces = rows.map((r) => (r.durationSec / r.distanceM) * unit);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  return (
    <Card title={sport === 'schwimmen' ? 'Zwischenzeiten je 100 m' : 'Splits je Kilometer'}>
      <div className="splits" onPointerLeave={() => onHover(null)}>
        <div className="split head tiny muted">
          <span>{sport === 'schwimmen' ? '100 m' : 'km'}</span>
          <span>Pace</span>
          <span />
          <span>Hm</span>
          <span>Puls</span>
        </div>
        {rows.map((r, i) => {
          const pace = paces[i];
          const w = slowest > fastest ? 35 + 65 * ((slowest - pace) / (slowest - fastest)) : 100;
          return (
            <div key={r.index} className="split tnum" onPointerEnter={() => onHover(i)} onFocus={() => onHover(i)} tabIndex={0}>
              <span>{r.distanceM < unit ? fmt((r.index - 1) + r.distanceM / unit, 1) : r.index}</span>
              <span>{formatClock(pace)}</span>
              <span className="split-bar">
                <span style={{ width: `${w}%` }} className={pace === fastest ? 'best' : ''} />
              </span>
              <span>{r.elevationDelta > 0 ? `+${r.elevationDelta}` : r.elevationDelta}</span>
              <span>{r.avgHr ?? '–'}</span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted">
        Schnellster Abschnitt: {formatClock(fastest)} · Gesamt {formatDistance(rows.reduce((s, r) => s + r.distanceM, 0))} in{' '}
        {formatDurationSec(rows.reduce((s, r) => s + r.durationSec, 0))}
      </p>
    </Card>
  );
}

function ShareCard({ activity }: { activity: Activity }) {
  const { profile } = useMyProfile();
  const community = useCommunity();
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(activity.visibility === 'private' ? 'public' : activity.visibility);
  if (!cloudEnabled || !community) return null;
  if (!profile)
    return (
      <Card>
        <p className="small text-2">Teile deine Aktivitäten mit Freunden, sammle Kudos und kämpfe in deiner Liga um den Aufstieg.</p>
        <a className="btn" href="#/konto">
          Konto erstellen / anmelden
        </a>
      </Card>
    );
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
    } catch (err) {
      toast(cloudError(err));
    } finally {
      setBusy(false);
    }
  };
  if (activity.remoteId)
    return (
      <Card title="In der Community">
        <p className="small text-2">
          Geteilt als <strong>{VISIBILITY_LABELS[activity.visibility]}</strong>. Punkte zählen in deiner Liga.
        </p>
        <div className="grid-2">
          <a className="btn" href={`#/post/${activity.remoteId}`}>
            Ansehen
          </a>
          <button className="btn" disabled={busy} onClick={() => run(() => unpublishActivity(activity), 'Nicht mehr geteilt')}>
            Nicht mehr teilen
          </button>
        </div>
      </Card>
    );
  return (
    <Card title="Teilen">
      <p className="small text-2">Noch nicht in der Community. Die Punkte zählen erst für deine Liga, wenn die Aktivität hochgeladen ist.</p>
      <Seg
        label="Sichtbarkeit"
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: 'public', label: VISIBILITY_LABELS.public },
          { value: 'followers', label: VISIBILITY_LABELS.followers },
          { value: 'private', label: 'Nur Liga' },
        ]}
      />
      <button className="btn primary" disabled={busy} onClick={() => run(() => publishActivity(activity, visibility), 'Geteilt')}>
        <IconShare /> {visibility === 'private' ? 'Nur für die Liga hochladen' : 'Teilen'}
      </button>
    </Card>
  );
}
