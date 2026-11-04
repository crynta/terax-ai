import { isExternalUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import {
  openTerminalLink,
  resolveTerminalFileLink,
  type TerminalLinkHoverEvent,
} from "@/modules/terminal/lib/terminalFileLinks";
import {
  Copy01Icon,
  FolderOpenIcon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chipPlacement, LINK_CHIP_HEIGHT } from "./linkChipPlacement";

/** Hover this long before the chip appears, so passing over a link doesn't flash it. */
const SHOW_DELAY_MS = 300;
/** Grace period to move the pointer from the link onto the chip. */
const HIDE_DELAY_MS = 150;

export default function TerminalLinkChip({
  hover,
}: {
  hover: TerminalLinkHoverEvent | null;
}) {
  const [shown, setShown] = useState<TerminalLinkHoverEvent | null>(null);
  const [copied, setCopied] = useState(false);
  const overChip = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read, not followed: only a new hover reschedules the chip.
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const current = shownRef.current;
    if (hover) {
      if (current?.uri === hover.uri && current.leafId === hover.leafId) {
        setShown(hover);
        return;
      }
      // Moving from one link to the next keeps the chip up; a first hover waits.
      timer.current = setTimeout(
        () => {
          setShown(hover);
          setCopied(false);
        },
        current ? 0 : SHOW_DELAY_MS,
      );
    } else {
      timer.current = setTimeout(() => {
        if (!overChip.current) setShown(null);
      }, HIDE_DELAY_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hover]);

  if (!shown) return null;

  const external = isExternalUrl(shown.uri);
  const file = external ? null : resolveTerminalFileLink(shown.uri, shown.cwd);
  const copyText = file ? file.path : shown.uri;
  const place = chipPlacement(shown.rect, window.innerWidth);
  const dismiss = () => {
    overChip.current = false;
    setShown(null);
  };

  return createPortal(
    <div
      role="toolbar"
      aria-label={external ? "Link actions" : "File actions"}
      onMouseEnter={() => {
        overChip.current = true;
        if (timer.current) clearTimeout(timer.current);
      }}
      onMouseLeave={() => {
        overChip.current = false;
        timer.current = setTimeout(() => setShown(null), HIDE_DELAY_MS);
      }}
      style={{ left: place.left, top: place.top, height: LINK_CHIP_HEIGHT }}
      className="terax-panel-in fixed z-50 flex items-center gap-0.5 rounded-lg border border-border/70 bg-popover px-1 text-popover-foreground shadow-lg"
    >
      <span className="max-w-[260px] truncate px-1.5 font-mono text-[11px] text-muted-foreground">
        {file ? file.path.split("/").pop() : shown.uri}
        {file?.line ? `:${file.line}` : ""}
      </span>
      <ChipButton
        icon={LinkSquare02Icon}
        label={external ? "Open" : "Open in editor"}
        onClick={() => {
          void openTerminalLink(shown.uri, shown.cwd);
          dismiss();
        }}
      />
      {file && (
        <ChipButton
          icon={FolderOpenIcon}
          label="Reveal"
          onClick={() => {
            void revealInFinder(file.path);
            dismiss();
          }}
        />
      )}
      <ChipButton
        icon={Copy01Icon}
        label={copied ? "Copied" : file ? "Copy path" : "Copy link"}
        active={copied}
        onClick={() => {
          void copyToClipboard(copyText).then(() => setCopied(true));
        }}
      />
    </div>,
    document.body,
  );
}

function ChipButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "text-agent-done" : "text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.9} />
      {label}
    </button>
  );
}
