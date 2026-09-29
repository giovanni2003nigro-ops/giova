import type { ISODate, SleepEntry } from '../types';
import { minutesToTime, timeToMinutes } from './dates';
import { mean, stdDev } from './stats';

/** Schlafdauer in Minuten, auch über Mitternacht hinweg. */
export function sleepDurationMin(bedtime: string, wakeTime: string): number {
  const bed = timeToMinutes(bedtime);
  let wake = timeToMinutes(wakeTime);
  if (wake <= bed) wake += 1440;
  return wake - bed;
}

/** Zubettgehzeit relativ zu 12:00 Uhr, damit 23:30 und 00:30 nah beieinander liegen. */
function bedtimeFromNoon(bedtime: string): number {
  return (timeToMinutes(bedtime) - 720 + 1440) % 1440;
}

export interface SleepSummary {
  nights: number;
  avgMin: number;
  avgQuality: number;
  /** Standardabweichung der Zubettgehzeit in Minuten (Regelmäßigkeit) */
  bedtimeSdMin: number;
  avgBedtime: string | null;
  /** Summe der fehlenden Stunden ggü. dem Ziel */
  debtHours: number;
  nightsBelowTarget: number;
}

export function summarizeSleep(
  entries: SleepEntry[],
  from: ISODate,
  to: ISODate,
  targetHours: number,
): SleepSummary {
  const list = entries.filter((e) => e.date >= from && e.date <= to);
  const bedtimes = list.map((e) => bedtimeFromNoon(e.bedtime));
  const targetMin = targetHours * 60;
  return {
    nights: list.length,
    avgMin: mean(list.map((e) => e.durationMin)),
    avgQuality: mean(list.map((e) => e.quality)),
    bedtimeSdMin: stdDev(bedtimes),
    avgBedtime: list.length ? minutesToTime(mean(bedtimes) + 720) : null,
    debtHours: list.reduce((acc, e) => acc + Math.max(0, targetMin - e.durationMin), 0) / 60,
    nightsBelowTarget: list.filter((e) => e.durationMin < targetMin - 30).length,
  };
}
