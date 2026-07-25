# Third-party notices

BoardLink bundles artwork from the Lichess open-source project. This file
records exactly what was taken, from where, and under which licence.

BoardLink is **not** affiliated with, sponsored by, or endorsed by Lichess.

---

## Lichess board and piece artwork

| | |
| --- | --- |
| Project | lila (the Lichess server and web client) |
| Repository | https://github.com/lichess-org/lila |
| Commit used | `e230f3e0afb3ffad6837530b401b7d09a394c645` |
| Date extracted | 26 July 2026 |
| Modified? | **No.** All files are byte-for-byte copies. |

### Board — “Brown”

| | |
| --- | --- |
| Source path | `public/images/board/brown.png` |
| Vendored to | `public/vendor/lichess/board/brown.png` |
| Authors | The lila authors and [pirouetti](https://lichess.org/@/pirouetti) |
| Licence | AGPL-3.0-or-later |

### Pieces — “Maestro”

| | |
| --- | --- |
| Source path | `public/piece/maestro/*.svg` (12 files) |
| Vendored to | `public/vendor/lichess/pieces/maestro/*.svg` |
| Author | sadsnake1 |
| Licence | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

Files: `wK.svg`, `wQ.svg`, `wR.svg`, `wB.svg`, `wN.svg`, `wP.svg`, `bK.svg`,
`bQ.svg`, `bR.svg`, `bB.svg`, `bN.svg`, `bP.svg`.

Licence attributions are as published in
[`COPYING.md`](https://github.com/lichess-org/lila/blob/master/COPYING.md) at
the commit above.

### Required attribution

Shown in the app under **Settings → About the board artwork**:

> Chessboard artwork adapted from assets distributed by Lichess.

---

## ⚠️ Before any commercial release

**The Maestro piece set is licensed CC BY-NC-SA 4.0, which prohibits commercial
use.** BoardLink may ship these exact assets as a properly attributed
non-commercial project, but if this product is ever monetised — subscriptions,
advertising, paid tiers, or bundling into a commercial offering — you must
first do one of the following:

1. Obtain written permission from sadsnake1 for commercial use, or
2. Replace the piece set with one whose licence permits commercial use (the
   lila repository lists MIT- and CC0-licensed sets, such as Fantasy, Spatial,
   Celtic and RhosGFX), or
3. Commission or draw an original piece set.

CC BY-NC-SA is also **share-alike**: derivative artwork must carry the same
licence. The assets here are unmodified, so no derivative licensing applies
today — but recolouring or redrawing them would trigger it.

Separately, the board image is **AGPL-3.0-or-later**. Distributing it alongside
this application has implications for how the surrounding source is licensed;
review the AGPL's terms before shipping a closed-source product that includes
it.

Nothing here is legal advice.

---

## Re-extracting the assets

`scripts/fetch-lichess-assets.sh` performs a blobless sparse checkout — a full
clone of lila is several gigabytes, and only two directories are needed:

```bash
npm run assets:lichess
```

The script prints the commit hash it used; update the table above whenever the
assets are refreshed.

---

## Software dependencies

Runtime dependencies and their licences are declared in `package.json` and
resolved in `package-lock.json`. The notable ones:

| Package | Licence |
| --- | --- |
| `@heroui/react`, `@heroui/styles` | MIT |
| `react`, `react-dom` | MIT |
| `chess.js` | BSD-2-Clause |
| `lucide-react` | ISC |
| `tailwindcss` | MIT |

Run `npx license-checker --summary` for a complete, current list.
