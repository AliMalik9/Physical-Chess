import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

/**
 * URL building for the two supported deployments.
 *
 * `API_ORIGIN` is read once when the module loads, so each case re-imports the
 * module with a different stubbed env rather than mutating it afterwards.
 */
async function loadApi(origin?: string) {
  vi.resetModules();
  if (origin === undefined) vi.stubEnv("VITE_API_ORIGIN", "");
  else vi.stubEnv("VITE_API_ORIGIN", origin);
  return import("@/lib/api");
}

beforeEach(() => {
  // jsdom defaults to http://localhost:3000; pin it so assertions are stable.
  Object.defineProperty(window, "location", {
    value: new URL("https://play.boardlink.test/room/ABCD1234"),
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("single-origin deployment (Cloudflare serves both)", () => {
  it("calls the API on the current origin", async () => {
    const api = await loadApi();
    expect(api.pgnUrl("ABCD1234", "tok")).toBe(
      "/api/rooms/ABCD1234/pgn?seat=tok",
    );
  });

  it("derives the socket URL from the page protocol", async () => {
    const api = await loadApi();
    expect(api.socketUrl("ABCD1234")).toBe(
      "wss://play.boardlink.test/api/rooms/ABCD1234/ws",
    );
  });

  it("uses ws:// when the page is not secure", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:5173/"),
      writable: true,
    });

    const api = await loadApi();
    expect(api.socketUrl("ABCD1234")).toBe(
      "ws://localhost:5173/api/rooms/ABCD1234/ws",
    );
  });
});

describe("split deployment (client on Vercel, Worker on Cloudflare)", () => {
  const WORKER = "https://boardlink.example.workers.dev";

  it("points API calls at the Worker", async () => {
    const api = await loadApi(WORKER);
    expect(api.pgnUrl("ABCD1234", "tok")).toBe(
      `${WORKER}/api/rooms/ABCD1234/pgn?seat=tok`,
    );
  });

  it("opens the socket against the Worker over wss", async () => {
    const api = await loadApi(WORKER);
    expect(api.socketUrl("ABCD1234")).toBe(
      "wss://boardlink.example.workers.dev/api/rooms/ABCD1234/ws",
    );
  });

  it("tolerates a trailing slash on the configured origin", async () => {
    const api = await loadApi(`${WORKER}/`);
    expect(api.pgnUrl("ABCD1234", "tok")).toBe(
      `${WORKER}/api/rooms/ABCD1234/pgn?seat=tok`,
    );
    expect(api.socketUrl("ABCD1234")).toBe(
      "wss://boardlink.example.workers.dev/api/rooms/ABCD1234/ws",
    );
  });

  it("keeps invite links on the client origin, not the Worker", async () => {
    const api = await loadApi(WORKER);
    // The invite is where a player opens the app, which is never the Worker.
    expect(api.inviteUrl("ABCD1234", "s3cret")).toBe(
      "https://play.boardlink.test/room/ABCD1234#s3cret",
    );
  });

  it("percent-encodes the invite secret", async () => {
    const api = await loadApi(WORKER);
    expect(api.inviteUrl("ABCD1234", "a+b/c=")).toContain("#a%2Bb%2Fc%3D");
  });
});
