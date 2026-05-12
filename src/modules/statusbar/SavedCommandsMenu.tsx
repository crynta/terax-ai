import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SavedTerminalCommand } from "@/modules/terminal/lib/savedCommands";
import {
  ArrowDown01Icon,
  ComputerTerminal01Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { flushSync } from "react-dom";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from "react";

const SCROLLBAR_CLASS =
  "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80";
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 640;
const PANEL_MIN_HEIGHT = 320;
const PANEL_MAX_HEIGHT = 720;
const PINNED_MIN_HEIGHT = 72;
const PINNED_MAX_HEIGHT = 520;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function maxPanelWidth() {
  return Math.max(
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, window.innerWidth - 24),
  );
}

function maxPanelHeight() {
  return Math.max(
    PANEL_MIN_HEIGHT,
    Math.min(PANEL_MAX_HEIGHT, window.innerHeight - 72),
  );
}

function maxPinnedHeight(panelHeight: number) {
  return Math.min(
    PINNED_MAX_HEIGHT,
    Math.max(PINNED_MIN_HEIGHT, panelHeight - 190),
  );
}

function resolvedMaxPx(
  element: HTMLElement,
  property: "maxHeight" | "maxWidth",
  fallback: number,
) {
  const value = Number.parseFloat(getComputedStyle(element)[property]);
  return Number.isFinite(value) ? value : fallback;
}

type Props = {
  commands: SavedTerminalCommand[];
  onPick: (command: SavedTerminalCommand) => void;
  onTogglePin: (command: SavedTerminalCommand) => void;
  onManage: () => void;
};

