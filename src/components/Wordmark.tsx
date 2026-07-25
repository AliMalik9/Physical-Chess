/**
 * The two-boards-one-link mark. Inline so it inherits colour from the theme and
 * scales with type instead of shipping a raster.
 */
export function Wordmark({showText = true}: {showText?: boolean}) {
  return (
    <span className="flex items-center gap-2 text-foreground">
      <svg
        width="24"
        height="17"
        viewBox="0 0 32 22"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <rect
          x="1"
          y="4"
          width="12"
          height="12"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.7"
        />
        <rect
          x="19"
          y="7"
          width="12"
          height="12"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.7"
        />
        <path
          d="M13.5 9h4"
          stroke="var(--accent)"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
      {showText ? (
        <span className="text-[0.95rem] font-semibold tracking-tight">
          BoardLink
        </span>
      ) : null}
    </span>
  );
}
