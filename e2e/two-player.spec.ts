import {expect, test, type WebSocketRoute} from "@playwright/test";

import {confirmCopy, createGame, joinGame, playMove} from "./helpers";

test.skip(!process.env.PLAYWRIGHT_LOCAL_SUPABASE, "requires local Supabase; never uses production");

test.describe("two people, two boards", () => {
  test("plays moves in both directions with a copy confirmation each way", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    // The host leaves the waiting room by itself once someone joins — no
    // second "Start" button to press.
    await expect(alex.locator('[data-square="e2"]')).toBeVisible();
    await expect(alex.getByText("Sam", {exact: true})).toBeVisible();

    // Alex enters the move they already made on wood.
    await expect(alex.getByRole("heading", {name: "Make your move"})).toBeVisible();
    await alex.locator('[data-square="e2"]').click();
    await alex.locator('[data-square="e4"]').click();

    // The second tap confirms rather than sends.
    await expect(
      alex.getByRole("heading", {name: "Send this move?"}),
    ).toBeVisible();
    await alex.getByRole("button", {name: "Send move"}).click();
    await expect(alex.getByRole("heading", {name: "Move sent"})).toBeVisible();

    // Sam reads the move in words. Notation is present but secondary.
    // Filtered to visible matches: the sync-recovery dialog is always mounted
    // (as a closed native <dialog>) and lists the same move history.
    await expect(sam.getByRole("heading", {name: "Alex moved"})).toBeVisible();
    await expect(
      sam
        .getByText("Move the white pawn from E2 to E4.", {exact: true})
        .filter({visible: true}),
    ).toBeVisible();

    // Sam does not get the move until they say they copied it.
    await expect(
      sam.getByRole("heading", {name: "Make your move"}),
    ).not.toBeVisible();
    await confirmCopy(sam);
    await expect(sam.getByRole("heading", {name: "Make your move"})).toBeVisible();

    // And back the other way.
    await playMove(sam, alex, "e7", "e5");
    await expect(alex.getByRole("heading", {name: "Make your move"})).toBeVisible();

    await hostContext.close();
    await sam.context().close();
  });

  test("keeps each player's seat and the position across a refresh", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    await playMove(alex, sam, "d2", "d4");

    await alex.reload();
    await sam.reload();

    // Same seats, same names, same position — restored from the seat token and
    // the server snapshot, with nothing re-entered by hand.
    await expect(alex.getByText("Alex (you)")).toBeVisible();
    await expect(sam.getByText("Sam (you)")).toBeVisible();
    await expect(sam.getByRole("heading", {name: "Make your move"})).toBeVisible();

    // The pawn really is on d4 for both of them. Asserted through the square's
    // accessible name, which is what a screen reader would announce.
    await expect(
      alex.getByRole("button", {name: "D4, white pawn, part of the last move"}),
    ).toBeVisible();
    await expect(
      sam.getByRole("button", {name: "D4, white pawn, part of the last move"}),
    ).toBeVisible();

    await hostContext.close();
    await sam.context().close();
  });

  test("recovers the game after the connection drops", async ({browser}) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    // Proxy Alex's socket so the test can sever it on demand. Going offline is
    // not enough: an already-open WebSocket survives it, so the client would
    // never notice anything and the test would prove nothing.
    const sockets: WebSocketRoute[] = [];
    await alex.routeWebSocket(/\/ws$/, (socket) => {
      socket.connectToServer();
      sockets.push(socket);
    });

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    await playMove(alex, sam, "e2", "e4");
    await expect(sam.getByRole("heading", {name: "Make your move"})).toBeVisible();

    // Pull the connection out from under Alex.
    expect(sockets.length).toBeGreaterThan(0);
    sockets[sockets.length - 1]!.close();

    await expect(alex.getByText("Trying to reconnect…")).toBeVisible({
      timeout: 20_000,
    });

    // It comes back on its own, and the position is intact.
    await expect(alex.getByText("Trying to reconnect…")).not.toBeVisible({
      timeout: 30_000,
    });
    await expect(
      alex.getByRole("button", {name: /^E4, white pawn/}),
    ).toBeVisible();

    // A move made while Alex was away still arrives after the reconnect.
    await playMove(sam, alex, "e7", "e5");
    await expect(alex.getByRole("heading", {name: "Make your move"})).toBeVisible();

    await hostContext.close();
    await sam.context().close();
  });

  test("plays a checkmate to the end and exports the game", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");

    // Fool's mate: the shortest checkmate there is.
    await playMove(alex, sam, "f2", "f3");
    await playMove(sam, alex, "e7", "e5");
    await playMove(alex, sam, "g2", "g4");

    // Sam delivers mate. Alex still has to place the queen on their own board
    // before the result screen replaces the instruction.
    await expect(sam.getByRole("heading", {name: "Make your move"})).toBeVisible();
    await sam.locator('[data-square="d8"]').click();
    await sam.locator('[data-square="h4"]').click();
    await sam.getByRole("button", {name: "Send move"}).click();

    await expect(sam.getByRole("heading", {name: "Checkmate"})).toBeVisible();
    await expect(sam.getByText("Sam wins.")).toBeVisible();

    await confirmCopy(alex);
    await expect(alex.getByRole("heading", {name: "Checkmate"})).toBeVisible();
    await expect(alex.getByText("Sam wins.")).toBeVisible();

    // PGN is downloadable while the room is still retained.
    const download = alex.waitForEvent("download");
    await alex.getByRole("button", {name: "Download PGN"}).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain(".pgn");

    await hostContext.close();
    await sam.context().close();
  });

  test("turns a third person away rather than giving them a seat", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();

    const invite = await createGame(alex, {name: "Alex", side: "White"});
    const sam = await joinGame(browser, invite, "Sam");
    await expect(alex.locator('[data-square="e2"]')).toBeVisible();

    const intruderContext = await browser.newContext();
    const intruder = await intruderContext.newPage();
    await intruder.goto(invite.url);

    await expect(
      intruder.getByText("This game already has two players"),
    ).toBeVisible();
    // And the real game is untouched.
    await expect(alex.getByRole("heading", {name: "Make your move"})).toBeVisible();

    await hostContext.close();
    await sam.context().close();
    await intruderContext.close();
  });
});

test.describe("joining", () => {
  test("accepts a typed room code with any spacing", async ({browser}) => {
    const hostContext = await browser.newContext();
    const alex = await hostContext.newPage();
    const invite = await createGame(alex, {name: "Alex", side: "White"});

    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();

    await guest.goto("/join");
    // Lower case, with a hyphen the player added themselves.
    const spaced = `${invite.code.slice(0, 4)}-${invite.code.slice(4)}`.toLowerCase();
    await guest.getByLabel("Game code").fill(spaced);
    await guest.getByRole("button", {name: "Join game"}).click();

    await expect(
      guest.getByRole("heading", {name: /Join Alex.s game\?/}),
    ).toBeVisible();

    await hostContext.close();
    await guestContext.close();
  });

  test("explains an unknown code instead of failing silently", async ({
    page,
  }) => {
    await page.goto("/join");
    // Well-formed, but astronomically unlikely to have ever been issued.
    await page.getByLabel("Game code").fill("2222-3333");
    await page.getByRole("button", {name: "Join game"}).click();

    await expect(page.getByText("No game with that code")).toBeVisible();
  });

  test("rejects a code containing ambiguous characters", async ({page}) => {
    await page.goto("/join");
    await page.getByLabel("Game code").fill("ABCD-EFGO");
    await page.getByRole("button", {name: "Join game"}).click();

    await expect(page.getByText("That code does not look right")).toBeVisible();
  });
});
