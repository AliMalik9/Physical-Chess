import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";

import {createGame, joinGame} from "./helpers";

async function themeOf(page: Page) {
  return page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    hasClass: {
      light: document.documentElement.classList.contains("light"),
      dark: document.documentElement.classList.contains("dark"),
    },
    stored: localStorage.getItem("heroui-theme"),
    background: getComputedStyle(document.body).backgroundColor,
  }));
}

test.describe("theming", () => {
  test("follows the system preference on a first visit", async ({browser}) => {
    const dark = await browser.newContext({colorScheme: "dark"});
    const darkPage = await dark.newPage();
    await darkPage.goto("/");
    expect((await themeOf(darkPage)).attr).toBe("dark");

    const light = await browser.newContext({colorScheme: "light"});
    const lightPage = await light.newPage();
    await lightPage.goto("/");
    expect((await themeOf(lightPage)).attr).toBe("light");

    await dark.close();
    await light.close();
  });

  test("keeps the chosen theme across a reload, with no flash", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", {name: /Switch to (light|dark) mode/}).click();

    const chosen = await themeOf(page);
    expect(chosen.stored).toBe(chosen.attr);

    await page.reload();

    // The inline script in index.html applies the theme before the first
    // paint, so the very first observable state is already correct — there is
    // no moment where the document is unthemed.
    const afterReload = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute("data-theme"),
      // React has not necessarily mounted yet at this point.
      mounted: Boolean(document.getElementById("root")?.firstChild),
    }));
    expect(afterReload.attr).toBe(chosen.attr);

    await expect(page.getByRole("heading", {name: /Play together/})).toBeVisible();
    expect((await themeOf(page)).attr).toBe(chosen.attr);
  });

  test("switches during a game without disturbing the room", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({colorScheme: "light"});
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    await expect(
      alex.getByRole("heading", {name: "Make your move"}),
    ).toBeVisible();

    // Pick a piece so there is live, unsent UI state to lose.
    await alex.locator('[data-square="e2"]').click();
    await expect(
      alex.getByText(/pawn selected on E2/i).filter({visible: true}),
    ).toBeVisible();

    expect((await themeOf(alex)).attr).toBe("light");
    await alex.getByRole("button", {name: "Settings"}).click();
    await alex
      .locator('label[data-slot="radio-content"]')
      .filter({hasText: /^Dark$/})
      .click();

    expect((await themeOf(alex)).attr).toBe("dark");

    await alex.keyboard.press("Escape");

    // The room is untouched: same seat, same position, same selection.
    await expect(alex.getByText("Alex (you)")).toBeVisible();
    await expect(
      alex.getByText(/pawn selected on E2/i).filter({visible: true}),
    ).toBeVisible();
    await expect(
      alex.getByRole("button", {name: "E2, white pawn, selected"}),
    ).toBeVisible();

    // And the game still works afterwards.
    await alex.locator('[data-square="e4"]').click();
    await expect(
      alex.getByRole("heading", {name: "Send this move?"}),
    ).toBeVisible();

    await hostContext.close();
    await sam.context().close();
  });

  test("the board artwork is identical in both themes", async ({page}) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="board"]')).toBeVisible();

    const read = () =>
      page.evaluate(() => {
        const board = document.querySelector('[data-testid="board"]');
        return getComputedStyle(board!).backgroundImage;
      });

    const first = await read();
    await page.getByRole("button", {name: /Switch to (light|dark) mode/}).click();
    const second = await read();

    // The wood must never be recoloured by the interface theme.
    expect(second).toBe(first);
    expect(first).toContain("brown.png");
  });

  test("the game screen has no axe violations in dark mode", async ({
    browser,
  }) => {
    const context = await browser.newContext({colorScheme: "dark"});
    const alex = await context.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    await expect(
      alex.getByRole("heading", {name: "Make your move"}),
    ).toBeVisible();
    expect((await themeOf(alex)).attr).toBe("dark");

    const results = await new AxeBuilder({page: alex})
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .exclude("[data-live-announcer]")
      .analyze();

    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
      })),
      "axe violations on the dark-mode game screen",
    ).toEqual([]);

    await context.close();
    await sam.context().close();
  });
});
