import "@testing-library/jest-dom/vitest";
import {afterEach} from "vitest";
import {cleanup} from "@testing-library/react";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// jsdom implements neither of these, and both are used on paths the tests
// exercise (invite sharing, opponent-move feedback).
// `configurable` matters so a test can replace the stub if it needs to assert
// on what was copied.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: {writeText: async () => undefined},
    writable: true,
    configurable: true,
  });
}

if (!("vibrate" in navigator)) {
  Object.defineProperty(navigator, "vibrate", {
    value: () => true,
    writable: true,
    configurable: true,
  });
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
