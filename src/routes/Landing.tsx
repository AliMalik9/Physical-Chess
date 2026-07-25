import {lazy, Suspense, useState} from "react";
import {Button, Separator} from "@heroui/react";

import {Board} from "@/components/board/Board";
import {AppLink} from "@/components/AppLink";
import {ThemeToggleButton} from "@/components/ThemeToggleButton";
import {Wordmark} from "@/components/Wordmark";
import {useBoardAssets} from "@/hooks/useBoardAssets";
import {navigate} from "@/router";

const StartGameModal = lazy(async () => ({
  default: (await import("@/components/StartGameModal")).StartGameModal,
}));

/**
 * A quiet mid-game position for the preview. Real enough to feel like a game in
 * progress rather than a stock starting position.
 */
const PREVIEW_FEN =
  "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";

const STEPS = [
  "Share the link.",
  "Make your move.",
  "Copy their move.",
];

export function Landing() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const {isReady} = useBoardAssets();

  return (
    <div className="app-frame flex flex-col bg-background text-foreground">
      <header className="safe-top flex shrink-0 items-center justify-between px-5 py-4 sm:px-8">
        <Wordmark />
        <div className="flex items-center gap-1">
          <AppLink href="/how-it-works" className="text-sm">
            How it works
          </AppLink>
          <ThemeToggleButton />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-10 overflow-y-auto px-5 pb-8 sm:px-8 lg:flex-row lg:gap-16 lg:overflow-hidden">
        <div className="flex w-full max-w-lg shrink-0 flex-col gap-7 lg:max-w-md">
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-5xl">
              Play together.
              <br />
              Keep the board real.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-pretty text-muted">
              Use your own chessboards. BoardLink simply passes each move
              between you.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:max-w-xs">
            <Button size="lg" onPress={() => setIsCreateOpen(true)}>
              Start a game
            </Button>
            <Button size="lg" variant="secondary" onPress={() => navigate("/join")}>
              Join with a code
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <Separator />
            <ol className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:gap-6">
              {STEPS.map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="tabular text-xs font-semibold text-accent">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* The board is the product, so it is on the page from the first screen. */}
        <div className="w-full max-w-[min(28rem,70vh)] shrink-0">
          {isReady ? (
            <Board
              fen={PREVIEW_FEN}
              orientation="white"
              movableColor={null}
              selectedSquare={null}
              legalTargets={[]}
              lastMove={{from: "f1", to: "c4"}}
              checkSquare={null}
              showCoordinates
              animateMoves={false}
              onSquareActivate={() => undefined}
              onDragMove={() => undefined}
            />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-lg bg-default" />
          )}
        </div>
      </main>

      {isCreateOpen ? (
        <Suspense fallback={null}>
          <StartGameModal isOpen onOpenChange={setIsCreateOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
