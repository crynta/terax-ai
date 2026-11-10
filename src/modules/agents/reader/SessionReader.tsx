import { CodeBlockExtrasProvider } from "@/components/ai-elements/chat-code";
import {
  LinkifiedText,
  MarkdownLinkProvider,
} from "@/components/ai-elements/markdown-link";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import { basename } from "@/modules/agents/lib/sessionRows";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import {
  type AgentPhase,
  useAgentActivityStore,
} from "@/modules/terminal/lib/agentActivity";
import { openTerminalLink } from "@/modules/terminal/lib/terminalFileLinks";
import {
  leafCwd,
  ptyIdForLeaf,
} from "@/modules/terminal/lib/terminalSessionApi";
import {
  AiChat02Icon,
  ArrowDown02Icon,
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  ComputerTerminal01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./reader.css";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { leafScreenText } from "@/modules/terminal/lib/terminalSessionApi";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { downloadDir, join } from "@tauri-apps/api/path";
import { selectionToQuote } from "./lib/askSelection";
import { type ChangedFile, changedFiles, reviewPrompt } from "./lib/changes";
import { compactBanner, compactCommand } from "./lib/contextBanner";
import { resumeChat } from "./lib/conversation";
import { documentMarkdown, exportFileName } from "./lib/exportMarkdown";
import { inFlightCall, turnSteps } from "./lib/liveStream";
import { pendingToolCall } from "./lib/pendingTool";
import {
  bufferFor,
  cachedBuffer,
  savedScroll,
  saveScroll,
} from "./lib/readerCache";
import {
  ALL_FILTERS,
  buildOutline,
  commandLabel,
  filterBlocks,
  type ReaderFilters,
  sessionStats,
  turnCalls,
  turnMarkdown,
} from "./lib/readerDoc";
import {
  displayPath,
  formatClock,
  formatDuration,
  turnOutcome,
} from "./lib/readerView";
import { promptOccurrence } from "./lib/rewind";
import {
  clearClaudeInput,
  runRewind,
  waitForClaudeReady,
} from "./lib/rewindDriver";
import {
  useClaudeActivity,
  useClaudeDialog,
  useClaudeFooter,
} from "./lib/screenStore";
import { sessionInfo } from "./lib/sessionInfo";
import { latestPlan, latestTodos } from "./lib/sessionPlan";
import {
  normalizeSessionTitle,
  useSessionTitle,
  useSessionTitles,
} from "./lib/sessionTitles";
import { liveWorking } from "./lib/stopControl";
import { buildDocument, type ReaderTurn } from "./lib/transcript";
import {
  clampSegments,
  type PromptSegment,
  promptSegments,
} from "./lib/promptSegments";
import {
  findTranscript,
  followTranscript,
  openTranscript,
  type TranscriptFollower,
} from "./lib/transcriptClient";
import { compactItems, readViewMode, writeViewMode } from "./lib/viewMode";
import { AskSelectionPill } from "./ReaderAskSelection";
import {
  CopyButton,
  ImageStrip,
  type ReaderContext,
  ReaderItems,
} from "./ReaderBlocks";
import {
  FilterBar,
  InfoPanel,
  OutlinePanel,
  SearchBox,
  scrollToTurn,
  useCurrentTurn,
  useReaderSearch,
} from "./ReaderChrome";
import { type ComposerHandle, ReaderComposer } from "./ReaderComposer";
import {
  CompactBannerView,
  ConfirmBar,
  ConversationMenu,
  HistoryButton,
  PastChatBanner,
  type PromptAction,
  PromptActions,
  RenameField,
  type RewindStatus,
  RewindStatusBar,
} from "./ReaderConversation";
import {
  type FileDiffApi,
  FileDiffDialog,
  FileDiffProvider,
  fileDiffLookup,
} from "./ReaderFileDiff";
import { HistoryPanel } from "./ReaderHistory";
import {
  ChangesButton,
  ChangesPanel,
  CodeBlockActions,
  CompactItems,
  LiveWorkCard,
  ViewModeToggle,
  WorkPanel,
} from "./ReaderPanels";
import {
  ActivityRow,
  SessionCards,
  SessionPill,
  SessionRail,
  useSessionFacts,
} from "./ReaderStrip";
import { useReaderStore, viewPastChat } from "./readerStore";

export type SessionReaderProps = {
  leafId: number;
  cwd: string | null;
  /** Switches the pane back to its terminal. */
  onShowTerminal: () => void;
  /** The pane is the active one: the composer takes keyboard focus. */
  focused?: boolean;
};

type LoadState =
  | { kind: "unlinked" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const FOLLOW_THRESHOLD_PX = 64;
/** Transcript poll interval while Claude works, and otherwise. */
const LIVE_POLL_MS = 250;
const IDLE_POLL_MS = 500;

let cachedHome: string | null = null;

export default function SessionReader({
  leafId,
  cwd,
  onShowTerminal,
  focused = true,
}: SessionReaderProps) {
  const ptyId = ptyIdForLeaf(leafId);
  const linkedId = useAgentActivityStore((s) =>
    ptyId === null ? undefined : s.sessionIds[ptyId],
  );
  const phase = useAgentActivityStore((s): AgentPhase | undefined =>
    ptyId === null ? undefined : s.phases[ptyId],
  );
  const session = useAgentStore((s) => s.sessions[leafId]);
  const sessionId = linkedId ?? session?.claudeSessionId ?? null;
  const fallbackId = useFallbackSession(
    sessionId,
    cwd,
    session?.startedAt ?? null,
    leafId,
  );
  const liveId = sessionId ?? fallbackId;
  /** A past chat shown read only in place of the live session, or null. */
  const viewing = useReaderStore((s) => s.viewing[leafId] ?? null);
  const activeId = viewing ?? liveId;

  const [home, setHome] = useState<string | null>(cachedHome);
  useEffect(() => {
    if (cachedHome) return;
    void homeDir()
      .then((h) => {
        cachedHome = h.replace(/\/+$/, "");
        setHome(cachedHome);
      })
      .catch(() => {});
  }, []);

  // A session shown recently is still loaded: render it at once, no reload.
  const [state, setState] = useState<LoadState>({
    kind: !activeId ? "unlinked" : cachedBuffer(activeId) ? "ready" : "loading",
  });
  const [version, setVersion] = useState(0);
  const follower = useRef<TranscriptFollower | null>(null);

  useEffect(() => {
    if (!activeId) {
      setState({ kind: "unlinked" });
      return;
    }
    let cancelled = false;
    const follow = () => {
      follower.current = followTranscript(activeId, {
        // Resumes from where a previous Reader of this session left off.
        buffer: bufferFor(activeId),
        onChange: () => {
          setState({ kind: "ready" });
          setVersion((v) => v + 1);
        },
        onError: (error) => setState({ kind: "error", message: String(error) }),
      });
    };
    if (cachedBuffer(activeId)) {
      setState({ kind: "ready" });
      follow();
    } else {
      setState({ kind: "loading" });
      void openTranscript(activeId)
        .then(() => {
          if (cancelled) return;
          follow();
          // An empty but valid transcript still counts as loaded.
          setState((s) => (s.kind === "loading" ? { kind: "ready" } : s));
        })
        .catch((error: unknown) => {
          if (!cancelled) setState({ kind: "error", message: String(error) });
        });
    }
    return () => {
      cancelled = true;
      follower.current?.stop();
      follower.current = null;
    };
  }, [activeId]);

  // Agent signals mean new lines are likely: read now, not on the next tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a phase change is the trigger, not an input
  useEffect(() => {
    follower.current?.poke();
  }, [phase]);
  // Tail faster while Claude works so blocks land as they're written; the
  // follower only exists once loading finishes, so re-apply when it's ready.
  const followerReady = state.kind === "ready";
  useEffect(() => {
    if (!followerReady) return;
    follower.current?.setInterval(
      phase === "working" ? LIVE_POLL_MS : IDLE_POLL_MS,
    );
  }, [phase, followerReady]);

  const buffer =
    follower.current?.buffer ??
    (activeId ? cachedBuffer(activeId) : null) ??
    undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version bumps when the buffer mutates
  const doc = useMemo(
    () => buildDocument(buffer?.entries ?? []),
    [buffer, version],
  );
  const pendingTool = useMemo(() => pendingToolCall(doc), [doc]);
  const flight = useMemo(() => inFlightCall(doc), [doc]);
  const todos = useMemo(() => latestTodos(doc), [doc]);
  const plan = useMemo(() => latestPlan(doc), [doc]);
  const files = useMemo(() => changedFiles(doc, cwd), [doc, cwd]);
  const activity = useClaudeActivity(leafId);
  const canLoadEarlier = buffer?.canLoadEarlier ?? false;
  const truncated = buffer?.truncated ?? false;

  const [full, setFull] = useState(false);
  const [filters, setFilters] = useState<ReaderFilters>(ALL_FILTERS);
  const [toolsOpen, setToolsOpen] = useState<ReaderContext["toolsOpen"]>(null);
  const [query, setQuery] = useState("");
  const [showInfo, setShowInfo] = useState(true);
  const [compact, setCompactState] = useState(
    () => readViewMode() === "compact",
  );
  const setCompact = (next: boolean) => {
    setCompactState(next);
    writeViewMode(next ? "compact" : "detailed");
  };
  /** Pane view: the Changes slide-over. Full view: the right column's Changes tab. */
  const [showChanges, setShowChangesState] = useState(false);
  /** The chat history list, in the same place as Changes (one at a time). */
  const [showHistory, setShowHistoryState] = useState(false);
  const setShowChanges = (next: boolean | ((v: boolean) => boolean)) => {
    setShowChangesState((v) => {
      const value = typeof next === "function" ? next(v) : next;
      if (value) setShowHistoryState(false);
      return value;
    });
  };
  const setShowHistory = (next: boolean | ((v: boolean) => boolean)) => {
    setShowHistoryState((v) => {
      const value = typeof next === "function" ? next(v) : next;
      if (value) setShowChangesState(false);
      return value;
    });
  };
  const [renaming, setRenaming] = useState(false);
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [rewind, setRewind] = useState<RewindStatus | null>(null);
  const [compactDismissedAt, setCompactDismissedAt] = useState<number | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const composer = useRef<ComposerHandle | null>(null);
  const root = useRef<HTMLElement | null>(null);

  /**
   * Gives the composer focus unless the user is typing elsewhere: focus on
   * the page body, on this pane's hidden terminal, or on a non-text control
   * inside the Reader is taken over; any other input keeps it.
   */
  const focusComposer = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    const reader = root.current;
    const leaf = document.querySelector(`[data-pane-leaf="${leafId}"]`);
    const editable = (el: HTMLElement) =>
      el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const free =
      !active ||
      active === document.body ||
      (leaf?.contains(active) === true && !reader?.contains(active)) ||
      (reader?.contains(active) === true && !editable(active));
    if (free) composer.current?.focus();
  }, [leafId]);
  // Opening the Reader, switching views, or the pane becoming active.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the view switches
  useEffect(() => {
    if (!focused) return;
    const frame = requestAnimationFrame(focusComposer);
    return () => cancelAnimationFrame(frame);
  }, [focused, full, focusComposer]);
  useEffect(() => {
    if (!focused) return;
    const onWindowFocus = () => requestAnimationFrame(focusComposer);
    // The app refocuses the pane's terminal (tab switches, pane clicks);
    // while the Reader covers it, the composer is the input instead.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const leaf = document.querySelector(`[data-pane-leaf="${leafId}"]`);
      if (target && leaf?.contains(target) && !root.current?.contains(target))
        requestAnimationFrame(focusComposer);
    };
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [focused, leafId, focusComposer]);
  const restored = activeId ? savedScroll(leafId, activeId) : null;
  const [following, setFollowing] = useState(restored?.following ?? true);
  // Put a restored Reader back where it was read, before it paints.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per opened session
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !activeId || state.kind !== "ready") return;
    const saved = savedScroll(leafId, activeId);
    if (saved && !saved.following) el.scrollTop = saved.top;
  }, [activeId, state.kind === "ready"]);
  // Remember the position when the tab is switched away (the Reader unmounts).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !activeId) return;
    return () => {
      saveScroll(leafId, activeId, {
        top: el.scrollTop,
        following:
          el.scrollHeight - el.scrollTop - el.clientHeight <
          FOLLOW_THRESHOLD_PX,
      });
    };
  }, [leafId, activeId]);
  // Cards animate in only once the first render has settled, so opening or
  // returning to a chat doesn't replay every card's entrance at once.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (state.kind !== "ready") return;
    const timer = setTimeout(() => setSettled(true), 600);
    return () => clearTimeout(timer);
  }, [state.kind]);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setFollowing(
      el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX,
    );
  }, []);
  // Before paint, so a restored or growing chat never flashes at the wrong spot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new content when pinned to the bottom
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [version, state.kind, full]);
  const jumpToLatest = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    setFollowing(true);
  };

  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadEarlier = async () => {
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    setLoadingEarlier(true);
    await follower.current?.loadEarlier();
    setLoadingEarlier(false);
    // Keep the reading position steady after content lands above it.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before;
    });
  };

  const search = useReaderSearch(
    content,
    scroller,
    query,
    version + (full ? 1e6 : 0),
  );
  const outline = useMemo(() => buildOutline(doc.turns), [doc]);
  const stats = useMemo(() => sessionStats(doc.turns), [doc]);
  const info = useMemo(
    () => sessionInfo(buffer?.entries ?? [], doc.turns),
    [buffer, doc],
  );
  const { facts, folderPath } = useSessionFacts(
    leafId,
    info,
    phase === "working",
    cwd,
    home,
  );
  const promptHistory = useMemo(
    () => doc.turns.map((t) => t.command ?? t.prompt),
    [doc],
  );
  const currentTurn = useCurrentTurn(
    scroller,
    full ? outline.map((o) => o.id) : [],
  );

  const agent = session?.agent ?? "claude";
  const customTitle = useSessionTitle(activeId);
  const title =
    customTitle ?? doc.title ?? (cwd ? basename(cwd) : displayAgent(agent));
  const dialog = useClaudeDialog(leafId);
  const footerVisible = useClaudeFooter(leafId) !== null;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyWidth = useElementWidth(bodyRef);
  /** Read off Claude's screen when visible: an Esc interrupt fires no hook. */
  const working = liveWorking(phase, activity, footerVisible);
  const linked = liveId !== null && viewing === null;
  /** Why commands and rewinds can't be sent now, or null when they can. */
  const busyReason = viewing
    ? "This is a past chat. Go back to live first."
    : !liveId
      ? "Send a prompt first so the Reader can link this session."
      : working
        ? "Wait until Claude finishes, or stop it."
        : dialog
          ? "Answer Claude's question first."
          : rewind?.kind === "running"
            ? "A rewind is already running."
            : null;
  const ctx: ReaderContext = useMemo(
    () => ({ cwd, home, sessionId: activeId, toolsOpen }),
    [cwd, home, activeId, toolsOpen],
  );
  const expandAll = (open: boolean) => setToolsOpen({ open, at: Date.now() });

  // Claude's fenced code gets Insert / Open file; "Run" is dropped, since the
  // active terminal is this Claude session.
  const codeExtras = useMemo(
    () => ({
      hideRun: true,
      render: (code: string, lang: string) => (
        <CodeBlockActions
          code={code}
          lang={lang}
          ctx={ctx}
          onInsert={(fenced) => composer.current?.insert(fenced)}
        />
      ),
    }),
    [ctx],
  );
  // A file this chat changed opens in a diff dialog over the session.
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const fileDiffApi = useMemo<FileDiffApi>(() => {
    const resolve = fileDiffLookup(
      files.map((f) => f.path),
      cwd,
    );
    return {
      open: (path) => setDiffPath(resolve(path) ?? path),
      has: (path) => resolve(path) !== null,
      resolve,
    };
  }, [files, cwd]);
  const closeDiff = () => {
    setDiffPath(null);
    requestAnimationFrame(() => composer.current?.focus());
  };

  // Links in replies, prompts and output: web in the browser; files changed
  // in this chat in the diff dialog; other files in the editor, resolved
  // against this session's folder.
  const linkRouter = useMemo(
    () => ({
      openFile: (target: string) => {
        const changed = fileDiffApi.resolve(target);
        if (changed) fileDiffApi.open(changed);
        else void openTerminalLink(target, cwd);
      },
    }),
    [cwd, fileDiffApi],
  );

  const onReview = (changed: ChangedFile[]) => {
    composer.current?.submit(reviewPrompt(changed, cwd, home));
    if (!full) setShowChanges(false);
    setFollowing(true);
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
    });
  };

  const closePanels = () => {
    setShowChanges(false);
    setShowHistory(false);
    requestAnimationFrame(focusComposer);
  };

  const startNewChat = () => {
    setConfirmNewChat(false);
    composer.current?.submit("/clear");
    requestAnimationFrame(focusComposer);
  };

  const submitRename = (raw: string) => {
    setRenaming(false);
    const name = normalizeSessionTitle(raw);
    requestAnimationFrame(focusComposer);
    if (!name || !activeId) return;
    // Saved in Terax at once so every view shows it, whatever Claude supports.
    useSessionTitles.getState().setTitle(activeId, name);
    if (busyReason !== null) {
      setNotice("Name saved in Terax.");
      return;
    }
    composer.current?.submit(`/rename ${name}`);
    setTimeout(() => {
      const tail = (leafScreenText(leafId) ?? "").slice(-3000);
      if (
        /unknown (?:slash )?command|not a (?:valid|known) command|no such command/iu.test(
          tail,
        )
      ) {
        setNotice(
          "Claude has no /rename here; the name is saved in Terax only.",
        );
      }
    }, 1500);
  };

  const exportMeta = () => ({
    title,
    cwd,
    sessionId: activeId,
    exportedAt: Date.now(),
  });
  const partialNote = canLoadEarlier
    ? " (loaded turns only; use Load earlier turns for the whole chat)"
    : "";
  const copyMarkdown = () => {
    void copyToClipboard(documentMarkdown(doc, exportMeta())).then(() =>
      setNotice(`Copied the chat as Markdown${partialNote}.`),
    );
  };
  const saveMarkdown = async () => {
    try {
      const meta = exportMeta();
      const path = await join(
        await downloadDir(),
        exportFileName(meta.title, meta.exportedAt),
      );
      await invoke("fs_write_file", {
        path,
        content: documentMarkdown(doc, meta),
        workspace: currentWorkspaceEnv(),
        source: "export",
      });
      setNotice(`Saved to ${displayPath(path, null, home)}${partialNote}.`);
      void revealInFinder(path);
    } catch (error) {
      setNotice(`Couldn't save the Markdown: ${String(error)}`);
    }
  };

  const promptTexts = useMemo(
    () => doc.turns.map((t) => t.command ?? t.prompt),
    [doc],
  );
  const runPromptAction = async (
    index: number,
    action: PromptAction,
    alsoCode: boolean,
  ) => {
    const turn = doc.turns[index];
    const target = promptTexts[index];
    if (!turn || !target || busyReason) return;
    const occurrence = promptOccurrence(promptTexts, index);
    const label =
      action === "edit"
        ? "Edit & re-run"
        : action === "restore"
          ? "Restore checkpoint"
          : "Fork from here";
    const onStage = (
      stage: Parameters<NonNullable<Parameters<typeof runRewind>[4]>>[0],
    ) => setRewind({ kind: "running", label, stage });
    onStage("opening");

    if (action === "fork") {
      const launched = liveId ? resumeChat(cwd, liveId, true) : null;
      if (!launched) {
        setRewind({
          kind: "error",
          message: "Couldn't open a new tab for the fork.",
          needsTerminal: false,
        });
        return;
      }
      const ready =
        (await launched.started) &&
        (await waitForClaudeReady(launched.leafId, 45_000));
      if (!ready) {
        setRewind({
          kind: "error",
          message:
            "The forked session didn't start in time. Finish there with /rewind.",
          needsTerminal: false,
        });
        return;
      }
      const result = await runRewind(
        launched.leafId,
        target,
        "conversation",
        occurrence,
        onStage,
      );
      setRewind(
        result.ok
          ? {
              kind: "done",
              message:
                "Forked into a new tab, rewound to before that prompt. This chat is unchanged.",
            }
          : {
              kind: "error",
              message: `Fork opened, but: ${result.reason}`,
              needsTerminal: false,
            },
      );
      return;
    }

    const result = await runRewind(
      leafId,
      target,
      action === "restore" || alsoCode ? "both" : "conversation",
      occurrence,
      onStage,
    );
    if (!result.ok) {
      setRewind({
        kind: "error",
        message: result.reason,
        needsTerminal: result.needsTerminal,
      });
      return;
    }
    setTimeout(() => follower.current?.poke(), 600);
    if (action !== "edit") {
      setRewind({
        kind: "done",
        message: "Restored code and conversation to before that prompt.",
      });
      return;
    }
    // Claude puts the old prompt back in its own input; empty that so the
    // edited one isn't added to it.
    let cleared = true;
    if (result.restoredInput) {
      cleared = await clearClaudeInput(
        leafId,
        result.restoredInput.split("\n").length,
      );
    }
    composer.current?.replace(turn.prompt ?? target);
    setRewind({
      kind: "done",
      message: cleared
        ? "Rewound. Edit the prompt below and send it."
        : "Rewound, but Claude's own input still holds the old prompt. Clear it in the terminal before sending.",
    });
  };
  // A finished rewind's message fades after a while.
  useEffect(() => {
    if (rewind?.kind !== "done") return;
    const timer = setTimeout(() => setRewind(null), 7000);
    return () => clearTimeout(timer);
  }, [rewind]);

  const banner = viewing
    ? null
    : compactBanner(facts.contextPercent, compactDismissedAt);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ["INPUT", "TEXTAREA"].includes(event.target.tagName));
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape" && (showChanges || showHistory) && !full) {
      event.preventDefault();
      closePanels();
      return;
    }
    if (mod && event.shiftKey && event.code === "Space") {
      event.preventDefault();
      composer.current?.toggleVoice();
      return;
    }
    if (mod && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      setFull((v) => !v);
      return;
    }
    if (mod && !event.shiftKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      composer.current?.focus();
      return;
    }
    if (mod && event.key === ".") {
      event.preventDefault();
      composer.current?.stop();
      return;
    }
    if (
      !typing &&
      !mod &&
      !event.altKey &&
      (event.key === "Escape" || /^[1-9]$/.test(event.key)) &&
      composer.current?.answer(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (typing || mod || event.altKey || event.key.length !== 1) return;
    const target = event.target as HTMLElement;
    const control = target.closest(
      "button, a, summary, [role='button'], [role='option'], [role='tab']",
    );
    // Space and Enter still press a focused control.
    if (event.key === " " && control) return;
    event.preventDefault();
    // "/" with a draft only focuses; on an empty draft it starts a command.
    if (event.key === "/" && !composer.current?.isEmpty()) {
      composer.current?.focus();
      return;
    }
    composer.current?.insert(event.key);
  };

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-label="Image"]')) return;
      event.preventDefault();
      setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const lastTurn = doc.turns[doc.turns.length - 1] ?? null;
  /** The document shows the live session working (never for a past chat). */
  const docWorking = working && !viewing;
  const liveSteps = useMemo(
    () => (docWorking && lastTurn ? turnSteps(lastTurn, cwd, home) : []),
    [docWorking, lastTurn, cwd, home],
  );
  const liveCard = docWorking && lastTurn && (
    <LiveWorkCard
      flight={flight}
      steps={liveSteps}
      activity={activity}
      ctx={ctx}
      turnStartedAt={lastTurn.promptAt}
    />
  );
  /** Loaded turns are the whole chat, so their numbers are the real ones. */
  const allTurnsLoaded = !canLoadEarlier && !truncated;

  const turns =
    doc.turns.length === 0 ? (
      <EmptyDoc />
    ) : (
      doc.turns.map((turn, index) => {
        const live = index === doc.turns.length - 1 && docWorking;
        return (
          <TurnView
            key={turn.id}
            turn={turn}
            number={allTurnsLoaded ? index + 1 : null}
            ctx={ctx}
            filters={filters}
            compact={compact}
            live={live}
            liveCard={live ? liveCard : null}
            actionsDisabled={busyReason}
            onPromptAction={
              viewing
                ? undefined
                : (action, alsoCode) =>
                    void runPromptAction(index, action, alsoCode)
            }
          />
        );
      })
    );

  const workPanel = (sticky: boolean) => (
    <WorkPanel todos={todos} plan={plan} leafId={leafId} sticky={sticky} />
  );

  const documentBody = (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="terax-reader relative min-h-0 flex-1 overflow-y-auto"
    >
      <AskSelectionPill
        container={scroller}
        onAsk={(source) =>
          composer.current?.appendBlock(selectionToQuote(source))
        }
      />
      <div
        ref={content}
        className={cn("terax-reader-column flex flex-col gap-5 pb-8 pt-4")}
      >
        {state.kind === "unlinked" && <UnlinkedState />}
        {state.kind === "loading" && <LoadingState />}
        {state.kind === "error" && <ErrorState message={state.message} />}
        {state.kind === "ready" && (
          <>
            {!(full && showInfo && !showChanges) && workPanel(true)}
            {(canLoadEarlier || truncated) && (
              <div className="flex justify-center">
                {canLoadEarlier ? (
                  <button
                    type="button"
                    disabled={loadingEarlier}
                    onClick={() => void loadEarlier()}
                    className="rounded-full border border-border/70 bg-card px-3 py-1 text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                  >
                    {loadingEarlier ? "Loading…" : "Load earlier turns"}
                  </button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Older turns are not shown
                  </span>
                )}
              </div>
            )}
            <MarkdownLinkProvider value={linkRouter}>
              <CodeBlockExtrasProvider value={codeExtras}>
                {turns}
              </CodeBlockExtrasProvider>
            </MarkdownLinkProvider>
            {/* While Claude works the live card ends the turn instead. */}
            {doc.turns.length > 0 && !docWorking && !viewing && (
              <div className="pl-5">
                <ActivityRow leafId={leafId} inline />
              </div>
            )}
          </>
        )}
      </div>
      {!following && state.kind === "ready" && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="sticky bottom-4 left-full mr-5 ml-auto flex w-fit items-center gap-1.5 rounded-full border border-border/70 bg-popover px-3 py-1.5 text-[11.5px] font-medium text-foreground shadow-lg outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={ArrowDown02Icon} size={13} strokeWidth={2} />
          Jump to latest
        </button>
      )}
    </div>
  );

  /** The rail only takes width the full content column can't use. */
  const showRail =
    !full && !viewing && state.kind === "ready" && bodyWidth >= RAIL_MIN_PANE;
  const sessionProps = {
    leafId,
    phase: viewing ? undefined : phase,
    working: working && !viewing,
    facts,
    folderPath,
  };

  /** Rewind progress, the new-chat question, the compact offer and notices. */
  const composerBanners = (
    <div className="terax-reader-column shrink-0">
      {rewind && (
        <RewindStatusBar
          status={rewind}
          onOpenTerminal={() => {
            setFull(false);
            onShowTerminal();
          }}
          onDismiss={() => {
            setRewind(null);
            requestAnimationFrame(focusComposer);
          }}
        />
      )}
      {confirmNewChat && (
        <ConfirmBar
          message="Start a new chat? Claude clears this conversation (/clear). It stays in History."
          confirmLabel="New chat"
          onConfirm={startNewChat}
          onCancel={() => {
            setConfirmNewChat(false);
            requestAnimationFrame(focusComposer);
          }}
        />
      )}
      {banner && (
        <CompactBannerView
          banner={banner}
          onCompact={(notes) => {
            composer.current?.submit(compactCommand(notes));
            setCompactDismissedAt(banner.percent);
            requestAnimationFrame(focusComposer);
          }}
          onDismiss={() => setCompactDismissedAt(banner.percent)}
        />
      )}
      {notice && (
        <div
          role="status"
          className="terax-reader-in mb-2 w-full rounded-xl border border-border/70 bg-card px-3 py-1.5 text-[12px] text-foreground"
        >
          {notice}
        </div>
      )}
    </div>
  );

  const composerView = (
    <ReaderComposer
      ref={composer}
      leafId={leafId}
      cwd={cwd}
      phase={phase}
      sessionId={activeId}
      pendingTool={pendingTool}
      ctx={ctx}
      facts={facts}
      history={promptHistory}
      onOpenTerminal={() => {
        setFull(false);
        onShowTerminal();
      }}
      onSent={() => {
        // Sending always talks to the live session.
        if (viewing) viewPastChat(leafId, null);
        setFollowing(true);
        jumpToLatest();
        setTimeout(() => follower.current?.poke(), 600);
      }}
    />
  );

  const header = (
    <ReaderHeader
      agent={agent}
      title={title}
      titleNode={
        renaming ? (
          <RenameField
            initial={title}
            onSubmit={submitRename}
            onCancel={() => {
              setRenaming(false);
              requestAnimationFrame(focusComposer);
            }}
          />
        ) : null
      }
      subtitle={cwd ? displayPath(cwd, null, home) : null}
      phase={
        viewing
          ? undefined
          : working
            ? "working"
            : phase === "working"
              ? "idle"
              : phase
      }
      startedAt={session?.startedAt ?? null}
      session={
        !showRail && !full && state.kind === "ready" && !viewing ? (
          <SessionPill {...sessionProps} />
        ) : null
      }
      full={full}
      onToggleFull={() => setFull((v) => !v)}
      onShowTerminal={() => {
        setFull(false);
        onShowTerminal();
      }}
      tools={
        <>
          {state.kind === "ready" && (
            <>
              <ViewModeToggle compact={compact} onChange={setCompact} />
              <ChangesButton
                count={files.length}
                open={showChanges}
                onToggle={() => setShowChanges((v) => !v)}
              />
            </>
          )}
          <HistoryButton
            open={showHistory}
            onToggle={() => setShowHistory((v) => !v)}
          />
          <ConversationMenu
            canAct={linked && busyReason === null}
            onNewChat={() => setConfirmNewChat(true)}
            onRename={() => setRenaming(true)}
            onCopyMarkdown={copyMarkdown}
            onSaveMarkdown={() => void saveMarkdown()}
            onClaudeExport={() => composer.current?.submit("/export")}
            onFork={
              linked && liveId
                ? () => {
                    if (!resumeChat(cwd, liveId, true))
                      setNotice("Couldn't open a new tab for the fork.");
                  }
                : null
            }
            onAfterClose={focusComposer}
          />
        </>
      }
    />
  );

  const changesPanel = (
    <ChangesPanel
      files={files}
      ctx={ctx}
      onReview={onReview}
      onClose={closePanels}
    />
  );

  const historyPanel = (
    <HistoryPanel
      cwd={cwd}
      liveSessionId={liveId}
      onOpen={(id) => {
        viewPastChat(leafId, id === liveId ? null : id);
        closePanels();
      }}
      onResume={(id) => {
        if (!resumeChat(cwd, id))
          setNotice("Couldn't open a new tab to resume.");
      }}
      onClose={closePanels}
    />
  );

  const pastBanner = viewing && (
    <PastChatBanner
      title={title}
      onBack={() => {
        viewPastChat(leafId, null);
        requestAnimationFrame(focusComposer);
      }}
      onResume={() => {
        if (!resumeChat(cwd, viewing))
          setNotice("Couldn't open a new tab to resume.");
      }}
    />
  );

  const diffDialog = (
    <FileDiffDialog
      path={diffPath}
      sessionId={activeId}
      cwd={cwd}
      home={home}
      doc={doc}
      onClose={closeDiff}
    />
  );

  if (full) {
    return createPortal(
      <FileDiffProvider value={fileDiffApi}>
        <section
          ref={root}
          aria-label="Session Reader, full view"
          onKeyDown={onKeyDown}
          data-terax-reader=""
          data-reader-settling={settled ? undefined : ""}
          className="terax-reader-full fixed inset-0 z-[900] flex flex-col bg-background"
        >
          {diffDialog}
          {header}
          {pastBanner}
          <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/60 px-4 py-2">
            <SearchBox
              query={query}
              onQuery={setQuery}
              count={search.count}
              index={search.index}
              onNext={search.next}
              onPrev={search.prev}
            />
            <FilterBar
              filters={filters}
              onFilters={setFilters}
              onExpandAll={expandAll}
            />
            <div className="ml-auto flex items-center gap-2">
              {!showInfo && (
                <button
                  type="button"
                  onClick={() => setShowInfo(true)}
                  className="h-7 rounded-lg px-2 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Session info
                </button>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <OutlinePanel
              items={outline}
              current={currentTurn}
              onPick={(id) => {
                setFollowing(false);
                scrollToTurn(scroller.current, id);
              }}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              {documentBody}
              {composerBanners}
              {composerView}
            </div>
            {showChanges || showHistory ? (
              <aside
                aria-label={showHistory ? "Chat history" : "Changes"}
                className="flex min-h-0 w-[420px] shrink-0 flex-col border-l border-border/60 bg-sidebar/60"
              >
                {showHistory ? historyPanel : changesPanel}
              </aside>
            ) : (
              showInfo && (
                <InfoPanel
                  title={title}
                  cwd={cwd}
                  phaseLabel={phaseLabel(phase)}
                  elapsed={
                    session?.startedAt
                      ? formatDuration(Date.now() - session.startedAt)
                      : null
                  }
                  stats={stats}
                  info={info}
                  live={phase === "working"}
                  ctx={ctx}
                  onClose={() => setShowInfo(false)}
                >
                  <SessionCards {...sessionProps} showFolder />
                  {workPanel(false)}
                </InfoPanel>
              )
            )}
          </div>
        </section>
      </FileDiffProvider>,
      document.body,
    );
  }

  return (
    <FileDiffProvider value={fileDiffApi}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the reader */}
      <div
        ref={(el) => {
          root.current = el;
        }}
        onKeyDown={onKeyDown}
        data-terax-reader=""
        data-reader-settling={settled ? undefined : ""}
        className="absolute inset-0 z-[6] flex flex-col bg-background"
      >
        {diffDialog}
        {header}
        {pastBanner}
        <div ref={bodyRef} className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {documentBody}
            {composerBanners}
            {composerView}
          </div>
          {showRail && <SessionRail {...sessionProps} />}
          {(showChanges || showHistory) && (
            <div className="terax-reader-in absolute inset-y-0 right-0 z-[8] flex w-[min(440px,100%)] flex-col border-l border-border/60 bg-background shadow-[-18px_0_40px_-28px_rgba(0,0,0,0.9)]">
              {showHistory ? historyPanel : changesPanel}
            </div>
          )}
        </div>
      </div>
    </FileDiffProvider>
  );
}

