import {Button} from "@heroui/react";

import {PageShell} from "@/components/PageShell";
import {navigate} from "@/router";

export function NotFound() {
  return (
    <PageShell maxWidth="26rem">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          There is nothing here
        </h1>
        <p className="text-muted">
          That address does not lead anywhere. Start a game instead.
        </p>
      </div>
      <Button size="lg" onPress={() => navigate("/")}>
        Start a game
      </Button>
    </PageShell>
  );
}
