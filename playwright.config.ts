import {defineConfig, devices} from "@playwright/test";
import {loadEnv} from "vite";

const PORT = 5173;
const localEnv = loadEnv("development", process.cwd(), "VITE_");
const hasLocalSupabase = Boolean(
  localEnv.VITE_SUPABASE_URL && localEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
);
if (hasLocalSupabase) process.env.PLAYWRIGHT_LOCAL_SUPABASE = "1";

export default defineConfig({
  testDir: "./e2e",
  // Two-player specs drive two browser contexts in one test; give them room.
  timeout: 90_000,
  expect: {timeout: 15_000},
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", {open: "never"}]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {...devices["Desktop Chrome"]},
      // Screenshot generation is opt-in; it writes files instead of asserting.
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: {...devices["Pixel 7"]},
      // Two-context and theme specs drive their own viewports and contexts,
      // so running them again under a phone profile proves nothing.
      testIgnore: /(two-player|theme|screenshots)\.spec\.ts/,
    },
    /*
     * Cross-browser coverage. The two-player and screenshot specs stay on
     * Chromium — they drive several contexts at once and are about behaviour
     * the engine does not change. What genuinely differs between engines is
     * rendering, layout and pointer handling, which is what these cover.
     */
    {
      name: "firefox",
      use: {...devices["Desktop Firefox"]},
      testMatch: /(accessibility|theme)\.spec\.ts/,
    },
    {
      name: "webkit",
      use: {...devices["Desktop Safari"]},
      testMatch: /(accessibility|theme)\.spec\.ts/,
    },
    {
      // Opt-in: regenerates docs/screenshots. `npx playwright test --project=screenshots`
      name: "screenshots",
      use: {...devices["Desktop Chrome"]},
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
  webServer: {
    // Vite serves the local client; its functions talk only to local Supabase.
    command: "npm run dev -- --port 5173 --strictPort",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
