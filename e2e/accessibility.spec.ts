import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";

import {createGame, joinGame, playMove} from "./helpers";

test.skip(!process.env.PLAYWRIGHT_LOCAL_SUPABASE, "requires local Supabase; never uses production");

/**
 * WCAG 2.2 AA on every screen a player can reach.
 *
 * The tags are the machine-checkable subset; the parts axe cannot judge —
 * whether the wording is plain enough, whether a child can find the next
 * action — are covered by the two-player spec and the unit tests instead.
 */
/**
 * Waits for every running animation to finish.
 *
 * axe samples computed colours, so scanning mid-fade reports contrast failures
 * against a half-transparent element that no user ever sees.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      if (animation.playState !== "running") return false;
      // Looping animations — the pulsing status dot, for one — never finish,
      // so awaiting them would hang forever.
      const iterations = animation.effect?.getTiming().iterations ?? 1;
      return Number.isFinite(iterations);
    });

    await Promise.race([
      Promise.all(
        finite.map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  });
}

async function expectNoViolations(page: Page, context?: string) {
  await settle(page);

  const results = await new AxeBuilder({page})
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    /*
     * react-aria's LiveAnnouncer. It is a visually hidden scratch region that
     * react-aria writes into to force screen-reader announcements, and it
     * leaves behind an empty role="img" node after a message is cleared. It is
     * third-party assistive-tech plumbing rather than BoardLink UI, and
     * excluding it keeps the scan pointed at markup we actually control.
     */
    .exclude("[data-live-announcer]")
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target).slice(0, 3),
    })),
    `axe violations on ${context ?? page.url()}`,
  ).toEqual([]);
}

test.describe("accessibility of the primary screens", () => {
  test("landing screen", async ({page}) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {name: /Play together/}),
    ).toBeVisible();
    await expectNoViolations(page, "landing");
  });

  test("start-game dialog", async ({page}) => {
    await page.goto("/");
    await page.getByRole("button", {name: "Start a game"}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page, "start-game dialog");
  });

  test("join screen", async ({page}) => {
    await page.goto("/join");
    await expect(page.getByRole("heading", {name: "Join a game"})).toBeVisible();
    await expectNoViolations(page, "join");
  });

  test("join screen showing an error", async ({page}) => {
    await page.goto("/join");
    await page.getByLabel("Game code").fill("ABCD-EFGO");
    await page.getByRole("button", {name: "Join game"}).click();
    await expect(page.getByText("That code does not look right")).toBeVisible();
    await expectNoViolations(page, "join error");
  });

  test("how it works", async ({page}) => {
    await page.goto("/how-it-works");
    await expect(
      page.getByRole("heading", {name: "How BoardLink works"}),
    ).toBeVisible();
    await expectNoViolations(page, "how-it-works");
  });

  test("waiting room", async ({page}) => {
    await createGame(page, {name: "Alex", side: "White"});
    await expectNoViolations(page, "waiting room");
  });

  test("game screen, on your turn and while copying a move", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    // State A: the board is live and the player is choosing a move.
    await expect(alex.getByRole("heading", {name: "Make your move"})).toBeVisible();
    await expectNoViolations(alex, "game — your turn");

    await alex.locator('[data-square="e2"]').click();
    await alex.locator('[data-square="e4"]').click();
    await expect(
      alex.getByRole("heading", {name: "Send this move?"}),
    ).toBeVisible();
    await expectNoViolations(alex, "game — confirm move");

    await alex.getByRole("button", {name: "Send move"}).click();

    // State C: the screen that matters most.
    await expect(sam.getByRole("heading", {name: "Alex moved"})).toBeVisible();
    await expectNoViolations(sam, "game — copy the opponent's move");

    // State B: waiting for the other player.
    await expectNoViolations(alex, "game — move sent");

    await hostContext.close();
    await sam.context().close();
  });
});

test.describe("keyboard and screen reader support", () => {
  test("the whole landing flow is reachable with a keyboard", async ({page}) => {
    await page.goto("/");

    // Tab until the primary action has focus, then activate it with the
    // keyboard alone.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(
        () => document.activeElement?.textContent?.trim() ?? "",
      );
      if (label === "Start a game") break;
    }

    await expect(page.locator(":focus")).toContainText("Start a game");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Escape closes it without trapping the user.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("announces an arriving move through a live region", async ({browser}) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    await playMove(alex, sam, "e2", "e4");

    // Polite, so it never interrupts what the user is doing.
    const live = sam.locator("#boardlink-announcer");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toContainText("Alex moved");
    await expect(live).toContainText("Move the white pawn from E2 to E4.");

    await hostContext.close();
    await sam.context().close();
  });

  test("exposes every square as a labelled, keyboard-reachable control", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    // Squares describe themselves rather than being anonymous buttons.
    await expect(
      alex.getByRole("button", {name: "E2, white pawn"}),
    ).toBeVisible();
    await expect(alex.getByRole("button", {name: "E4, empty"})).toBeVisible();

    // Roving tabindex: exactly one square is in the tab order, and the arrow
    // keys move between squares from there.
    const tabbable = alex.locator('[data-square][tabindex="0"]');
    await expect(tabbable).toHaveCount(1);

    await tabbable.focus();
    await alex.keyboard.press("ArrowUp");
    await expect(alex.locator(":focus")).toHaveAttribute("data-square", "e5");

    // And a square can be activated with the keyboard alone.
    await alex.locator('[data-square="e2"]').focus();
    await alex.keyboard.press("Enter");
    await expect(
      alex.getByText(/pawn selected on E2/i).filter({visible: true}),
    ).toBeVisible();

    await hostContext.close();
    await sam.context().close();
  });
});

test.describe("responsive layouts", () => {
  const sizes = [
    {name: "small phone", width: 320, height: 568},
    {name: "phone", width: 390, height: 844},
    {name: "large phone", width: 430, height: 932},
    {name: "tablet portrait", width: 768, height: 1024},
    {name: "tablet landscape", width: 1024, height: 768},
    {name: "laptop", width: 1280, height: 800},
    {name: "desktop", width: 1920, height: 1080},
  ];

  for (const size of sizes) {
    test(`landing fits ${size.name} without sideways scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({width: size.width, height: size.height});
      await page.goto("/");
      await expect(
        page.getByRole("button", {name: "Start a game"}),
      ).toBeVisible();

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, "page scrolls horizontally").toBe(false);
    });
  }

  test("stays usable at 200% zoom", async ({page}) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto("/");
    // Emulating 200% zoom by halving the viewport in CSS pixels.
    await page.setViewportSize({width: 640, height: 400});

    await expect(page.getByRole("button", {name: "Start a game"})).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
