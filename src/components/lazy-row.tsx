import type { CSSProperties, ReactNode } from "react";

/**
 * Native, scroll-safe list virtualization for long transcripts.
 *
 * `content-visibility: auto` lets the browser skip layout and paint for rows
 * outside the viewport while keeping them in the DOM, so the scroll container's
 * height stays correct and any scroll-anchoring library wrapping the list (here
 * `use-stick-to-bottom`) is undisturbed. `contain-intrinsic-size: auto <h>`
 * supplies a placeholder height for off-screen rows and remembers each row's
 * real size after its first render, so scrolling back through history does not
 * jump. Unsupported WebViews simply ignore the properties and render normally.
 *
 * Do NOT wrap the actively streaming/last row in this: it is on-screen anyway,
 * and excluding it avoids a needless containment recalculation on every token.
 */
const LAZY_ROW_STYLE: CSSProperties = {
  contentVisibility: "auto",
  // `auto` = remember last rendered height; the value is the first-paint guess.
  containIntrinsicSize: "auto 64px",
};

export function LazyRow({
  children,
  className,
  eager = false,
}: {
  children: ReactNode;
  className?: string;
  /** Render normally (no content-visibility) — use for the on-screen, actively streaming row. */
  eager?: boolean;
}) {
  return (
    <div className={className} style={eager ? undefined : LAZY_ROW_STYLE}>
      {children}
    </div>
  );
}
