import { useEffect, useRef, useState } from "react";

export type ContextMenuItem = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  action: () => void;
};

export type ContextMenuSection = {
  items: ContextMenuItem[];
};

export function useContextMenu() {
  const [state, setState] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const show = (x: number, y: number, items: ContextMenuItem[]) => {
    setState({ x, y, items });
  };

  const hide = () => setState(null);

  return { state, show, hide };
}

export function ContextMenuOverlay({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: ContextMenuItem[] } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="workflow-context-menu fixed z-50 min-w-[180px] rounded-lg border border-border/60 bg-card/95 py-1 shadow-xl backdrop-blur"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent flex items-center justify-between gap-4 ${
            item.danger ? "text-destructive" : ""
          } ${item.disabled ? "opacity-50 pointer-events-none" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            item.action();
            onClose();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="text-muted-foreground text-[10px]">
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
