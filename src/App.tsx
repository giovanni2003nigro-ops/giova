import { useEffect, type ComponentType, type SVGProps } from 'react';
import { useMedalWatcher } from './activities';
import { IconBack, IconChat, IconFood, IconGear, IconHome, IconPlus, IconTrophy, IconUser, IconUsers } from './components/icons';
import { Toaster, toast } from './components/ui';
import { navigate, useRoute, type RouteName } from './hooks';
import { formatClock } from './lib/sports';
import { restoreDraft, useTracker } from './trackerStore';
import { AccountView } from './views/Account';
import { ActivityDetailView } from './views/ActivityDetail';
import { AthleteView } from './views/Athlete';
import { CoachView } from './views/Coach';
import { DashboardView } from './views/Dashboard';
import { FeedView } from './views/Feed';
import { GoalsView } from './views/Goals';
import { ImportView } from './views/Import';
import { LeaguesView } from './views/Leagues';
import { MedalsView } from './views/Medals';
import { NutritionView } from './views/Nutrition';
import { PlanView } from './views/Plan';
import { PostView } from './views/Post';
import { ProfileView } from './views/Profile';
import { RecordView } from './views/Record';
import { SettingsView } from './views/Settings';
import { SleepView } from './views/Sleep';
import { TrackerView } from './views/Tracker';
import { TrainingView } from './views/Training';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: { name: RouteName; label: string; Icon: Icon; primary?: boolean }[] = [
  { name: 'heute', label: 'Heute', Icon: IconHome },
  { name: 'feed', label: 'Feed', Icon: IconUsers },
  { name: 'aufzeichnen', label: 'Aufzeichnen', Icon: IconPlus, primary: true },
  { name: 'ligen', label: 'Ligen', Icon: IconTrophy },
  { name: 'essen', label: 'Essen', Icon: IconFood },
  { name: 'profil', label: 'Profil', Icon: IconUser },
];

const TITLES: Record<RouteName, string> = {
  heute: 'Übersicht',
  feed: 'Feed',
  aufzeichnen: 'Aufzeichnen',
  ligen: 'Ligen',
  essen: 'Ernährung',
  profil: 'Profil',
  training: 'Krafttraining',
  tracker: 'Live',
  import: 'Import',
  schlaf: 'Schlaf',
  ziele: 'Ziele & Körper',
  coach: 'KI-Coach',
  einstellungen: 'Einstellungen',
  medaillen: 'Medaillen',
  plan: 'Plan & Alltag',
  konto: 'Konto',
  aktivitaet: 'Aktivität',
  post: 'Aktivität',
  athlet: 'Profil',
};

/** Unterseiten gehören zu einem Tab der Navigation. */
const PARENT: Partial<Record<RouteName, RouteName>> = {
  training: 'aufzeichnen',
  tracker: 'aufzeichnen',
  import: 'aufzeichnen',
  schlaf: 'profil',
  ziele: 'profil',
  medaillen: 'ligen',
  plan: 'profil',
  konto: 'profil',
  einstellungen: 'profil',
  coach: 'heute',
  aktivitaet: 'profil',
  post: 'feed',
  athlet: 'feed',
};

export function App() {
  const route = useRoute();
  const tracker = useTracker();
  const active = PARENT[route.name] ?? route.name;
  const isSub = !!PARENT[route.name];
  useMedalWatcher();

  useEffect(() => {
    void restoreDraft().then((restored) => {
      if (restored) {
        toast('Unterbrochene Aufzeichnung wiederhergestellt (pausiert)');
        navigate('tracker');
      }
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="row" style={{ minWidth: 0 }}>
          {isSub && (
            <button className="icon-btn" onClick={() => (history.length > 1 ? history.back() : navigate(active))} aria-label="Zurück">
              <IconBack />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <span className="wordmark">Giova</span>
            <h1>{TITLES[route.name]}</h1>
          </div>
        </div>
        <div className="row" style={{ gap: 0 }}>
          <button className="icon-btn" onClick={() => navigate('coach')} aria-label="KI-Coach">
            <IconChat />
          </button>
          <button className="icon-btn" onClick={() => navigate('einstellungen')} aria-label="Einstellungen">
            <IconGear />
          </button>
        </div>
      </header>
      {tracker.status !== 'idle' && route.name !== 'tracker' && (
        <button className="tracker-banner" onClick={() => navigate('tracker')}>
          <span className="rec-dot" /> {tracker.status === 'paused' ? 'Aufzeichnung pausiert' : 'Aufzeichnung läuft'} · {formatClock(tracker.movingMs / 1000)}
          {tracker.distanceM > 0 && ` · ${(tracker.distanceM / 1000).toFixed(2).replace('.', ',')} km`}
        </button>
      )}
      <main>
        {route.name === 'heute' && <DashboardView />}
        {route.name === 'feed' && <FeedView />}
        {route.name === 'aufzeichnen' && <RecordView />}
        {route.name === 'ligen' && <LeaguesView />}
        {route.name === 'essen' && <NutritionView />}
        {route.name === 'profil' && <ProfileView />}
        {route.name === 'training' && <TrainingView />}
        {route.name === 'tracker' && <TrackerView sportParam={route.id} />}
        {route.name === 'import' && <ImportView />}
        {route.name === 'schlaf' && <SleepView />}
        {route.name === 'ziele' && <GoalsView />}
        {route.name === 'coach' && <CoachView />}
        {route.name === 'einstellungen' && <SettingsView />}
        {route.name === 'medaillen' && <MedalsView />}
        {route.name === 'plan' && <PlanView />}
        {route.name === 'konto' && <AccountView />}
        {route.name === 'aktivitaet' && <ActivityDetailView key={route.id} id={route.id} />}
        {route.name === 'post' && <PostView key={route.id} id={route.id} />}
        {route.name === 'athlet' && <AthleteView key={route.id} id={route.id} />}
      </main>
      <nav className="nav" aria-label="Hauptnavigation">
        <div className="nav-inner">
          {NAV.map(({ name, label, Icon, primary }) => (
            <button key={name} className={primary ? 'primary' : ''} aria-current={active === name ? 'page' : undefined} onClick={() => navigate(name)}>
              <span className="nav-icon">
                <Icon />
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
      <Toaster />
    </div>
  );
}