export function SavedCommandsMenu({
  commands,
  onPick,
  onTogglePin,
  onManage,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [allOpen, setAllOpen] = useState(true);
  const [panelSize, setPanelSize] = useState({
    width: PANEL_MIN_WIDTH,
    height: 560,
  });
  const [pinnedBodyHeight, setPinnedBodyHeight] = useState(128);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...commands].sort((a, b) => {
      const pinnedDelta = Number(!!b.pinned) - Number(!!a.pinned);
      if (pinnedDelta !== 0) return pinnedDelta;
      return a.name.localeCompare(b.name);
    });
    if (!q) return list;
    return list.filter((command) =>
      [command.name, command.command, command.description]
        .join("\n")
        .toLowerCase()
        .includes(q),
    );
  }, [commands, query]);

  const pinned = filtered.filter((command) => command.pinned);
  const unpinned = filtered.filter((command) => !command.pinned);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const pickCommand = (command: SavedTerminalCommand) => {
    setOpen(false);
    window.setTimeout(() => onPick(command), 20);
  };

  const pinnedBodyMaxHeight = clamp(
    pinnedBodyHeight,
    PINNED_MIN_HEIGHT,
    maxPinnedHeight(panelSize.height),
  );

  const startPanelResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    axis: "width" | "height" | "both",
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const content = target.closest<HTMLElement>(
      "[data-slot='dropdown-menu-content']",
    );
    if (!content) return;

    const rect = content.getBoundingClientRect();
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail if the pointer already ended.
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const maxWidth = Math.min(
      maxPanelWidth(),
      resolvedMaxPx(content, "maxWidth", maxPanelWidth()),
    );
    const maxHeight = Math.min(
      maxPanelHeight(),
      resolvedMaxPx(content, "maxHeight", maxPanelHeight()),
    );
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let nextWidth = startWidth;
    let nextHeight = startHeight;
    let frame = 0;

    document.body.style.cursor =
      axis === "both"
        ? "nwse-resize"
        : axis === "width"
          ? "col-resize"
          : "row-resize";
    document.body.style.userSelect = "none";

    const applySize = () => {
      frame = 0;
      if (axis !== "height") content.style.width = `${nextWidth}px`;
      if (axis !== "width") content.style.height = `${nextHeight}px`;
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (axis !== "height") {
        nextWidth = clamp(
          startWidth + startX - moveEvent.clientX,
          PANEL_MIN_WIDTH,
          maxWidth,
        );
      }
      if (axis !== "width") {
        nextHeight = clamp(
          startHeight + startY - moveEvent.clientY,
          PANEL_MIN_HEIGHT,
          maxHeight,
        );
      }
      if (!frame) frame = window.requestAnimationFrame(applySize);
    };

    const stopResize = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        applySize();
      }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setPanelSize({ width: nextWidth, height: nextHeight });
      setPinnedBodyHeight((current) =>
        clamp(current, PINNED_MIN_HEIGHT, maxPinnedHeight(nextHeight)),
      );
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // The browser releases capture automatically on pointerup.
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
  };

  const startSectionResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!pinnedOpen || !allOpen) {
      flushSync(() => {
        if (!pinnedOpen) setPinnedOpen(true);
        if (!allOpen) setAllOpen(true);
      });
    }

    const target = event.currentTarget;
    const content = target.closest<HTMLElement>(
      "[data-slot='dropdown-menu-content']",
    );
    const body = content?.querySelector<HTMLElement>(
      "[data-command-group-body='pinned']",
    );
    if (!content || !body) return;

    const contentRect = content.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail if the pointer already ended.
    }

    const startY = event.clientY;
    const startHeight = bodyRect.height;
    const maxHeight = maxPinnedHeight(contentRect.height);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let nextHeight = startHeight;
    let frame = 0;

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const applySize = () => {
      frame = 0;
      body.style.height = `${nextHeight}px`;
    };

    const onMove = (moveEvent: PointerEvent) => {
      nextHeight = clamp(
        startHeight + moveEvent.clientY - startY,
        PINNED_MIN_HEIGHT,
        maxHeight,
      );
      if (!frame) frame = window.requestAnimationFrame(applySize);
    };

    const stopResize = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        applySize();
      }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setPinnedBodyHeight(nextHeight);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // The browser releases capture automatically on pointerup.
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Saved terminal commands"
          className="flex h-6 max-w-36 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ComputerTerminal01Icon}
            size={12}
            strokeWidth={1.75}
            className="shrink-0"
          />
          <span className="truncate">Commands</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="shrink-0 opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="relative flex min-w-80 flex-col overflow-hidden"
        style={{
          width: panelSize.width,
          height: panelSize.height,
          maxWidth: `min(${PANEL_MAX_WIDTH}px, calc(100vw - 24px))`,
          maxHeight: `min(${PANEL_MAX_HEIGHT}px, calc(100vh - 72px), var(--radix-dropdown-menu-content-available-height))`,
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PanelResizeHandle
          title="Resize command panel height"
          className="top-0 left-8 right-8 h-3 cursor-row-resize"
          grip="horizontal"
          onPointerDown={(e) => startPanelResize(e, "height")}
        />
        <PanelResizeHandle
          title="Resize command panel width"
          className="top-8 bottom-12 left-0 w-3 cursor-col-resize"
          grip="vertical"
          onPointerDown={(e) => startPanelResize(e, "width")}
        />
        <PanelResizeHandle
          title="Resize command panel"
          className="top-0 left-0 size-5 cursor-nwse-resize rounded-tl-3xl"
          onPointerDown={(e) => startPanelResize(e, "both")}
        />
        <div className="shrink-0">
          <DropdownMenuLabel className="py-1.5 text-[10px]">
            Terminal commands
          </DropdownMenuLabel>
          <div className="relative mb-1 px-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={12}
              strokeWidth={1.75}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search commands"
              className="h-7 rounded-lg bg-card/60 pl-7 text-[11px]"
            />
          </div>
        </div>

        {commands.length === 0 ? (
          <DropdownMenuItem
            className="text-[12px] text-muted-foreground"
            onSelect={onManage}
          >
            No saved commands
          </DropdownMenuItem>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No commands match.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <CommandGroup
              label="Pinned"
              emptyLabel={
                query.trim()
                  ? "No pinned commands match."
                  : "No pinned commands yet."
              }
              commands={pinned}
              open={pinnedOpen}
              onOpenChange={setPinnedOpen}
              onPick={pickCommand}
              onTogglePin={onTogglePin}
              sectionClassName="shrink-0"
              bodyClassName={cn("overflow-y-auto pr-0.5", SCROLLBAR_CLASS)}
              bodyKey="pinned"
              bodyStyle={{ height: pinnedBodyMaxHeight }}
            />
            <SectionResizeHandle onPointerDown={startSectionResize} />
            <CommandGroup
              label="All commands"
              emptyLabel={
                query.trim()
                  ? "No other commands match."
                  : "No other saved commands."
              }
              commands={unpinned}
              open={allOpen}
              onOpenChange={setAllOpen}
              onPick={pickCommand}
              onTogglePin={onTogglePin}
              sectionClassName="min-h-0 flex-1"
              bodyClassName={cn(
                "min-h-0 flex-1 overflow-y-scroll pr-0.5",
                SCROLLBAR_CLASS,
              )}
            />
          </div>
        )}

        <div className="shrink-0">
          <div className="-mx-1.5 my-1.5 h-px bg-border/50" />
          <DropdownMenuItem
            className="text-[12px]"
            onSelect={() => {
              setOpen(false);
              onManage();
            }}
          >
            <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} />
            Manage commands
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PanelResizeHandle({
  title,
  className,
  grip,
  onPointerDown,
}: {
  title: string;
  className: string;
  grip?: "vertical" | "horizontal";
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      title={title}
      className={cn(
        "group absolute z-10 touch-none transition-colors hover:bg-border/25",
        className,
      )}
      onPointerDown={onPointerDown}
    >
      {grip === "vertical" ? (
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/80 transition-colors group-hover:bg-foreground/35" />
      ) : null}
      {grip === "horizontal" ? (
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70 transition-colors group-hover:bg-foreground/35" />
      ) : null}
    </div>
  );
}

function SectionResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      title="Resize command sections"
      className="group relative -mx-1.5 my-1 flex h-3 shrink-0 cursor-row-resize touch-none items-center px-1.5"
      onPointerDown={onPointerDown}
    >
      <span className="h-px flex-1 bg-border/50 transition-colors group-hover:bg-border" />
      <span
        className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70 transition-colors group-hover:bg-foreground/35"
      />
    </div>
  );
}

