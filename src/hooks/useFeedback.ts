import {useCallback, useRef, useState} from "react";

const MUTE_KEY = "boardlink.muted";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Sound and vibration for the two moments that happen while the player is
 * looking at a wooden board instead of a screen: their move landing, and their
 * turn arriving.
 *
 * The tone is synthesised rather than loaded so there is no audio file to
 * download and nothing to autoplay. Audio is only ever created inside a user
 * gesture chain, which is also what browsers require.
 */
export function useFeedback() {
  const [isMuted, setIsMuted] = useState(readMuted);
  const contextRef = useRef<AudioContext | null>(null);

  const toggleMuted = useCallback(() => {
    setIsMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // A browser refusing storage should not stop the toggle working for
        // this session.
      }
      return next;
    });
  }, []);

  const playTurnChime = useCallback(() => {
    if (isMuted) return;

    try {
      const AudioContextClass =
        window.AudioContext ??
        (window as {webkitAudioContext?: typeof AudioContext})
          .webkitAudioContext;
      if (!AudioContextClass) return;

      const context = (contextRef.current ??= new AudioContextClass());
      if (context.state === "suspended") void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      // A soft two-note rise. Short and quiet: this plays in a room where two
      // people are concentrating.
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.09);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.28,
      );

      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.3);
    } catch {
      // Audio is a nicety; never let it break a turn.
    }
  }, [isMuted]);

  const vibrate = useCallback(
    (pattern: number | number[]) => {
      if (isMuted) return;
      try {
        navigator.vibrate?.(pattern);
      } catch {
        // Unsupported on desktop and iOS Safari. Nothing to fall back to.
      }
    },
    [isMuted],
  );

  return {isMuted, toggleMuted, playTurnChime, vibrate};
}
