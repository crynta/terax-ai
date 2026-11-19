import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

type Props = {
  /** A new key releases the pin (another task, the composer opened or closed). */
  resetKey: string;
  className?: string;
  children: ReactNode;
};

/**
 * Keeps the tallest height its content reached since `resetKey` last changed,
 * so content that shrinks when focus moves (a block terminal's input giving
 * way to a plain one) does not resize, and so refit, the terminals above.
 */
export function PinnedHeight({ resetKey, className, children }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState({ key: resetKey, height: 0 });
  const height = pinned.key === resetKey ? pinned.height : 0;

  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.borderBoxSize?.[0]?.blockSize ?? 0;
      setPinned((prev) =>
        prev.key === resetKey && prev.height >= next
          ? prev
          : {
              key: resetKey,
              height:
                prev.key === resetKey ? Math.max(prev.height, next) : next,
            },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resetKey]);

  return (
    <div className={className} style={{ minHeight: height }}>
      <div ref={content}>{children}</div>
    </div>
  );
}
