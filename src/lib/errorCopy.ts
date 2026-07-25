import type {ErrorCode} from "@shared/protocol";

/**
 * Every failure the player can reach, in plain words.
 *
 * Two rules, from the product brief: say what happened, then say what to do
 * next. A raw code or a server message never reaches the screen.
 */
export interface ErrorCopy {
  title: string;
  body: string;
  /** Label for the recovery action, when one makes sense. */
  action?: string;
}

const COPY: Record<ErrorCode, ErrorCopy> = {
  protocol_mismatch: {
    title: "This page is out of date",
    body: "BoardLink was updated while you were playing. Reload to carry on.",
    action: "Reload",
  },
  bad_request: {
    title: "Something went wrong",
    body: "That did not work. Try again in a moment.",
    action: "Try again",
  },
  rate_limited: {
    title: "Too many tries",
    body: "Wait a few minutes, then try again.",
  },
  room_not_found: {
    title: "No game with that code",
    body: "Check the code and type it again, or start a new game.",
    action: "Start a new game",
  },
  room_expired: {
    title: "This game has ended",
    body: "Games are kept for a day. Start a new one to play again.",
    action: "Start a new game",
  },
  room_full: {
    title: "This game already has two players",
    body: "Ask your friend for a new link, or start your own game.",
    action: "Start a new game",
  },
  invalid_invite: {
    title: "This link does not work",
    body: "It may have been typed in wrong. Ask your friend to send it again.",
  },
  invalid_code: {
    title: "That code does not look right",
    body: "Codes have eight letters and numbers, like ABCD-EFGH.",
  },
  not_a_player: {
    title: "You are not in this game",
    body: "Ask your friend for the invite link.",
  },
  not_your_turn: {
    title: "It is not your turn yet",
    body: "Wait for your friend to move, then copy it onto your board.",
  },
  wrong_phase: {
    title: "Not just yet",
    body: "Finish the step on screen first, then try again.",
  },
  illegal_move: {
    title: "That move is not allowed",
    body: "Pick your piece again and choose a different square.",
    action: "Choose another piece",
  },
  stale_sequence: {
    title: "Your board was out of date",
    body: "We have caught you up. Have a look, then make your move.",
  },
  duplicate_action: {
    title: "Already done",
    body: "That was already sent, so nothing changed.",
  },
  read_only_connection: {
    title: "This game is open in another tab",
    body: "That tab is in charge. Close this one, or reload to take over here.",
    action: "Take over here",
  },
  game_already_over: {
    title: "This game has finished",
    body: "Start a new game to play again.",
    action: "Play again",
  },
  no_undo_pending: {
    title: "Nothing to take back",
    body: "The take-back request was already answered.",
  },
  no_draw_pending: {
    title: "Nothing to answer",
    body: "The draw offer was already answered.",
  },
  internal_error: {
    title: "Something went wrong",
    body: "Your game is safe. We are reconnecting you now.",
  },
};

export function errorCopy(code: ErrorCode): ErrorCopy {
  return COPY[code] ?? COPY.internal_error;
}

/** Copy for browser capability gaps, which are not server errors. */
export const CAPABILITY_COPY = {
  clipboardDenied: {
    title: "Could not copy the link",
    body: "Your browser blocked copying. Select the link above and copy it yourself.",
  },
  shareUnavailable: {
    title: "Sharing is not available here",
    body: "Use Copy link instead, then paste it into a message.",
  },
  offline: {
    title: "You are offline",
    body: "Your game is saved. It will carry on when you are back online.",
  },
  unsupportedBrowser: {
    title: "This browser is too old for BoardLink",
    body: "Open this link in an up-to-date browser to play.",
  },
} as const;
