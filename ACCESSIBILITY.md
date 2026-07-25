# Accessibility

Target: **WCAG 2.2 AA**.

The audience includes children who are still learning the pieces, and adults
using a phone propped next to a chessboard in bad light. Those two shape almost
every decision here.

## Automated coverage

`e2e/accessibility.spec.ts` runs axe-core against every screen a player can
reach, on desktop and mobile viewports, with the tags
`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`:

- landing
- start-game modal
- join, and join showing an error
- how it works
- waiting room
- game: your turn, confirm move, copying the opponent's move, move sent

`e2e/theme.spec.ts` repeats the game-screen scan in **dark mode**, because a
palette that passes in one theme can fail in the other.

Both suites report **zero violations**. They also cover keyboard operation, the
live region, square labelling, roving focus, seven viewport sizes and 200% zoom.

One exclusion is applied: `[data-live-announcer]`, react-aria's visually hidden
scratch region. It writes and clears announcement nodes and leaves behind an
empty `role="img"` element, which axe flags. It is third-party assistive-tech
plumbing rather than BoardLink markup, and excluding it keeps the scan pointed
at code we control.

Automation only catches what automation can catch. Whether the wording is plain
enough for a five-year-old is covered by `tests/moveLanguage.test.ts`, which
asserts the exact sentences.

## Never colour alone

Chess is a game about two colours, played by people who may not distinguish
them. Nothing depends on hue:

- Whose turn it is, is written: **“Your turn”**, **“Copy their move”**,
  **“Sam’s turn”**.
- Connection status is a dot **with its label** beside it, plus a tooltip.
- Each player strip carries a colour token *and* the words “White” / “Black”.
- Legal destinations are a **dot** on an empty square and a **ring** on a
  capture — different shapes, not different colours.
- Check is a restrained red-brown wash plus the words “Your king is in check”.
  It never flashes or pulses.

## The board

The board is a purpose-built component, and its accessibility is structural
rather than bolted on.

**Every square is a real `<button>`.** The interaction layer is 64 buttons in a
grid; the pieces are a separate, purely decorative layer marked `aria-hidden`
and `pointer-events: none`. That means there is exactly one accessible element
per square and no anonymous controls anywhere.

**Every square describes itself.** Labels come from `describeSquare()`:

> “E4, white pawn, part of the last move”
> “D5, black knight, can be captured”
> “E5, empty, can move here”

**Roving tabindex.** Exactly one square is in the tab order; arrow keys move
between squares and update which one is tabbable. Sixty-four tab stops would be
unusable, and marking them all `-1` would make the board unreachable — an actual
bug caught during the redesign.

**Enter or Space selects**, then the same again on a destination. The
confirmation step then applies as it does for pointer input, so a keyboard user
never sends a move by accident either.

The previous implementation used a third-party board whose pieces were
`role="button"` with no accessible name; labels had to be injected with a
MutationObserver. Replacing it removed that hack entirely.

## Announcements

`#boardlink-announcer` is an `aria-live="polite"` region carrying the opponent's
move in full: *“Sam moved. Move the black pawn from E7 to E5.”* Polite, so it
never interrupts. Illegal moves are announced the same way and do **not** move
focus — the board clears the selection and the player picks again.

## Instructions are never hidden

Nothing essential lives in a tooltip or a hover state. The move instruction is
the largest text on the screen. Tooltips only ever repeat a control's own label.

Moves needing more than one physical action — castling, captures, en passant,
promotion — become an explicit checklist, and the confirmation stays disabled
until every step is ticked. That is the only disabled control in the product,
and the reason is stated on screen (“Tick every step above to turn on this
button”).

## Targets and typography

- Primary actions are `size="lg"` and full width, well past the 24×24 CSS pixel
  minimum of WCAG 2.2 (2.5.8).
- Promotion choices are large cards with the piece **and** its name — never
  icon-only. The knight and rook carry hints (“Knight — the horse piece”).
- Squares and clocks use tabular numerals so digits do not jitter.
- Layout is tested from 320px to 1920px with no horizontal scrolling, and at
  200% zoom.
- Type scales with the user's settings; nothing is pinned to a pixel size.

## Motion

Durations follow the brief: ~100–140ms for presses, ~160–220ms for board
movement, ~220–300ms for panels. Easing is `cubic-bezier(0.22, 1, 0.36, 1)`.
Interaction is never gated behind an animation.

`prefers-reduced-motion: reduce` removes the piece transition and shortens
everything else. Move animation can also be turned off in Settings
independently of the OS setting.

## Themes

Light, dark and system, with the choice persisted. The theme is applied by an
inline script before the first paint, so there is no flash — and no moment where
text sits on the wrong background.

Dark mode is a warm charcoal rather than pure black, and light mode is an ivory
rather than pure white: both reduce the contrast shock against a brightly lit
wooden board.

The board artwork is identical in both themes, so coordinate contrast is keyed
to the square underneath rather than the app theme. Keying it to the theme would
make the labels unreadable in one of them.

## Keyboard

Full keyboard operation throughout, with HeroUI's focus rings left intact.
Modals and drawers trap focus while open, restore it on close, and close on
Escape. The landing flow is tested end to end with the keyboard alone.

## Known gaps

- The visual board is not announced as a grid, so a screen-reader user reads the
  position by moving across squares and through move announcements, rather than
  hearing a whole-board summary. The “Boards don’t match” panel does spell the
  full position out in words.
- Only English is shipped.
