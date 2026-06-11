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
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import type {
  BlockMatch,
  PositionedBlock,
  VisibleBlocks,
} from "./lib/blockDecorations";

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\/+$/, "");
  })
  .catch(() => {});

type Props = {
  subscribe: (cb: () => void) => () => void;
  getVisible: () => VisibleBlocks;
  hoveredId: string | null;
  readOutput: (id: string) => string | null;
  searchBlock: (id: string, query: string) => BlockMatch[];
  revealMatch: (m: BlockMatch) => void;
  clearSearch: () => void;
  onHoverKeepAlive: () => void;
  onHoverEnd: () => void;
};

const EMPTY: VisibleBlocks = { blocks: [], sticky: null };

function fmtDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function relPath(p: string): string {
  if (cachedHome && (p === cachedHome || p.startsWith(`${cachedHome}/`))) {
    return `~${p.slice(cachedHome.length)}`;
  }
  return p;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {});
}

function attachBlock(
  block: PositionedBlock,
  readOutput: (id: string) => string | null,
) {
  const out = readOutput(block.id);
  const text = out ? `$ ${block.command}\n${out}` : `$ ${block.command}`;
  useChatStore.getState().attachSelection(text, "terminal");
}

function signature(v: VisibleBlocks): string {
  let s = v.sticky?.id ?? "";
  for (const b of v.blocks) {
    s += `|${b.id}:${Math.round(b.top)}:${Math.round(b.bottom)}:${b.running}`;
  }
  return s;
}

export function BlockOverlay(props: Props) {
  const { subscribe, getVisible } = props;
  const [vis, setVis] = useState<VisibleBlocks>(EMPTY);
  const [searchId, setSearchId] = useState<string | null>(null);
  const lastSig = useRef("");

  useEffect(() => {
    const update = () => {
      const v = getVisible();
      const sig = signature(v);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      setVis(v);
    };
    update();
    return subscribe(update);
  }, [subscribe, getVisible]);

  const closeSearch = () => {
    props.clearSearch();
    setSearchId(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {vis.blocks.map((b) => (
        <BlockChrome
          key={b.id}
          block={b}
          hovered={b.id === props.hoveredId}
          readOutput={props.readOutput}
          onSearch={setSearchId}
          onHoverKeepAlive={props.onHoverKeepAlive}
          onHoverEnd={props.onHoverEnd}
        />
      ))}
      {vis.sticky && (
        <StickyHeader
          block={vis.sticky}
          readOutput={props.readOutput}
          onSearch={setSearchId}
          onHoverKeepAlive={props.onHoverKeepAlive}
          onHoverEnd={props.onHoverEnd}
        />
      )}
      {searchId && (
        <SearchBar
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
  readOutput: (id: string) => string | null;
  onSearch: (id: string) => void;
  onHoverKeepAlive: () => void;
  onHoverEnd: () => void;
};

function BlockChrome({
  block,
  hovered,
  readOutput,
  onSearch,
  onHoverKeepAlive,
  onHoverEnd,
}: ChromeProps & { hovered: boolean }) {
  return (
    <>
      {!block.running && (
        <div
          className={cn("bt-divider", !block.ok && "bt-divider-fail")}
          style={{ top: block.bottom }}
        />
      )}
      <div
        className={cn("bt-bar", hovered && "bt-bar-active")}
        style={{ top: block.headerTop }}
      >
        <Meta block={block} />
        <Toolbar
          block={block}
          readOutput={readOutput}
          onSearch={() => onSearch(block.id)}
          onHoverKeepAlive={onHoverKeepAlive}
          onHoverEnd={onHoverEnd}
        />
      </div>
    </>
  );
}

function Meta({ block }: { block: PositionedBlock }) {
  return (
    <span className="bt-head-meta">
      {block.cwd && <span className="bt-cwd">{relPath(block.cwd)}</span>}
      <span className="bt-clock">
        <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={1.75} />
        {fmtTime(block.startedAt)}
      </span>
    </span>
  );
}

function StickyHeader({
  block,
  readOutput,
  onSearch,
  onHoverKeepAlive,
  onHoverEnd,
}: ChromeProps) {
  return (
    <div className="bt-sticky">
      <HugeiconsIcon
        className="bt-sticky-icon"
        icon={CommandLineIcon}
        size={12}
        strokeWidth={1.75}
      />
      <span className="bt-sticky-cmd">{block.command || "command"}</span>
      <Toolbar
        block={block}
        readOutput={readOutput}
        onSearch={() => onSearch(block.id)}
        onHoverKeepAlive={onHoverKeepAlive}
        onHoverEnd={onHoverEnd}
      />
    </div>
  );
}

function Toolbar({
  block,
  readOutput,
  onSearch,
  onHoverKeepAlive,
  onHoverEnd,
}: {
  block: PositionedBlock;
  readOutput: (id: string) => string | null;
  onSearch: () => void;
  onHoverKeepAlive: () => void;
  onHoverEnd: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover keep-alive
    <div
      className="bt-tools"
      onMouseEnter={onHoverKeepAlive}
      onMouseLeave={onHoverEnd}
    >
      <span className="bt-dur">
        {block.running ? (
          <LiveTimer startedAt={block.startedAt} />
        ) : (
          <Duration block={block} />
        )}
      </span>
      <IconButton
        title="Copy command"
        icon={Copy01Icon}
        onClick={() => copy(block.command)}
      />
      <IconButton
        title="Copy output"
        icon={ComputerTerminal02Icon}
        onClick={() => {
          const o = readOutput(block.id);
          if (o) copy(o);
        }}
      />
      <IconButton title="Search in block" icon={Search01Icon} onClick={onSearch} />
      <IconButton
        title="Add to AI chat"
        icon={SparklesIcon}
        onClick={() => attachBlock(block, readOutput)}
      />
    </div>
  );
}

// One fixed search bar pinned to the top of the terminal so it stays put while
// navigating matches (the grid scrolls underneath).
function SearchBar({
  blockId,
  searchBlock,
  revealMatch,
  onClose,
}: {
  blockId: string;
  searchBlock: (id: string, query: string) => BlockMatch[];
  revealMatch: (m: BlockMatch) => void;
  onClose: () => void;
}) {
  const [matches, setMatches] = useState<BlockMatch[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (query: string) => {
    const m = searchBlock(blockId, query);
    setMatches(m);
    setIdx(0);
    if (m.length) revealMatch(m[0]);
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
        {matches.length ? `${idx + 1}/${matches.length}` : "0"}
      </span>
      <IconButton title="Previous" icon={ArrowUp01Icon} onClick={() => nav(-1)} />
      <IconButton title="Next" icon={ArrowDown01Icon} onClick={() => nav(1)} />
      <IconButton title="Close" icon={Cancel01Icon} onClick={onClose} />
    </div>
  );
}

function Duration({ block }: { block: PositionedBlock }) {
  const d = fmtDuration(block.finishedAt - block.startedAt);
  return d ? <span>{d}</span> : null;
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{Math.floor((now - startedAt) / 1000)}s</span>;
}

function IconButton({
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
