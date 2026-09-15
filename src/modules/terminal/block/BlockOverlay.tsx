import { homeRelativePath } from "@/lib/homeRelativePath";
import "@/modules/terminal/block/block.css";

import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Clock01Icon,
  CommandLineIcon,
  ComputerTerminal02Icon,
  Copy01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import type {
  BlockMatch,
  PositionedBlock,
  VisibleBlocks,
} from "./lib/blockTypes";
import { capAttachOutput } from "./lib/outputCap";

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\\/g, "/").replace(/\/+$/, "");
  })
  .catch(() => {});

type Props = {
  subscribe: (cb: () => void) => () => void;
  getVisible: () => VisibleBlocks;
  readOutput: (id: string) => string | null;
  searchBlock: (
    id: string,
    query: string,
    signal: AbortSignal,
  ) => Promise<BlockMatch[]>;
  revealMatch: (m: BlockMatch) => void;
  clearSearch: () => void;
  promptReady: boolean;
  onRunAgain: (command: string) => void;
  onRestoreFocus: () => void;
};

const EMPTY: VisibleBlocks = { blocks: [], sticky: null, generation: 0 };

function fmtDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function copy(text: string, message: string) {
  void writeTerminalClipboard(text)
    .then(() => toast.success(message))
    .catch(() => {});
}

function sameBlock(
  a: PositionedBlock | null,
  b: PositionedBlock | null,
): boolean {
  if (a === b) return true;
  return (
    !!a &&
    !!b &&
    a.id === b.id &&
    a.command === b.command &&
    a.canRerun === b.canRerun &&
    a.cwd === b.cwd &&
    a.exitCode === b.exitCode &&
    a.running === b.running &&
    a.ok === b.ok &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.headerTop === b.headerTop
  );
}

function sameVisibleBlocks(a: VisibleBlocks, b: VisibleBlocks): boolean {
  if (
    a.generation !== b.generation ||
    !sameBlock(a.sticky, b.sticky) ||
    a.blocks.length !== b.blocks.length
  )
    return false;
  for (let index = 0; index < a.blocks.length; index++) {
    if (!sameBlock(a.blocks[index], b.blocks[index])) return false;
  }
  return true;
}

