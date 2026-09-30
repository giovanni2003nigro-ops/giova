import { useRef, useState } from 'react';
import { findDuplicate, saveActivity, useShareDefault } from '../activities';
import { RouteSvg } from '../components/activity';
import { IconFile, IconUpload } from '../components/icons';
import { Card, ErrorBox, toast } from '../components/ui';
import { navigate } from '../hooks';
import { toISODate } from '../lib/dates';
import { importFile, type ImportedActivity } from '../lib/importers';
import { activityPoints } from '../lib/points';
import { activityTitle, formatClock, formatDistance, formatPace, SPORT_DEFS } from '../lib/sports';
import { fmt } from '../lib/stats';
import type { Sport } from '../types';
import { SPORTS } from '../types';

interface Row extends ImportedActivity {
  file: string;
  duplicate: boolean;
  selected: boolean;
}

/** Import von GPX, TCX und FIT – z. B. aus Garmin Connect, Strava, Polar, Suunto oder Coros. */
export function ImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shareDefault = useShareDefault();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const errs: string[] = [];
    const next: Row[] = [];
    for (const f of Array.from(files)) {
      try {
        for (const a of await importFile(f)) {
          const dup = await findDuplicate(a.startTime);
          next.push({ ...a, file: f.name, duplicate: !!dup, selected: !dup });
        }
      } catch (err) {
        errs.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setRows((r) => [...r, ...next].sort((a, b) => b.startTime - a.startTime));
    setErrors(errs);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const selected = rows.filter((r) => r.selected);

  const save = async () => {
    setBusy(true);
    let last = 0;
    for (const r of selected) {
      last = await saveActivity({
        sport: r.sport,
        title: r.name?.trim() || activityTitle(r.sport, r.startTime),
        date: toISODate(new Date(r.startTime)),
        startTime: r.startTime,
        durationSec: r.durationSec,
        elapsedSec: r.elapsedSec,
        distanceM: r.distanceM,
        elevationGainM: r.elevationGainM,
        avgHr: r.avgHr,
        maxHr: r.maxHr,
        kcal: r.kcal,
        track: r.track.length > 1 ? r.track : undefined,
        source: r.source,
        visibility: shareDefault,
        hideEnds: true,
      });
    }
    setBusy(false);
    toast(`${selected.length} Aktivität${selected.length === 1 ? '' : 'en'} importiert`);
    setRows([]);
    if (selected.length === 1) navigate('aktivitaet', last);
    else navigate('profil');
  };

  return (
    <div className="content">
      <Card title="Von Uhr oder App übernehmen">
        <p className="small text-2">
          Lade Dateien im Format <strong>FIT</strong> (Garmin-Original), <strong>GPX</strong> oder <strong>TCX</strong> hoch – mehrere auf einmal
          sind möglich. Doppelte Aktivitäten werden erkannt.
        </p>
        <button className="btn primary block" onClick={() => inputRef.current?.click()} disabled={busy}>
          <IconUpload /> {busy ? 'Lese Dateien …' : 'Dateien auswählen'}
        </button>
        <input ref={inputRef} type="file" multiple accept=".fit,.gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream" hidden onChange={(e) => onFiles(e.target.files)} />
        {errors.map((e) => (
          <ErrorBox key={e}>{e}</ErrorBox>
        ))}
      </Card>

      {rows.length > 0 && (
        <>
          <div className="section-title">Gefunden ({rows.length})</div>
          {rows.map((r, i) => (
            <Card key={`${r.file}-${r.startTime}`} className="tight">
              <div className="row">
                <input
                  type="checkbox"
                  checked={r.selected}
                  aria-label="Importieren"
                  onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                />
                <div className="grow">
                  <div className="title">{r.name || activityTitle(r.sport, r.startTime)}</div>
                  <div className="tiny muted">
                    <IconFile className="inline-icon" /> {r.file} · {new Date(r.startTime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
                <select
                  className="input"
                  style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
                  value={r.sport}
                  aria-label="Sportart"
                  onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, sport: e.target.value as Sport } : x)))}
                >
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {SPORT_DEFS[s].emoji} {SPORT_DEFS[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tiny text-2 tnum">
                {r.distanceM ? `${formatDistance(r.distanceM)} · ` : ''}
                {formatClock(r.durationSec)}
                {r.distanceM ? ` · ${formatPace(r.sport, r.distanceM, r.durationSec) ?? ''}` : ''}
                {r.elevationGainM ? ` · ${fmt(r.elevationGainM)} Hm` : ''}
                {r.avgHr ? ` · Ø ${r.avgHr} bpm` : ''} · <strong>+{fmt(activityPoints(r))} Punkte</strong>
              </div>
              {r.duplicate && <div className="tiny" style={{ color: 'var(--critical-text)' }}>Ist schon vorhanden – wird standardmäßig übersprungen.</div>}
              {r.track.length > 1 && <RouteSvg route={r.track.map((p) => [p.lat, p.lon])} height={110} />}
            </Card>
          ))}
          <button className="btn primary block" onClick={save} disabled={busy || !selected.length} style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px)' }}>
            {selected.length} importieren
          </button>
        </>
      )}

      <Card title="So bekommst du die Dateien">
        <details className="howto">
          <summary>Garmin</summary>
          <ol className="small text-2">
            <li>
              In <a href="https://connect.garmin.com" target="_blank" rel="noreferrer">Garmin Connect</a> (Browser) die Aktivität öffnen.
            </li>
            <li>Zahnrad-Symbol → „Original exportieren“ (FIT, als ZIP – vorher entpacken) oder „In GPX exportieren“.</li>
            <li>Alternativ die Uhr per USB anschließen: Ordner <code>GARMIN/Activity</code> enthält alle FIT-Dateien.</li>
          </ol>
        </details>
        <details className="howto">
          <summary>Strava</summary>
          <ol className="small text-2">
            <li>Aktivität im Browser öffnen → „…“ → „GPX exportieren“ oder „Original exportieren“.</li>
            <li>Alles auf einmal: Einstellungen → Mein Konto → „Konto herunterladen“ (enthält den Ordner <code>activities</code>).</li>
          </ol>
        </details>
        <details className="howto">
          <summary>Polar, Suunto, Coros, Apple Watch</summary>
          <p className="small text-2">
            Polar Flow, Suunto und Coros bieten im Browser bzw. in der App einen Export als FIT, GPX oder TCX. Für die Apple Watch geht der Export z. B.
            über Apps wie „HealthFit“ oder „RunGap“ als FIT/GPX.
          </p>
        </details>
      </Card>
    </div>
  );
}
