import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { saveActivity, useShareDefault } from '../activities';
import { ActivityCard, fromLocal } from '../components/activity';
import { ActivityEditor, emptyDraft } from '../components/ActivityEditor';
import { IconDumbbell, IconEdit, IconUpload } from '../components/icons';
import { Card, Sheet, toast } from '../components/ui';
import { db } from '../db';
import { navigate } from '../hooks';
import { SPORT_DEFS } from '../lib/sports';
import { useTracker } from '../trackerStore';
import type { Sport } from '../types';
import { SPORTS } from '../types';
import { SportIcon } from '../components/SportIcon';

/** Startpunkt zum Aufzeichnen: Live-Tracker, Krafttraining, Import oder manuell. */
export function RecordView() {
  const tracker = useTracker();
  const [manual, setManual] = useState(false);
  const shareDefault = useShareDefault();
  const recent = useLiveQuery(() => db.activities.orderBy('startTime').reverse().limit(5).toArray(), []) ?? [];
  const gpsSports = SPORTS.filter((s) => SPORT_DEFS[s].gps || s === 'schwimmen' || s === 'hyrox');

  return (
    <div className="content">
      {tracker.status !== 'idle' && (
        <button className="btn primary block" onClick={() => navigate('tracker')}>
          ● Laufende Aufzeichnung öffnen
        </button>
      )}

      <Card title="Live aufzeichnen">
        <p className="small text-2">GPS verfolgt Strecke, Tempo und Zeit – mit Kilometer-Ansage. Bei Schwimmen und Hyrox läuft eine Stoppuhr.</p>
        <div className="sport-grid">
          {gpsSports.map((s: Sport) => (
            <button key={s} className="sport-pick big" onClick={() => navigate('tracker', s)}>
              <SportIcon sport={s} />
              {SPORT_DEFS[s].label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid-2">
        <button className="btn tall" onClick={() => navigate('training')}>
          <IconDumbbell /> Krafttraining
          <span className="tiny muted">Gym & Powerlifting</span>
        </button>
        <button className="btn tall" onClick={() => navigate('import')}>
          <IconUpload /> Importieren
          <span className="tiny muted">Garmin, Strava & Co.</span>
        </button>
      </div>
      <button className="btn block" onClick={() => setManual(true)}>
        <IconEdit /> Aktivität manuell eintragen
      </button>

      {recent.length > 0 && (
        <>
          <div className="section-title">Zuletzt</div>
          {recent.map((a) => (
            <ActivityCard key={a.id} a={fromLocal(a)} />
          ))}
          <a className="btn ghost small" href="#/profil" style={{ alignSelf: 'center' }}>
            Alle Aktivitäten im Profil
          </a>
        </>
      )}

      {manual && (
        <Sheet title="Aktivität eintragen" onClose={() => setManual(false)}>
          <ActivityEditor
            initial={{ ...emptyDraft(), visibility: shareDefault }}
            onSubmit={async (d) => {
              const id = await saveActivity(d);
              setManual(false);
              toast('Aktivität gespeichert');
              navigate('aktivitaet', id);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
