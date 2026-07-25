import type {RoomSnapshot} from "@shared/protocol";

/**
 * Move list, parsed from the authoritative PGN so it can never disagree with
 * the server about what was played.
 *
 * Notation only, two columns, latest highlighted. No evaluation, no engine
 * lines, no opening names — this product has an opinion about that.
 */
function movesFromPgn(pgn: string): string[] {
  // Strip headers, comments, result markers and move numbers.
  const body = pgn
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\b\d+\.(\.\.)?/g, " ")
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/g, " ");

  return body.split(/\s+/).filter(Boolean);
}

export function MoveHistory({snapshot}: {snapshot: RoomSnapshot}) {
  const moves = movesFromPgn(snapshot.pgn);

  if (moves.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No moves yet. The game starts when White moves.
      </p>
    );
  }

  const pairs: Array<[string, string | undefined]> = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push([moves[i]!, moves[i + 1]]);
  }

  return (
    <ol className="flex max-h-[50dvh] flex-col overflow-y-auto text-sm">
      {pairs.map(([white, black], index) => {
        const whiteIndex = index * 2;
        return (
          <li
            key={index}
            className="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-2 rounded-md px-1.5 py-1 odd:bg-default/40"
          >
            <span className="tabular text-xs text-muted">{index + 1}.</span>
            <MoveCell san={white} isLatest={whiteIndex === moves.length - 1} />
            {black ? (
              <MoveCell san={black} isLatest={whiteIndex + 1 === moves.length - 1} />
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MoveCell({san, isLatest}: {san: string; isLatest: boolean}) {
  return (
    <span
      className={`tabular rounded px-1.5 py-0.5 ${
        isLatest ? "bg-accent text-accent-foreground font-medium" : ""
      }`}
      aria-current={isLatest ? "true" : undefined}
    >
      {san}
    </span>
  );
}
