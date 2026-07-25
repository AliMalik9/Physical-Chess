import {expect, type Browser, type Page} from "@playwright/test";

/**
 * Shared driving code for the two-player specs.
 *
 * Each player gets their own browser context, because a seat token lives in
 * localStorage and two contexts is the only honest way to model two devices.
 */

export interface Invite {
  url: string;
  code: string;
}

/**
 * HeroUI renders the real <input> of a radio or checkbox visually hidden, so
 * the clickable target is its label, not the input.
 */
export function heroRadio(scope: Page | ReturnType<Page["locator"]>, label: string) {
  return scope
    .locator('label[data-slot="radio-content"]')
    .filter({hasText: new RegExp(`^${label}$`, "i")});
}

/** Creates a game and returns the invite the second player needs. */
export async function createGame(
  page: Page,
  options: {name?: string; side?: "White" | "Black" | "Surprise me"} = {},
): Promise<Invite> {
  await page.goto("/");
  await page.getByRole("button", {name: "Start a game"}).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  if (options.name) {
    await dialog.getByLabel("Your name").fill(options.name);
  }
  if (options.side) {
    await heroRadio(dialog, options.side).first().click();
  }

  await dialog.getByRole("button", {name: "Create game"}).click();

  // Read from the address bar rather than the page: creating a room navigates
  // to /room/<code>#<invite secret>, which is the invite link itself.
  await page.waitForURL(/\/room\/[A-Z0-9]+#/);
  const url = page.url();
  const code = new URL(url).pathname.split("/").pop() ?? "";

  await expect(
    page.getByRole("heading", {name: "Invite someone to play"}),
  ).toBeVisible();

  return {url, code};
}

/** Opens the invite in a fresh context and takes the second seat. */
export async function joinGame(
  browser: Browser,
  invite: Invite,
  name: string,
  /** The guest is a separate device, so its preferences do not carry over. */
  options: {colorScheme?: "light" | "dark"} = {},
): Promise<Page> {
  const context = await browser.newContext(
    options.colorScheme ? {colorScheme: options.colorScheme} : {},
  );
  const page = await context.newPage();

  await page.goto(invite.url);
  await expect(page.getByRole("heading", {name: /Join .*game\?/})).toBeVisible();

  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", {name: "Join game"}).click();

  await expect(page.locator('[data-square="e2"]')).toBeVisible();
  return page;
}

/**
 * Plays one move end to end: the mover enters it and sends it, then the
 * receiver copies it onto their (imaginary) board and confirms.
 */
export async function playMove(
  mover: Page,
  receiver: Page,
  from: string,
  to: string,
): Promise<void> {
  await expect(
    mover.getByRole("heading", {name: "Make your move"}),
  ).toBeVisible();

  await mover.locator(`[data-square="${from}"]`).click();
  await mover.locator(`[data-square="${to}"]`).click();

  // Nothing is sent on the second tap; the confirmation step is deliberate.
  await expect(
    mover.getByRole("heading", {name: "Send this move?"}),
  ).toBeVisible();
  await mover.getByRole("button", {name: "Send move"}).click();

  await expect(mover.getByRole("heading", {name: "Move sent"})).toBeVisible();

  await confirmCopy(receiver);
}

/** Ticks any physical steps, then presses the confirmation. */
export async function confirmCopy(receiver: Page): Promise<void> {
  await expect(receiver.getByRole("heading", {name: /moved$/})).toBeVisible();

  const steps = receiver.locator('label[data-slot="checkbox-content"]');
  const count = await steps.count();
  for (let i = 0; i < count; i += 1) {
    await steps.nth(i).click();
  }

  const done = receiver.getByRole("button", {name: "Done — I moved it"});
  await expect(done).toBeEnabled();
  await done.click();
}
