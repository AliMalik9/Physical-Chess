import {test, type Page} from "@playwright/test";

import {createGame, joinGame} from "./helpers";

test.skip(!process.env.PLAYWRIGHT_LOCAL_SUPABASE, "requires local Supabase; never uses production");

/**
 * Regenerates the screenshots in docs/screenshots.
 *
 * Excluded from the normal suite (see playwright.config.ts) because it writes
 * files rather than asserting anything. Run it with:
 *   npx playwright test --project=screenshots
 */
const DESKTOP = {width: 1440, height: 900};
const MOBILE = {width: 390, height: 844};

async function settle(page: Page) {
  await page.waitForTimeout(700);
}

for (const scheme of ["light", "dark"] as const) {
  test(`capture ${scheme} theme`, async ({browser}) => {
    const hostContext = await browser.newContext({colorScheme: scheme});
    const alex = await hostContext.newPage();
    await alex.setViewportSize(DESKTOP);

    await alex.goto("/");
    await settle(alex);
    await alex.screenshot({path: `docs/screenshots/landing-desktop-${scheme}.png`});

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    await settle(alex);
    await alex.screenshot({path: `docs/screenshots/waiting-desktop-${scheme}.png`});

    const sam = await joinGame(browser, invite, "Sam", {colorScheme: scheme});
    await sam.setViewportSize(MOBILE);
    await settle(alex);

    // Desktop: a move chosen and awaiting confirmation.
    await alex.locator('[data-square="e2"]').click();
    await alex.locator('[data-square="e4"]').click();
    await settle(alex);
    await alex.screenshot({path: `docs/screenshots/game-desktop-${scheme}.png`});

    await alex.getByRole("button", {name: "Send move"}).click();
    await settle(sam);

    // Mobile: the state that matters most — copying the opponent's move.
    await sam.screenshot({path: `docs/screenshots/game-mobile-${scheme}.png`});

    await hostContext.close();
    await sam.context().close();
  });
}
