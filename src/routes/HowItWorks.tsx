import {Button, Separator} from "@heroui/react";

import {PageShell} from "@/components/PageShell";
import {navigate} from "@/router";

const STEPS = [
  {
    title: "Set up your own board",
    body: "You and your friend each need a real chessboard, set up as usual.",
  },
  {
    title: "Send the link",
    body: "Start a game and share the link. Your friend opens it and you are connected.",
  },
  {
    title: "Move a piece, then tell BoardLink",
    body: "Move on your real board first. Then tap the piece and the square you moved it to.",
  },
  {
    title: "Check the move, then send it",
    body: "BoardLink shows you what it is about to send. If it is wrong, change it.",
  },
  {
    title: "Your friend copies the move",
    body: "They see it in plain words, move the piece, and press Done.",
  },
  {
    title: "Now it is their turn",
    body: "And it carries on, just like sitting across a table.",
  },
];

export function HowItWorks() {
  return (
    <PageShell maxWidth="34rem">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          How BoardLink works
        </h1>
        <p className="text-pretty text-muted">
          BoardLink is not a chess website. It is a messenger between two real
          chessboards.
        </p>
      </div>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            {index > 0 ? <Separator /> : null}
            <div className="flex gap-4 py-4">
              <span className="tabular mt-0.5 text-sm font-semibold text-accent">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="font-medium">{step.title}</h2>
                <p className="text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
        <p>
          If your boards stop matching, open the menu and choose “Boards don’t
          match”. BoardLink shows the real position and helps you fix it.
        </p>
        <p>
          Sent a move by mistake? Ask for a take-back. Your friend has to agree,
          then you both put the piece back.
        </p>
        <p>
          There are no accounts. Anyone with the link can take the empty seat, so
          share it only with the person you want to play.
        </p>
      </div>

      <Button size="lg" onPress={() => navigate("/")}>
        Start a game
      </Button>
    </PageShell>
  );
}
