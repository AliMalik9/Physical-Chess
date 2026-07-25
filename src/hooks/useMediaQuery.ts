import {useSyncExternalStore} from "react";

/**
 * Reads a media query reactively.
 *
 * Used for the two places where layout genuinely changes shape rather than
 * reflowing: the desktop two-column game frame, and honouring reduced motion.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // Server/prerender fallback: assume the narrow, single-column layout.
    () => false,
  );
}

/** True once there is room for the board and the instruction panel side by side. */
export function useIsWideLayout(): boolean {
  return useMediaQuery("(min-width: 900px)");
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
