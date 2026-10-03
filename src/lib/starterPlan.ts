import type { Intensity, PlannedSession, Sport, TrainingPlan, Weekday } from '../types';
import { newUid } from './sports';

/**
 * Startplan aus der Einrichtung: verteilt die gewählten Sportarten auf die Trainingstage,
 * wechselt locker/mittel/hart ab und hält die Rahmenbedingungen ein
 * (mind. 1 Ruhetag, höchstens 3 harte Einheiten pro Woche).
 */

export type TimeOfDay = 'morgens' | 'mittags' | 'abends';

/** Gut verteilte Trainingstage (0 = Montag); Sonntag bleibt möglichst frei. */
const DAY_PATTERNS: Record<number, Weekday[]> = {
  1: [2],
  2: [1, 4],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 3, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

const TEMPLATES: Record<Sport, Record<Intensity, { title: string; min: number; km?: number }>> = {
  laufen: { locker: { title: 'Lockerer Dauerlauf', min: 45, km: 7 }, mittel: { title: 'Tempodauerlauf', min: 50, km: 9 }, hart: { title: 'Intervalle', min: 55, km: 9 } },
  radfahren: { locker: { title: 'Grundlagenfahrt', min: 75, km: 30 }, mittel: { title: 'Tempofahrt', min: 60, km: 27 }, hart: { title: 'Intervalle auf dem Rad', min: 60, km: 25 } },
  schwimmen: { locker: { title: 'Lockeres Schwimmen', min: 40, km: 1.5 }, mittel: { title: 'Technik & Ausdauer', min: 45, km: 2 }, hart: { title: 'Intervalle im Becken', min: 45, km: 2 } },
  wandern: { locker: { title: 'Wanderung', min: 120, km: 10 }, mittel: { title: 'Bergwanderung', min: 150, km: 12 }, hart: { title: 'Schnelle Bergwanderung', min: 150, km: 14 } },
  rudern: { locker: { title: 'Grundlage Rudern', min: 45, km: 8 }, mittel: { title: 'Tempo Rudern', min: 40, km: 8 }, hart: { title: 'Intervalle Rudern', min: 40, km: 7 } },
  hyrox: { locker: { title: 'Hyrox-Technik', min: 45 }, mittel: { title: 'Kraftausdauer & Stationen', min: 60 }, hart: { title: 'Hyrox-Simulation', min: 70 } },
  gym: { locker: { title: 'Mobility & Rumpf', min: 40 }, mittel: { title: 'Ganzkörper', min: 60 }, hart: { title: 'Schwere Grundübungen', min: 70 } },
  powerlifting: { locker: { title: 'Technik & Assistenz', min: 60 }, mittel: { title: 'Kreuzheben & Assistenz', min: 75 }, hart: { title: 'Kniebeuge & Bankdrücken schwer', min: 80 } },
};

const TIMES: Record<TimeOfDay, string> = { morgens: '07:00', mittags: '12:30', abends: '18:00' };

export function starterPlan(sports: Sport[], days: number, time: TimeOfDay = 'abends'): TrainingPlan | null {
  if (!sports.length || days < 1) return null;
  const n = Math.min(6, Math.max(1, Math.round(days)));
  const weekdays = DAY_PATTERNS[n];
  const maxHard = Math.min(3, Math.floor(n / 2));
  // Pro Sportart wechseln die Intensitäten: mittel → hart → locker → …
  const cycle: Intensity[] = ['mittel', 'hart', 'locker'];
  const used = new Map<Sport, number>();
  let hard = 0;
  const sessions: PlannedSession[] = weekdays.map((wd, i) => {
    const sport = sports[i % sports.length];
    const k = used.get(sport) ?? 0;
    used.set(sport, k + 1);
    let intensity = cycle[k % cycle.length];
    if (intensity === 'hart' && hard >= maxHard) intensity = 'locker';
    if (intensity === 'hart') hard++;
    // Wochenende: lange, lockere Ausdauereinheit
    const weekend = wd >= 5;
    const endurance = TEMPLATES[sport].locker.km != null;
    if (weekend && endurance && intensity !== 'hart') intensity = 'locker';
    const tpl = TEMPLATES[sport][intensity];
    const long = weekend && endurance && intensity === 'locker';
    return {
      id: newUid(),
      weekday: wd,
      sport,
      title: long && (sport === 'laufen' || sport === 'radfahren') ? (sport === 'laufen' ? 'Langer Lauf' : 'Lange Ausfahrt') : tpl.title,
      time: weekend ? '09:30' : TIMES[time],
      durationMin: long ? Math.round(tpl.min * 1.6) : tpl.min,
      intensity,
      ...(tpl.km ? { distanceKm: long ? Math.round(tpl.km * 1.6) : tpl.km } : {}),
    };
  });
  return { name: 'Startplan', sessions, updatedAt: Date.now(), source: 'manuell' };
}

/** Pauschaler Aktivitätsfaktor aus der Zahl der Trainingstage (nur ohne Alltag/Plan relevant). */
export function activityFactor(days: number): number {
  return days <= 1 ? 1.3 : days <= 2 ? 1.45 : days <= 4 ? 1.6 : 1.75;
}
