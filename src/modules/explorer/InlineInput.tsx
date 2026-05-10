import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
};

/**
 * Self-focusing single-line input for rename / create flows in the tree.
 * Enter commits, Escape cancels, blur commits (matches VSCode behavior —
 * dismissing the input is an implicit commit so a typed name isn't lost).
 */
export function InlineInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Two-tick focus to win against parent click handlers and Radix portal
    // restorations that can steal focus right after mount. Until the second
    // tick lands we treat the input as "unsettled" — any blur during that
    // window is the portal teardown stealing focus, not the user dismissing
    // the input, so we refocus instead of committing an empty value.
    const focus = () => {
      el.focus({ preventScroll: false });
      const dot = initial.lastIndexOf(".");
      if (dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    };
    focus();
    const raf = requestAnimationFrame(() => focus());
    const timer = setTimeout(() => {
      focus();
      settledRef.current = true;
    }, 170);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [initial]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        if (!settledRef.current) {
          ref.current?.focus({ preventScroll: true });
          return;
        }
        commit();
      }}
      className="min-w-0 flex-1 truncate rounded-sm border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none ring-0 focus:border-ring"
    />
  );
}