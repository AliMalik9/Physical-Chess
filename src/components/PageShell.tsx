import type {ReactNode} from "react";

import {AppLink} from "@/components/AppLink";
import {ThemeToggleButton} from "@/components/ThemeToggleButton";
import {Wordmark} from "@/components/Wordmark";

/**
 * The frame for the small, non-game screens.
 *
 * A single centred column with the same compact header as everywhere else, so
 * moving between the landing screen and a room never feels like a different
 * product.
 */
export function PageShell({
  children,
  maxWidth = "32rem",
}: {
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="app-frame flex flex-col bg-background text-foreground">
      <header className="safe-top flex shrink-0 items-center justify-between px-5 py-4 sm:px-8">
        <AppLink href="/" className="no-underline">
          <Wordmark />
        </AppLink>
        <ThemeToggleButton />
      </header>

      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-10 sm:px-8">
        <div className="flex w-full flex-col justify-center gap-8" style={{maxWidth}}>
          {children}
        </div>
      </main>
    </div>
  );
}