function CommandGroup({
  label,
  emptyLabel,
  commands,
  open,
  onOpenChange,
  onPick,
  onTogglePin,
  sectionClassName,
  bodyClassName,
  bodyKey,
  bodyStyle,
}: {
  label: string;
  emptyLabel: string;
  commands: SavedTerminalCommand[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (command: SavedTerminalCommand) => void;
  onTogglePin: (command: SavedTerminalCommand) => void;
  sectionClassName?: string;
  bodyClassName?: string;
  bodyKey?: string;
  bodyStyle?: CSSProperties;
}) {
  return (
    <section className={cn("flex flex-col gap-0.5", sectionClassName)}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[9.5px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={11}
          strokeWidth={2}
          className={cn("transition-transform", !open && "-rotate-90")}
        />
        <span>{label}</span>
        <span className="ml-auto rounded bg-muted/50 px-1.5 py-0.5 text-[9px] tabular-nums">
          {commands.length}
        </span>
      </button>

      {open ? (
        <div
          className={cn("flex flex-col gap-0.5", bodyClassName)}
          data-command-group-body={bodyKey}
          style={bodyStyle}
        >
          {commands.length > 0 ? (
            commands.map((command) => (
              <CommandRow
                key={command.id}
                command={command}
                onPick={onPick}
                onTogglePin={onTogglePin}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              {emptyLabel}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CommandRow({
  command,
  onPick,
  onTogglePin,
}: {
  command: SavedTerminalCommand;
  onPick: (command: SavedTerminalCommand) => void;
  onTogglePin: (command: SavedTerminalCommand) => void;
}) {
  return (
    <div className="group flex items-start gap-1 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-within:bg-accent">
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left outline-none"
        onClick={() => onPick(command)}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 truncate text-[12px] font-medium">
          {command.pinned ? (
            <HugeiconsIcon
              icon={PinIcon}
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-muted-foreground"
            />
          ) : null}
          <span className="truncate">{command.name}</span>
        </span>
        <code className="w-full max-w-full truncate font-mono text-[10.5px] text-muted-foreground">
          {command.command}
        </code>
        {command.description ? (
          <span className="w-full max-w-full truncate text-[10.5px] text-muted-foreground">
            {command.description}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTogglePin(command);
        }}
        title={command.pinned ? "Unpin command" : "Pin command"}
        aria-label={command.pinned ? "Unpin command" : "Pin command"}
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-60 transition hover:bg-background/60 hover:text-foreground hover:opacity-100 focus:opacity-100 focus:outline-none",
          command.pinned && "opacity-100 text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={command.pinned ? PinOffIcon : PinIcon}
          size={12}
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}
