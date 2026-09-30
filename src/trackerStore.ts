import { useSyncExternalStore } from 'react';
import { getKV, setKV } from './db';
import { formatClock, SPORT_DEFS } from './lib/sports';
import { initialTracker, liveLaps, trackerReducer, type TrackerAction, type TrackerState } from './lib/tracker';
import type { Sport } from './types';

/**
 * Live-Aufzeichnung als globaler Zustand: läuft weiter, auch wenn man in der App
 * die Seite wechselt. Der Zwischenstand wird regelmäßig gespeichert, damit ein
 * Neuladen oder Absturz die Aufzeichnung nicht verliert.
 */

let state: TrackerState = initialTracker('laufen');
let gpsError = '';
let watchId: number | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let wakeLock: WakeLockSentinel | null = null;
let lastSaved = 0;
let announcedLaps = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function dispatch(a: TrackerAction) {
  state = trackerReducer(state, a);
  emit();
}

export function useTracker(): TrackerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function useGpsError(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => gpsError,
  );
}

export const trackerActive = () => state.status !== 'idle';

function startGps() {
  if (watchId != null || !SPORT_DEFS[state.sport].gps) return;
  if (!('geolocation' in navigator)) {
    gpsError = 'Dein Browser unterstützt kein GPS.';
    emit();
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (gpsError) gpsError = '';
      dispatch({
        type: 'fix',
        fix: { lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp || Date.now(), accuracy: pos.coords.accuracy, ele: pos.coords.altitude },
      });
    },
    (err) => {
      gpsError =
        err.code === err.PERMISSION_DENIED
          ? 'Kein Zugriff auf den Standort. Bitte in den Browser-Einstellungen erlauben.'
          : err.code === err.TIMEOUT
            ? 'Suche GPS-Signal … (unter freiem Himmel geht es schneller)'
            : 'GPS-Signal nicht verfügbar.';
      emit();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
  );
}

function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

async function lockScreen() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  // Wake Lock geht beim Wechsel in den Hintergrund verloren → neu anfordern
  if (document.visibilityState === 'visible' && state.status !== 'idle') void lockScreen();
});

async function voice(): Promise<boolean> {
  return getKV<boolean>('trackerVoice', true);
}

function announce() {
  const laps = liveLaps(state);
  if (laps.length <= announcedLaps) return;
  announcedLaps = laps.length;
  const lap = laps[laps.length - 1];
  void voice().then((on) => {
    if (!on || !('speechSynthesis' in window)) return;
    const [m, s] = formatClock(lap.durationSec).split(':');
    const u = new SpeechSynthesisUtterance(`Kilometer ${lap.index}. ${Number(m)} Minuten ${Number(s)}.`);
    u.lang = 'de-DE';
    speechSynthesis.speak(u);
  });
}

function startTicking() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    dispatch({ type: 'tick', now: Date.now() });
    announce();
    if (Date.now() - lastSaved > 10_000) {
      lastSaved = Date.now();
      void setKV('trackerDraft', state);
    }
  }, 1000);
}

function stopTicking() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

/** GPS schon vor dem Start einschalten, damit das Signal bereit ist. */
export function warmUp(sport: Sport) {
  if (state.status === 'idle') dispatch({ type: 'sport', sport });
  if (SPORT_DEFS[sport].gps) startGps();
  else if (state.status === 'idle') stopGps();
}

export function coolDown() {
  if (state.status === 'idle') stopGps();
}

export function startTracking(sport: Sport) {
  dispatch({ type: 'sport', sport });
  dispatch({ type: 'start', now: Date.now() });
  announcedLaps = 0;
  startGps();
  startTicking();
  void lockScreen();
}

export function pauseTracking() {
  dispatch({ type: 'pause', now: Date.now() });
  void setKV('trackerDraft', state);
}

export function resumeTracking() {
  dispatch({ type: 'resume', now: Date.now() });
  startGps();
  startTicking();
  void lockScreen();
}

export function setAutoPause(enabled: boolean) {
  dispatch({ type: 'autoPause', enabled });
}

/** Beendet die Aufzeichnung und liefert den Endstand. */
export function finishTracking(): TrackerState {
  if (state.status === 'running') dispatch({ type: 'pause', now: Date.now() });
  const final = state;
  stopTicking();
  stopGps();
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  return final;
}

export function resetTracking() {
  dispatch({ type: 'reset' });
  void setKV('trackerDraft', null);
}

/** Nach einem Neuladen: unterbrochene Aufzeichnung wiederherstellen (pausiert). */
export async function restoreDraft(): Promise<boolean> {
  if (state.status !== 'idle') return false;
  const draft = await getKV<TrackerState | null>('trackerDraft', null);
  if (!draft || draft.status === 'idle' || !draft.startTime) return false;
  state = { ...draft, status: 'paused', newSegment: true, lastTick: null };
  startTicking();
  emit();
  return true;
}