function phaseLabel(phase: AgentPhase | undefined): string | null {
  if (phase === "working") return "Working";
  if (phase === "attention") return "Needs you";
  if (phase === "finished") return "Done";
  return null;
}

/**
 * Sessions whose hooks never reported an id: the newest transcript in the
 * pane's folder, but only when no other unlinked agent session shares it,
 * and never one another pane already owns (tabs often share a folder, and
 * the newest file there is usually another tab's live chat).
 */
function useFallbackSession(
  sessionId: string | null,
  cwd: string | null,
  startedAt: number | null,
  leafId: number,
): string | null {
  const [found, setFound] = useState<string | null>(null);
  const others = useAgentStore((s) => {
    let count = 0;
    for (const other of Object.values(s.sessions)) {
      if (other.leafId === leafId || other.claudeSessionId) continue;
      if (cwd && leafCwd(other.leafId) === cwd) count += 1;
    }
    return count;
  });
  // A string so the selectors stay stable between renders.
  const ownPty = ptyIdForLeaf(leafId);
  const ownedByStore = useAgentStore((s) =>
    Object.values(s.sessions)
      .filter((o) => o.leafId !== leafId && o.claudeSessionId)
      .map((o) => o.claudeSessionId)
      .join(","),
  );
  const ownedByPty = useAgentActivityStore((s) =>
    Object.entries(s.sessionIds)
      .filter(([pty]) => Number(pty) !== ownPty)
      .map(([, id]) => id)
      .join(","),
  );
  const owned = [ownedByStore, ownedByPty].filter(Boolean).join(",");
  useEffect(() => {
    setFound(null);
    if (sessionId || !cwd || startedAt === null || others > 0) return;
    let cancelled = false;
    const exclude = owned ? [...new Set(owned.split(","))] : [];
    const look = () =>
      findTranscript(cwd, startedAt - 60_000, exclude)
        .then((id) => {
          if (!cancelled) setFound(id);
        })
        .catch(() => {});
    void look();
    const timer = setInterval(() => void look(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, cwd, startedAt, others, owned]);
  return sessionId ? null : found;
}

function ReaderHeader({
  agent,
  title,
  titleNode,
  subtitle,
  phase,
  startedAt,
  full,
  onToggleFull,
  onShowTerminal,
  tools,
  session,
}: {
  agent: string;
  title: string;
  /** Replaces the title (the rename field). */
  titleNode?: ReactNode;
  subtitle: string | null;
  phase: AgentPhase | undefined;
  startedAt: number | null;
  full: boolean;
  onToggleFull: () => void;
  onShowTerminal: () => void;
  /** Extra header buttons (view mode, Changes). */
  tools?: ReactNode;
  /** The Session pill, when the pane is too narrow for the rail. */
  session?: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border/60 bg-card px-4">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
        <AgentIcon agent={agent} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        {titleNode ?? (
          <div className="truncate text-[13px] font-semibold text-foreground">
            {title}
          </div>
        )}
        {subtitle && !titleNode && (
          <div className="terax-reader-mono truncate text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      <StatusPill phase={phase} startedAt={startedAt} />
      {session}
      <div className="flex shrink-0 items-center gap-0.5">
        {tools}
        <button
          type="button"
          onClick={onToggleFull}
          aria-label={full ? "Exit full view" : "Full view"}
          title={full ? "Exit full view (Esc)" : "Full view (⌘⇧↩)"}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon
            icon={full ? ArrowShrink02Icon : ArrowExpand01Icon}
            size={14}
            strokeWidth={1.8}
          />
        </button>
      </div>
      <fieldset
        aria-label="Pane view"
        className="m-0 flex h-7 min-w-0 shrink-0 items-center rounded-lg border border-border/70 bg-background/60 p-0.5"
      >
        <button
          type="button"
          onClick={onShowTerminal}
          className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon
            icon={ComputerTerminal01Icon}
            size={13}
            strokeWidth={1.8}
          />
          Terminal
        </button>
        <span
          aria-current="true"
          className="flex h-6 items-center gap-1.5 rounded-md bg-primary/15 px-2 text-[11.5px] font-medium text-foreground"
        >
          <HugeiconsIcon icon={AiChat02Icon} size={13} strokeWidth={1.8} />
          Reader
        </span>
      </fieldset>
    </header>
  );
}

function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

function StatusPill({
  phase,
  startedAt,
}: {
  phase: AgentPhase | undefined;
  startedAt: number | null;
}) {
  const now = useNow(1000, phase === "working");
  const elapsed = startedAt ? formatDuration(now - startedAt) : null;
  if (phase === "working") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--agent-working)_40%,transparent)] bg-[color-mix(in_oklab,var(--agent-working)_12%,transparent)] px-2.5 py-0.5 text-[11.5px] font-medium">
        <span className="size-1.5 animate-pulse rounded-full bg-agent-working" />
        <span className="terax-reader-shimmer">Working…</span>
        {elapsed && (
          <span className="tabular-nums text-muted-foreground">{elapsed}</span>
        )}
      </span>
    );
  }
  if (phase === "attention") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--agent-attention)_45%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_14%,transparent)] px-2.5 py-0.5 text-[11.5px] font-medium text-agent-attention">
        <span className="size-1.5 rounded-full bg-agent-attention" />
        Needs you
      </span>
    );
  }
  if (phase === "finished") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--agent-done)_40%,transparent)] bg-[color-mix(in_oklab,var(--agent-done)_12%,transparent)] px-2.5 py-0.5 text-[11.5px] font-medium text-agent-done">
        <span className="size-1.5 rounded-full bg-agent-done" />
        Done
      </span>
    );
  }
  return null;
}

