import type { ComponentType, SVGProps } from 'react';
import { IconChat, IconDumbbell, IconFood, IconGear, IconHome, IconMoon, IconTarget } from './components/icons';
import { Toaster } from './components/ui';
import { navigate, useRoute, type Tab } from './hooks';
import { CoachView } from './views/Coach';
import { DashboardView } from './views/Dashboard';
import { GoalsView } from './views/Goals';
import { NutritionView } from './views/Nutrition';
import { SettingsView } from './views/Settings';
import { SleepView } from './views/Sleep';
import { TrainingView } from './views/Training';

const NAV: { tab: Tab; label: string; title: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { tab: 'heute', label: 'Heute', title: 'Übersicht', Icon: IconHome },
  { tab: 'training', label: 'Training', title: 'Training', Icon: IconDumbbell },
  { tab: 'essen', label: 'Essen', title: 'Ernährung', Icon: IconFood },
  { tab: 'schlaf', label: 'Schlaf', title: 'Schlaf', Icon: IconMoon },
  { tab: 'ziele', label: 'Ziele', title: 'Ziele & Körper', Icon: IconTarget },
  { tab: 'coach', label: 'Coach', title: 'KI-Coach', Icon: IconChat },
];

export function App() {
  const tab = useRoute();
  const current = NAV.find((n) => n.tab === tab);
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{current?.title ?? 'Einstellungen'}</h1>
          <div className="sub">Giova Fit</div>
        </div>
        <button className="icon-btn" onClick={() => navigate('einstellungen')} aria-label="Einstellungen">
          <IconGear />
        </button>
      </header>
      <main>
        {tab === 'heute' && <DashboardView />}
        {tab === 'training' && <TrainingView />}
        {tab === 'essen' && <NutritionView />}
        {tab === 'schlaf' && <SleepView />}
        {tab === 'ziele' && <GoalsView />}
        {tab === 'coach' && <CoachView />}
        {tab === 'einstellungen' && <SettingsView />}
      </main>
      <nav className="nav" aria-label="Hauptnavigation">
        <div className="nav-inner">
          {NAV.map(({ tab: t, label, Icon }) => (
            <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(t)}>
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <Toaster />
    </div>
  );
}
