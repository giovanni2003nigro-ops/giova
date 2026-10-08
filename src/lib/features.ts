import { useSyncExternalStore } from 'react';

/**
 * Feed & Liga (Community) lassen sich in den Einstellungen ein- und ausschalten.
 * Standard: aus – dann verschwinden Feed und Liga aus der Leiste und nichts wird hochgeladen.
 */
const KEY = 'community';
const EVENT = 'features';

export function communityEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setCommunityEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* privates Fenster */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useCommunity(): boolean {
  return useSyncExternalStore(subscribe, communityEnabled, () => false);
}