const OUTCOME_DOT: Record<ReturnType<typeof turnOutcome>, string> = {
  running: "bg-agent-working",
  error: "bg-[var(--terminal-ansi-red)]",
  done: "bg-agent-done",
};

function TurnView({
  turn,
  number,
  ctx,
  filters,
  compact,
  live,
  liveCard,
  actionsDisabled,
  onPromptAction,
}: {
  turn: ReaderTurn;
  /** The turn's number in the whole chat, or null when earlier turns aren't loaded. */
  number: number | null;
  ctx: ReaderContext;
  filters: ReaderFilters;
  compact: boolean;
  live: boolean;
  /** The live "working" card that ends the turn Claude is in. */
  liveCard: ReactNode;
  /** Why prompt actions can't run now, or null. */
  actionsDisabled: string | null;
  /** Edit & re-run, Restore checkpoint, Fork; absent for past chats. */
  onPromptAction?: (action: PromptAction, alsoCode: boolean) => void;
}) {
  const outcome = live ? "running" : turnOutcome(turn);
  const blocks = useMemo(
    () => filterBlocks(turn.blocks, filters),
    [turn.blocks, filters],
  );
  const compacted = useMemo(
    () => (compact ? compactItems(blocks) : null),
    [compact, blocks],
  );
  const tools = useMemo(() => turnCalls(turn).length, [turn]);
  const time = formatClock(turn.promptAt);
  const pinned = usePinnedHeader();
  return (
    <section
      ref={pinned.section}
      data-turn-id={turn.id}
      className="terax-reader-turn group/turn relative pl-5"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[9px] left-0 size-[9px] rounded-full ring-[3px] ring-background",
          OUTCOME_DOT[outcome],
          outcome === "running" && "animate-pulse",
        )}
      />
      {/* Pins to the top only once the prompt card has scrolled past, so it
          never covers the card. */}
      <div
        className={cn(
          "z-[2] -mx-1 mb-1.5 flex h-7 items-center gap-1.5 bg-background px-1 text-[11px] text-muted-foreground",
          pinned.on
            ? "sticky top-0 border-b border-border/60 shadow-[0_6px_14px_-12px_rgba(0,0,0,0.8)]"
            : "relative",
        )}
      >
        {number !== null && (
          <span className="font-semibold text-foreground/85">
            Turn {number}
          </span>
        )}
        {time && (
          <span
            className={cn(
              "tabular-nums",
              number === null && "font-medium text-foreground/80",
            )}
          >
            {number !== null ? "· " : ""}
            {time}
          </span>
        )}
        {tools > 0 && (
          <span>
            · {tools} tool{tools === 1 ? "" : "s"}
          </span>
        )}
        <span className="group/prose ml-auto">
          <CopyButton
            text={() => turnMarkdown(turn)}
            label="Copy turn"
            className="group-hover/turn:opacity-100"
          />
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {(turn.prompt || turn.command || turn.images.length > 0) && (
          <PromptCard
            turn={turn}
            sessionId={ctx.sessionId}
            actions={
              onPromptAction && turn.prompt ? (
                <PromptActions
                  disabled={actionsDisabled}
                  onAction={onPromptAction}
                />
              ) : null
            }
          />
        )}
        <span ref={pinned.sentinel} aria-hidden className="-mt-3 h-0" />
        {compacted
          ? compacted.length > 0 && <CompactItems items={compacted} ctx={ctx} />
          : blocks.length > 0 && <ReaderItems blocks={blocks} ctx={ctx} />}
        {liveCard}
      </div>
    </section>
  );
}

