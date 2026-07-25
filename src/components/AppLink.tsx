import type {ReactNode} from "react";
import {Link} from "@heroui/react";

import {isPlainClick, navigate} from "@/router";

/**
 * A real anchor that routes client-side, so middle-click and "open in new tab"
 * keep working while a plain click stays on the page.
 */
export function AppLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
}
