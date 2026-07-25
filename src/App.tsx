import {lazy, Suspense} from "react";
import {Spinner} from "@heroui/react";

import {Landing} from "@/routes/Landing";
import {useRoute} from "@/router";

/**
 * Only the landing screen is in the first bundle. The room pulls in chess.js
 * and the full game surface, and /join pulls in form controls — none of which
 * the first paint needs.
 */
const Join = lazy(async () => ({default: (await import("@/routes/Join")).Join}));
const HowItWorks = lazy(async () => ({
  default: (await import("@/routes/HowItWorks")).HowItWorks,
}));
const NotFound = lazy(async () => ({
  default: (await import("@/routes/NotFound")).NotFound,
}));
const Room = lazy(async () => ({default: (await import("@/routes/Room")).Room}));

function RouteFallback() {
  return (
    <div className="app-frame flex items-center justify-center bg-background">
      <Spinner aria-label="Loading" />
    </div>
  );
}

export function App() {
  const route = useRoute();

  if (route.name === "landing") return <Landing />;

  return (
    <Suspense fallback={<RouteFallback />}>
      {route.name === "join" ? (
        <Join />
      ) : route.name === "how-it-works" ? (
        <HowItWorks />
      ) : route.name === "room" ? (
        <Room code={route.code} />
      ) : (
        <NotFound />
      )}
    </Suspense>
  );
}