/**
 * Whether a turn's header should be pinned: true while the marker after the
 * prompt card sits above the scroller's top edge, i.e. the reader is inside
 * the turn's body with the prompt out of view.
 */
function usePinnedHeader() {
  const section = useRef<HTMLElement | null>(null);
  const sentinel = useRef<HTMLSpanElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const marker = sentinel.current;
    const root = section.current?.closest<HTMLElement>(".terax-reader") ?? null;
    if (!marker || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const top = entry.rootBounds?.top ?? 0;
        setOn(!entry.isIntersecting && entry.boundingClientRect.top < top);
      },
      { root, threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  return { section, sentinel, on };
}

const PROMPT_CLAMP = 900;

function PromptCard({
  turn,
  sessionId,
  actions,
}: {
  turn: ReaderTurn;
  sessionId: string | null;
  /** The hover toolbar (Edit & re-run, Restore, Fork). */
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = turn.prompt ?? "";
  const segments = useMemo(
    () => promptSegments(text, turn.pastes),
    [text, turn.pastes],
  );
  const clamp = useMemo(
    () => clampSegments(segments, PROMPT_CLAMP),
    [segments],
  );
  const long = clamp.clipped;
  const shown = long && !expanded ? clamp.shown : segments;
  return (
    <section
      aria-label="Your prompt"
      className="group/prompt terax-reader-in relative flex flex-col gap-2 rounded-[14px] border border-primary/35 bg-primary/[0.08] px-4 py-3"
    >
      {/* Floats over the card's top-right corner, so it never adds a row. */}
      <div className="terax-reader-card-tools">
        {text && (
          <CopyButton text={text} className="group-hover/prompt:opacity-100" />
        )}
        {actions}
      </div>
      {turn.command && (
        <span className="terax-reader-mono inline-flex w-fit rounded-md border border-primary/40 bg-background/50 px-1.5 py-0.5 text-[12px] text-foreground">
          {commandLabel(turn.command)}
        </span>
      )}
      {shown.map((segment, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are fixed per prompt
        <PromptSegmentView key={i} segment={segment} />
      ))}
      {sessionId && turn.images.length > 0 && (
        <ImageStrip sessionId={sessionId} images={turn.images} />
      )}
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[11.5px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {expanded ? "Show less" : "Show full prompt"}
        </button>
      )}
    </section>
  );
}

/** One part of a prompt: text, a block kept on its grid, or a paste. */
function PromptSegmentView({ segment }: { segment: PromptSegment }) {
  if (segment.kind === "text") {
    return (
      <p className="select-text whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-foreground">
        <LinkifiedText text={segment.text} />
      </p>
    );
  }
  const pre = segment.kind === "pre" || segment.pre;
  const body = pre ? (
    <pre className="terax-reader-mono terax-reader-diagram m-0 select-text text-[12.5px] text-foreground">
      {segment.text}
    </pre>
  ) : (
    <p className="select-text whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground">
      <LinkifiedText text={segment.text} />
    </p>
  );
  if (segment.kind === "pre") {
    return (
      <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
        {body}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
      <span className="select-none text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        Pasted
      </span>
      {body}
    </div>
  );
}

function StateCard({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={cn(
        "mx-auto mt-10 max-w-md rounded-xl border px-5 py-4 text-center",
        tone === "error"
          ? "border-[color-mix(in_oklab,var(--terminal-ansi-red)_45%,transparent)] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_8%,transparent)]"
          : "border-border/60 bg-card",
      )}
    >
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function UnlinkedState() {
  return (
    <StateCard title="Send a prompt to link this session">
      The Reader follows Claude Code once it reports its session. Send any
      message in the terminal view. If nothing appears, update the hooks in
      Settings → Agents.
    </StateCard>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <StateCard title="Couldn't read this session" tone="error">
      {message}
    </StateCard>
  );
}

function EmptyDoc() {
  return (
    <StateCard title="Nothing here yet">
      Turns appear here as soon as you send Claude a prompt.
    </StateCard>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Loading session"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2.5 pl-8">
          <div className="terax-reader-skeleton h-14 rounded-xl" />
          <div className="terax-reader-skeleton h-28 rounded-xl" />
          <div className="terax-reader-skeleton h-9 w-2/3 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Pane width for the session rail: the 1280px column, its gutters and the rail. */
const RAIL_MIN_PANE = 1280 + 48 + 264;

/** `ref`'s current width, kept in step with resizes. */
function useElementWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
