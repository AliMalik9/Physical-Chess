import {useCallback, useSyncExternalStore, type ReactNode} from "react";

/**
 * A four-route History API router.
 *
 * A routing library would be more code than the whole feature: there are no
 * nested routes, no loaders and no route params beyond a room code. Keeping it
 * here keeps the first paint small, which matters because the landing screen is
 * often opened on a phone over mobile data.
 */

export type Route =
  | {name: "landing"}
  | {name: "join"}
  | {name: "room"; code: string}
  | {name: "how-it-works"}
  | {name: "not-found"};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return {name: "landing"};
  if (segments.length === 1 && segments[0] === "join") return {name: "join"};
  if (segments.length === 1 && segments[0] === "how-it-works") {
    return {name: "how-it-works"};
  }
  if (segments.length === 2 && segments[0] === "room" && segments[1]) {
    return {name: "room", code: decodeURIComponent(segments[1])};
  }
  return {name: "not-found"};
}

export function useRoute(): Route {
  const href = useSyncExternalStore(subscribe, currentHref, () => "/");
  return parseRoute(new URL(href, "http://x").pathname);
}

/** Reads the invite secret, which travels in the fragment so it is never sent
 * to the server as part of a URL and never lands in a referrer or a log. */
export function useInviteSecret(): string | null {
  const href = useSyncExternalStore(subscribe, currentHref, () => "/");
  const hash = new URL(href, "http://x").hash.replace(/^#/, "");
  return hash.length > 0 ? decodeURIComponent(hash) : null;
}

/**
 * True when a click should be handled in-app. Modified clicks and non-primary
 * buttons belong to the browser so "open in new tab" keeps working.
 */
export function isPlainClick(event: React.MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function navigate(
  to: string,
  options: {replace?: boolean} = {},
): void {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  notify();
}

/**
 * An anchor that routes client-side. Modified clicks and non-primary buttons
 * fall through to the browser so "open in new tab" keeps working.
 */
export function RouteLink({
  href,
  children,
  className,
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      navigate(href);
      onNavigate?.();
    },
    [href, onNavigate],
  );

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