export function BlockOverlay(props: Props) {
  const { subscribe, getVisible } = props;
  const [vis, setVis] = useState<VisibleBlocks>(EMPTY);
  const [searchId, setSearchId] = useState<string | null>(null);
  const lastVisible = useRef(EMPTY);

  useEffect(() => {
    const update = (synchronous = false) => {
      const v = getVisible();
      if (sameVisibleBlocks(v, lastVisible.current)) return;
      const cleared = v.generation !== lastVisible.current.generation;
      lastVisible.current = v;
      const commit = () => {
        if (cleared) setSearchId(null);
        setVis(v);
      };
      if (synchronous) flushSync(commit);
      else commit();
    };
    update();
    return subscribe(() => update(true));
  }, [subscribe, getVisible]);

  const openSearch = (id: string) => {
    props.clearSearch();
    setSearchId(id);
  };
  const closeSearch = () => {
    props.clearSearch();
    setSearchId(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {vis.blocks.map((b) => (
        <BlockChrome key={b.id} block={b} all={props} onSearch={openSearch} />
      ))}
      {vis.sticky && (
        <StickyHeader block={vis.sticky} all={props} onSearch={openSearch} />
      )}
      {searchId && (
        <SearchBar
          key={searchId}
          clearSearch={props.clearSearch}
          blockId={searchId}
          searchBlock={props.searchBlock}
          revealMatch={props.revealMatch}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

type ChromeProps = {
  block: PositionedBlock;
  all: Props;
  onSearch: (id: string) => void;
};

// No chrome while the command runs; the bar lands together with the divider
// once the block is finished.
function BlockChrome({ block, all, onSearch }: ChromeProps) {
  if (block.running) return null;
  return (
    <>
      <div
        className={cn("bt-divider", !block.ok && "bt-divider-fail")}
        style={{ top: block.bottom }}
      />
      <div className="bt-bar" style={{ top: block.headerTop }}>
        <Meta block={block} />
        <Toolbar block={block} all={all} onSearch={onSearch} />
      </div>
    </>
  );
}

function Meta({ block }: { block: PositionedBlock }) {
  return (
    <span className="bt-head-meta">
      {block.cwd && (
        <span className="bt-cwd">
          {homeRelativePath(block.cwd, cachedHome)}
        </span>
      )}
      <span className="bt-clock">
        <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={1.75} />
        {fmtTime(block.startedAt)}
      </span>
    </span>
  );
}

function StickyHeader({ block, all, onSearch }: ChromeProps) {
  return (
    <div className="bt-sticky">
      <HugeiconsIcon
        className="bt-sticky-icon"
        icon={CommandLineIcon}
        size={12}
        strokeWidth={1.75}
      />
      <span className="bt-sticky-cmd">{block.command || "command"}</span>
      <Toolbar block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function Toolbar({ block, all, onSearch }: ChromeProps) {
  const duration = block.running
    ? null
    : fmtDuration(block.finishedAt - block.startedAt);
  const failed = !block.running && !block.ok && block.exitCode !== null;
  return (
    <div className="bt-tools">
      {failed && <span className="bt-exit">exit {block.exitCode}</span>}
      {duration && <span className="bt-dur">{duration}</span>}
      {!block.running && block.canRerun && (
        <button
          type="button"
          title="Run again"
          className="bt-btn"
          disabled={!all.promptReady}
          onClick={() => all.onRunAgain(block.command)}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12.5} strokeWidth={1.75} />
        </button>
      )}
      <BlockMenu block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function BlockMenu({ block, all, onSearch }: ChromeProps) {
  const output = () => all.readOutput(block.id) ?? "";
  const attach = () => {
    const out = capAttachOutput(output());
    const text = out ? `$ ${block.command}\n${out}` : `$ ${block.command}`;
    useChatStore.getState().attachSelection(text, "terminal");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Block actions" className="bt-btn">
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={14}
            strokeWidth={1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          all.onRestoreFocus();
        }}
      >
        <MenuItem
          icon={Refresh01Icon}
          label="Run again"
          disabled={block.running || !all.promptReady || !block.canRerun}
          onClick={() => all.onRunAgain(block.command)}
        />
        <MenuItem
          icon={Copy01Icon}
          label="Copy command"
          disabled={!block.command}
          onClick={() => copy(block.command, "Command copied")}
        />
        <MenuItem
          icon={ComputerTerminal02Icon}
          label="Copy output"
          onClick={() => {
            const o = output();
            if (o) copy(o, "Output copied");
          }}
        />
        <MenuItem
          icon={Copy01Icon}
          label="Copy command and output"
          onClick={() => {
            const text = `$ ${block.command}\n${output()}`;
            copy(text, "Block copied");
          }}
        />
        <MenuItem
          icon={SparklesIcon}
          label="Attach to AI chat"
          onClick={attach}
        />
        <MenuItem
          icon={Search01Icon}
          label="Find in block"
          onClick={() => onSearch(block.id)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Copy01Icon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onClick}
      className="gap-2 text-xs"
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
      {label}
    </DropdownMenuItem>
  );
}

// One fixed search bar pinned to the top of the terminal so it stays put while
// navigating matches (the grid scrolls underneath).
function SearchBar({
  clearSearch,
  blockId,
  searchBlock,
  revealMatch,
  onClose,
}: {
  clearSearch: () => void;
  blockId: string;
  searchBlock: (
    id: string,
    query: string,
    signal: AbortSignal,
  ) => Promise<BlockMatch[]>;
  revealMatch: (m: BlockMatch) => void;
  onClose: () => void;
}) {
  const [matches, setMatches] = useState<BlockMatch[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => () => searchRef.current?.abort(), []);
  const run = (query: string) => {
    searchRef.current?.abort();
    clearSearch();
    const controller = new AbortController();
    searchRef.current = controller;
    setMatches([]);
    setIdx(0);
    setPending(!!query);
    void searchBlock(blockId, query, controller.signal).then(
      (m) => {
        if (controller.signal.aborted) return;
        setPending(false);
        setMatches(m);
        if (m.length) revealMatch(m[0]);
      },
      () => {
        if (controller.signal.aborted) return;
        setPending(false);
        toast.error("Could not search this block");
      },
    );
  };
  const nav = (dir: number) => {
    if (!matches.length) return;
    const next = (idx + dir + matches.length) % matches.length;
    setIdx(next);
    revealMatch(matches[next]);
  };

  return (
    <div className="bt-search pointer-events-auto">
      <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={1.75} />
      <input
        ref={inputRef}
        className="bt-search-input"
        placeholder="Find in block"
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nav(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="bt-search-count">
        {pending
          ? "Searching"
          : matches.length
            ? `${idx + 1}/${matches.length}`
            : "0"}
      </span>
      <SearchBtn
        title="Previous"
        icon={ArrowUp01Icon}
        onClick={() => nav(-1)}
      />
      <SearchBtn title="Next" icon={ArrowDown01Icon} onClick={() => nav(1)} />
      <SearchBtn title="Close" icon={Cancel01Icon} onClick={onClose} />
    </div>
  );
}

function SearchBtn({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: typeof Copy01Icon;
  onClick: () => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick} className="bt-btn">
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}
