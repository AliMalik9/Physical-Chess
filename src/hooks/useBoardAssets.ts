import {useEffect, useState} from "react";

import {allBoardAssets} from "@/lib/pieceAssets";

type LoadState = "loading" | "ready" | "failed";

/**
 * Decoded once per page load and shared by every caller, so navigating between
 * the landing preview and a game never re-fetches the board.
 */
let sharedLoad: Promise<void> | null = null;

function loadAll(): Promise<void> {
  sharedLoad ??= Promise.all(
    allBoardAssets().map(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(src));
          image.src = src;
        }),
    ),
  ).then(() => undefined);

  return sharedLoad;
}

/**
 * Waits for the board and all twelve pieces before the game is shown.
 *
 * Preloading matters here beyond polish: without it the pieces pop in one by
 * one as each SVG arrives, which on a board someone is trying to copy from
 * looks exactly like pieces moving.
 */
export function useBoardAssets(): {isReady: boolean; hasFailed: boolean} {
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;

    loadAll().then(
      () => active && setState("ready"),
      () => {
        if (!active) return;
        // Let the next mount retry rather than caching the failure forever.
        sharedLoad = null;
        setState("failed");
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return {isReady: state === "ready", hasFailed: state === "failed"};
}
