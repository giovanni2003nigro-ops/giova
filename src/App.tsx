import { useEffect, useState, type ComponentType, type CSSProperties, type SVGProps } from 'react';
import { setCommunityEnabled } from './lib/features';
import { useMedalWatcher } from './activities';
import { openCoach } from './coachBus';
import { IconBack, IconGear, IconGrid, IconPlus, IconSparkle, IconTrophy, IconUser, IconUsers } from './components/icons';
import { NoticesButton } from './components/Notices';
import { db, getKV } from './db';
import { Toaster, toast } from './components/ui';
import { navigate, useRoute, type RouteName } from './hooks';
import { useCommunity } from './lib/features';
import { formatClock } from './lib/sports';
import { restoreDraft, useTracker } from './trackerStore';
import { AccountView } from './views/Account';
import { ActivityDetailView } from './views/ActivityDetail';
import { AnalysisView } from './views/Analysis';
import { AthleteView } from './views/Athlete';
import { COACH_PAGES, CoachSheet, CoachView } from './views/Coach';
import { DashboardView } from './views/Dashboard';
import { FeedView } from './views/Feed';
import { GoalsView } from './views/Goals';
import { ImportView } from './views/Import';
import { LeaguesView } from './views/Leagues';
import { MeView } from './views/Me';
import { OnboardingView } from './views/Onboarding';
import { MedalsView } from './views/Medals';
import { NutrientsView } from './views/Nutrients';
import { NutritionView } from './views/Nutrition';
import { PlanView } from './views/Plan';
import { PostView } from './views/Post';
import { ProgressView } from './views/Progress';
import { ProfileView } from './views/Profile';
import { RecordView } from './views/Record';
import { SettingsView } from './views/Settings';
import { SleepView } from './views/Sleep';
import { TrackerView } from './views/Tracker';
import { TrainingView } from './views/Training';
import { TrainingHubView } from './views/TrainingHub';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

// „Ich“ bündelt Heute, Essen, Training, Entwicklung, Analyse und Coach in Kacheln
const NAV: { name: RouteName; label: string; Icon: Icon; primary?: boolean }[] = [
  { name: 'ich', label: 'Ich', Icon: IconGrid },
  { name: 'feed', label: 'Feed', Icon: IconUsers },
  { name: 'aufzeichnen', label: 'Aufzeichnen', Icon: IconPlus, primary: true },
  { name: 'ligen', label: 'Liga', Icon: IconTrophy },
  { name: 'profil', label: 'Profil', Icon: IconUser },
];

const TITLES: Record<RouteName, string> = {
  ich: 'Ich',
  heute: 'Heute',
  einheiten: 'Training',
  entwicklung: 'Entwicklung',
  analyse: 'Analyse',
  start: 'Einrichtung',
  naehrstoffe: 'Nährstoffe',
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
  coach: 'Coach',
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
  heute: 'ich',
  essen: 'ich',
  einheiten: 'ich',
  entwicklung: 'ich',
  analyse: 'ich',
  start: 'ich',
  naehrstoffe: 'ich',
  training: 'ich',
  tracker: 'aufzeichnen',
  import: 'aufzeichnen',
  schlaf: 'ich',
  ziele: 'ich',
  medaillen: 'ligen',
  plan: 'ich',
  konto: 'profil',
  einstellungen: 'profil',
  coach: 'ich',
  aktivitaet: 'profil',
  post: 'feed',
  athlet: 'feed',
};

export function App() {
  const route = useRoute();
  const tracker = useTracker();
  const community = useCommunity();
  const nav = NAV.filter((n) => community || (n.name !== 'feed' && n.name !== 'ligen'));
  const social = route.name === 'feed' || route.name === 'ligen' || route.name === 'post' || route.name === 'athlet';
  const active = !community && route.name === 'medaillen' ? 'profil' : (PARENT[route.name] ?? route.name);
  const isSub = !!PARENT[route.name];
  // Coach überall – außer Social Media (Feed, Beiträge, Profile) und Ranglisten
  const coachHere = route.name !== 'coach' && !!COACH_PAGES[route.name];
  const [coachOpen, setCoachOpen] = useState<{ question?: string } | null>(null);
  useMedalWatcher();
  useEffect(() => {
    if (!coachHere) setCoachOpen(null);
  }, [coachHere]);
  // Kacheln und andere Stellen öffnen den Coach über ein Ereignis
  useEffect(() => {
    const on = (e: Event) => setCoachOpen({ question: (e as CustomEvent<string | undefined>).detail });
    window.addEventListener('open-coach', on);
    return () => window.removeEventListener('open-coach', on);
  }, []);
  const focus = route.name === 'start';

  // Ganz neu in der App? Dann zuerst die geführte Einrichtung
  useEffect(() => {
    void (async () => {
      const [onboarded, profile, meals, acts] = await Promise.all([getKV<boolean>('onboarded', false), getKV('profile', null), db.meals.count(), db.activities.count()]);
      if (!onboarded && !profile && !meals && !acts && !window.location.hash.replace(/^#\/?/, '')) navigate('start');
    })();
  }, []);

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
          <NoticesButton page={route.name} />
          {coachHere && (
            <button className="icon-btn coach-btn" onClick={() => openCoach()} aria-label="Coach öffnen">
              <IconSparkle />
            </button>
          )}
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
      {coachOpen && coachHere && <CoachSheet route={route} question={coachOpen.question} onClose={() => setCoachOpen(null)} />}
      <main>
        {route.name === 'ich' && <MeView />}
        {route.name === 'heute' && <DashboardView />}
        {route.name === 'einheiten' && <TrainingHubView />}
        {route.name === 'entwicklung' && <ProgressView />}
        {route.name === 'analyse' && <AnalysisView />}
        {route.name === 'start' && <OnboardingView />}
        {route.name === 'naehrstoffe' && <NutrientsView />}
        {social && !community && <CommunityOff />}
        {route.name === 'feed' && community && <FeedView />}
        {route.name === 'aufzeichnen' && <RecordView />}
        {route.name === 'ligen' && community && <LeaguesView />}
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
        {route.name === 'post' && community && <PostView key={route.id} id={route.id} />}
        {route.name === 'athlet' && community && <AthleteView key={route.id} id={route.id} />}
      </main>
      <nav className="nav" aria-label="Hauptnavigation" hidden={focus} style={{ '--nav-cols': nav.length } as CSSProperties}>
        <div className="nav-inner">
          {nav.map(({ name, label, Icon, primary }) => (
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

/** Feed & Liga sind ausgeschaltet – kurzer Hinweis statt leerer Seite. */
function CommunityOff() {
  return (
    <div className="content">
      <div className="card">
        <h2>Feed & Liga sind ausgeschaltet</h2>
        <p className="small text-2">
          Community, Ranglisten und Ligen sind gerade deaktiviert. Deine Aktivitäten, Punkte und Medaillen bleiben auf deinem Gerät. Einschalten kannst du sie jederzeit in den
          Einstellungen.
        </p>
        <button
          className="btn primary"
          onClick={() => {
            setCommunityEnabled(true);
            toast('Feed & Liga eingeschaltet');
          }}
        >
          Jetzt einschalten
        </button>
        <button className="btn" onClick={() => navigate('ich')}>
          Zurück zu „Ich“
        </button>
      </div>
    </div>
  );
}
