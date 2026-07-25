#!/usr/bin/env bash
#
# Re-extracts the Lichess board and piece artwork into public/vendor.
#
# A full clone of lila is several gigabytes and we need two directories, so this
# uses a blobless sparse checkout: it downloads only the files it checks out.
#
# Run with: npm run assets:lichess
set -euo pipefail

REPO="https://github.com/lichess-org/lila.git"
TMP=".tmp/lila"
BOARD_DEST="public/vendor/lichess/board"
PIECE_DEST="public/vendor/lichess/pieces/maestro"

rm -rf "$TMP"
mkdir -p "$(dirname "$TMP")"

git clone --filter=blob:none --no-checkout --depth 1 "$REPO" "$TMP"

git -C "$TMP" sparse-checkout init --cone
git -C "$TMP" sparse-checkout set public/images/board public/piece/maestro
git -C "$TMP" checkout

mkdir -p "$BOARD_DEST" "$PIECE_DEST"
cp "$TMP/public/images/board/brown.png" "$BOARD_DEST/brown.png"
cp "$TMP/public/piece/maestro/"*.svg "$PIECE_DEST/"

COMMIT="$(git -C "$TMP" rev-parse HEAD)"
rm -rf "$TMP"

echo
echo "Board:  $BOARD_DEST/brown.png"
echo "Pieces: $PIECE_DEST/ ($(ls -1 "$PIECE_DEST" | wc -l | tr -d ' ') files)"
echo
echo "Extracted from lichess-org/lila at commit:"
echo "  $COMMIT"
echo
echo "Update the commit hash and date in THIRD_PARTY_NOTICES.md."
