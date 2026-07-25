import {useLayoutEffect, useRef, useState, type ReactNode} from "react";

/**
 * Sizes the board to the largest square that fits, and pins the player strips
 * to exactly that width.
 *
 * This is measured rather than done with breakpoints because the constraint is
 * whatever is actually left over — which depends on the strips, the browser
 * chrome and the safe-area inset, none of which a media query knows about.
 */
export function BoardFrame({
  top,
  bottom,
  children,
  maxSize = 900,
}: {
  top?: ReactNode;
  bottom?: ReactNode;
  children: ReactNode;
  maxSize?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const box = container.getBoundingClientRect();
      const chrome =
        (topRef.current?.offsetHeight ?? 0) +
        (bottomRef.current?.offsetHeight ?? 0);

      const available = Math.min(box.width, box.height - chrome);
      setSize(Math.max(0, Math.min(available, maxSize)));
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (topRef.current) observer.observe(topRef.current);
    if (bottomRef.current) observer.observe(bottomRef.current);

    return () => observer.disconnect();
  }, [maxSize]);

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 w-full flex-1 flex-col items-center justify-center"
    >
      <div ref={topRef} className="w-full" style={{maxWidth: size || undefined}}>
        {top}
      </div>

      {/* Fixed pixel box: the board can never be squeezed out of square. */}
      <div
        className="shrink-0"
        style={{width: size || undefined, height: size || undefined}}
      >
        {size > 0 ? children : null}
      </div>

      <div
        ref={bottomRef}
        className="w-full"
        style={{maxWidth: size || undefined}}
      >
        {bottom}
      </div>
    </div>
  );
}
