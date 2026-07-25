import {useCallback, useEffect, useState} from "react";

/**
 * Board and feedback preferences.
 *
 * Kept out of the room state on purpose: these are about this device, not about
 * the game, so they must survive a reconnect and must never be sent anywhere.
 */
export interface GameSettings {
  sound: boolean;
  haptics: boolean;
  coordinates: boolean;
  animations: boolean;
  /** null follows your own colour; true/false forces an orientation. */
  flipped: boolean | null;
}

const STORAGE_KEY = "boardlink.settings";

const DEFAULTS: GameSettings = {
  sound: true,
  haptics: true,
  coordinates: true,
  animations: true,
  flipped: null,
};

function read(): GameSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return {...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>)};
  } catch {
    return DEFAULTS;
  }
}

export function useGameSettings() {
  const [settings, setSettings] = useState<GameSettings>(DEFAULTS);

  // Read after mount so the first render matches on any storage-less browser.
  useEffect(() => setSettings(read()), []);

  const update = useCallback((patch: Partial<GameSettings>) => {
    setSettings((current) => {
      const next = {...current, ...patch};
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode. The change still applies for this session.
      }
      return next;
    });
  }, []);

  return {settings, update};
}
