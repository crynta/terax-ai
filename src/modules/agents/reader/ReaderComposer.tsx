import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/modules/terminal/lib/agentActivity";
import {
  leafBracketedPaste,
  leafScreenText,
  writeToSession,
} from "@/modules/terminal/lib/terminalSessionApi";
import {
  AtIcon,
  Cancel01Icon,
  File01Icon,
  Folder01Icon,
  ImageAdd01Icon,
  SentIcon,
  SlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextMiniMeter,
  MENTION_ICON,
  MentionPills,
  ModelPicker,
  ModePicker,
  QueueChips,
  useTransientMessage,
} from "./ComposerParts";
import { MicButton, useVoiceInput } from "./ComposerVoice";
import { appendBlock } from "./lib/askSelection";
import { type PermissionMode, parseClaudeFooter } from "./lib/claudeFooter";
import { parseClaudePanel } from "./lib/claudePanel";
import { modelCommand, nextCycleStep, SHIFT_TAB } from "./lib/composerControls";
import {
  dropMentionRef,
  needsMultiline,
  pointInRect,
  routeDroppedPaths,
  toLogicalPoint,
} from "./lib/composerDrop";
import { gatherContext, specialSources } from "./lib/contextClient";
import {
  addMention,
  CONTEXT_KINDS,
  type Mention,
  mentionKey,
  removeMention,
  type SavedContext,
  type SpecialMention,
  type SpecialSources,
  serializePrompt,
  specialMentions,
} from "./lib/mentions";
import {
  buildHistory,
  type HistoryNav,
  historyDown,
  historyEscape,
  historyUp,
  shouldBrowseUp,
  startNav,
} from "./lib/promptHistory";
import {
  EMPTY_QUEUE,
  editQueued,
  enqueue,
  moveQueued,
  type PromptQueue,
  pauseQueue,
  type QueuedPrompt,
  readyToSend,
  removeQueued,
  resumeQueue,
  sendDecision,
  settleInFlight,
  takeNext,
} from "./lib/promptQueue";
import { useQueueStore } from "./lib/queueStore";
import { promptWrites } from "./lib/readerDoc";
import { displayPath } from "./lib/readerView";
import {
  useClaudeActivity,
  useClaudeFooter,
  useClaudePanel,
} from "./lib/screenStore";
import type { SessionFacts } from "./lib/sessionFacts";
import {
  applySuggestion,
  type CommandSource,
  findTrigger,
  rankCommands,
  type SlashCommand,
} from "./lib/slashCommands";
import {
  beginDictation,
  type Dictation,
  dictationFinal,
  dictationPartial,
  renderDictation,
} from "./lib/speech";
import { liveWorking } from "./lib/stopControl";
import { pressStopFor, resetStopFor, useStopStore } from "./lib/stopStore";
import {
  cachedCommands,
  type FileSuggestion,
  listCommands,
  searchFiles,
} from "./lib/suggestClient";
import type { ToolCall } from "./lib/transcript";
import {
  ATTACHABLE_IMAGE_MAX_BYTES,
  ATTACHABLE_IMAGE_TYPES,
  saveDroppedImage,
  savePastedImage,
} from "./lib/transcriptClient";
import { ActionCard, answerDialog, useReaderScreen } from "./ReaderAction";
import type { ReaderContext } from "./ReaderBlocks";
import { ClaudePanelCard } from "./ReaderClaudePanel";
import { StopButton, useStopTicker } from "./ReaderStop";

/** Gap between typing a prompt and the Enter that submits it, as the AI tool uses. */
const SUBMIT_DELAY_MS = 90;
/** Gap after each attached image path, so Claude Code reads the file first. */
const ATTACH_DELAY_MS = 160;
/** The composer grows to 40% of the window, then scrolls. */
const COMPOSER_MAX_SHARE = 0.4;
const ATTACH_MAX = 6;
const QUEUE_TICK_MS = 300;
const MODE_PRESS_GAP_MS = 180;

/** Per-pane state that survives switching between Terminal and Reader. */
const drafts = new Map<number, string>();
const mentionDrafts = new Map<number, Mention[]>();
const queues = new Map<number, PromptQueue>();
const sentHistory = new Map<number, string[]>();

export type ComposerHandle = {
  focus: () => void;
  /** Appends `text` at the end of the draft and focuses the box. */
  insert: (text: string) => void;
  /** Appends a block (a quote or code) after a blank line and focuses the box after it. */
  appendBlock: (block: string) => void;
  isEmpty: () => boolean;
  /** Answers Claude's on-screen dialog for a digit or Escape; true when the key was used. */
  answer: (key: string) => boolean;
  /** Interrupts Claude (Esc), as the Stop button does. */
  stop: () => void;
  /** Sends `text` as a prompt now, or queues it while Claude works or asks something. */
  submit: (text: string) => void;
  /** Replaces the draft with `text` (Edit & re-run) and focuses the box. */
  replace: (text: string) => void;
  /** Starts or stops voice input. */
  toggleVoice: () => void;
};

const SOURCE_LABEL: Record<CommandSource, string> = {
  builtin: "Built-in",
  user: "User",
  project: "Project",
  plugin: "Plugin",
  skill: "Skill",
};

type Suggestion =
  | { kind: "command"; key: string; command: SlashCommand }
  | { kind: "special"; key: string; mention: SpecialMention }
  | { kind: "file"; key: string; file: FileSuggestion };

type Attachment = {
  id: string;
  preview: string;
  path: string | null;
  error: string | null;
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Closes one of Claude's panels (`/usage`, `/config`…) before a prompt is
 * typed, so the text lands in the prompt box instead of the panel's filter:
 * Esc, and Esc again when the first one only cleared a filter.
 */
async function closeClaudePanel(leafId: number): Promise<void> {
  const open = () => {
    const screen = leafScreenText(leafId);
    return screen !== null && parseClaudePanel(screen) !== null;
  };
  for (let press = 0; press < 3 && open(); press++) {
    if (!writeToSession(leafId, "\x1b")) return;
    const until = Date.now() + 700;
    while (Date.now() < until) {
      await delay(60);
      if (!open()) return;
    }
  }
}

let measureCanvas: CanvasRenderingContext2D | null = null;
/** Width in px of the widest line of `text` in the textarea's font. */
function measureTextWidth(text: string, style: CSSStyleDeclaration): number {
  if (!text) return 0;
  measureCanvas ??= document.createElement("canvas").getContext("2d");
  if (!measureCanvas) return 0;
  measureCanvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let widest = 0;
  for (const line of text.split("\n")) {
    widest = Math.max(widest, measureCanvas.measureText(line).width);
  }
  return widest;
}

/**
 * Types a prompt into the pane's Claude session and submits it: each image
 * path as its own paste, then the text, then Enter.
 */
export function sendPrompt(
  leafId: number,
  text: string,
  imagePaths: readonly string[] = [],
): boolean {
  const writes = promptWrites(text, imagePaths, leafBracketedPaste(leafId));
  if (writes.length === 0) return false;
  const [first, ...rest] = writes;
  if (!writeToSession(leafId, first)) return false;
  let wait = imagePaths.length > 0 ? ATTACH_DELAY_MS : 0;
  for (const write of rest) {
    setTimeout(() => writeToSession(leafId, write), wait);
    wait += ATTACH_DELAY_MS;
  }
  setTimeout(() => writeToSession(leafId, "\r"), wait + SUBMIT_DELAY_MS);
  return true;
}

/** Reads Claude's permission mode straight off the screen (not the 1 s poll). */
function readModeNow(leafId: number): PermissionMode | null {
  const screen = leafScreenText(leafId);
  return screen ? (parseClaudeFooter(screen)?.mode ?? null) : null;
}

/** Cycles Shift+Tab until Claude shows `target`; resolves to an error or null. */
async function cycleModeTo(
  leafId: number,
  target: PermissionMode,
): Promise<string | null> {
  let presses = 0;
  let misses = 0;
  for (;;) {
    const step = nextCycleStep({
      target,
      observed: readModeNow(leafId),
      presses,
      misses,
    });
    if (step.kind === "done") return null;
    if (step.kind === "fail") return step.reason;
    if (step.kind === "wait") {
      misses += 1;
      await delay(MODE_PRESS_GAP_MS);
      continue;
    }
    misses = 0;
    if (!writeToSession(leafId, SHIFT_TAB)) return "The terminal isn't ready.";
    presses += 1;
    await delay(MODE_PRESS_GAP_MS);
  }
}

function imageFiles(list: DataTransferItemList | FileList | null): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const item of Array.from<File | DataTransferItem>(list)) {
    const file =
      item instanceof File
        ? item
        : item.kind === "file"
          ? item.getAsFile()
          : null;
    if (
      file &&
      (ATTACHABLE_IMAGE_TYPES as readonly string[]).includes(file.type)
    ) {
      files.push(file);
    }
  }
  return files;
}

let queueSeq = 0;
const queueId = () => `q${Date.now().toString(36)}${(queueSeq++).toString(36)}`;

/** One queue per pane, mirrored into React state. */
function usePromptQueue(leafId: number) {
  const [queue, setQueue] = useState<PromptQueue>(
    () => queues.get(leafId) ?? EMPTY_QUEUE,
  );
  const ref = useRef(queue);
  ref.current = queue;
  const update = useCallback(
    (fn: (q: PromptQueue) => PromptQueue) => {
      const next = fn(ref.current);
      ref.current = next;
      queues.set(leafId, next);
      setQueue(next);
      useQueueStore.getState().set(leafId, next.items);
    },
    [leafId],
  );
  useEffect(() => {
    useQueueStore.getState().set(leafId, ref.current.items);
  }, [leafId]);
  return [queue, update, ref] as const;
}

export const ReaderComposer = forwardRef<
  ComposerHandle,
  {
    leafId: number;
    cwd: string | null;
    phase: AgentPhase | undefined;
    /** The linked transcript, so `@chat` doesn't offer this session itself. */
    sessionId: string | null;
    /** The tool call a permission prompt is likely about. */
    pendingTool: ToolCall | null;
    ctx: ReaderContext;
    facts: SessionFacts;
    /** This session's earlier prompts, oldest first, for ↑ history. */
    history: readonly (string | null)[];
    onSent: () => void;
    onOpenTerminal: () => void;
  }
>(function ReaderComposer(
  {
    leafId,
    cwd,
    phase,
    sessionId,
    pendingTool,
    ctx,
    facts,
    history,
    onSent,
    onOpenTerminal,
  },
  ref,
) {
  const dialog = useReaderScreen(leafId, phase, true);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const activity = useClaudeActivity(leafId);
  const footerVisible = useClaudeFooter(leafId) !== null;
  const panel = useClaudePanel(leafId);
  const activityWorking = Boolean(activity && !activity.done);
  // An open panel hides the footer but means Claude is idle, waiting on you.
  const working = liveWorking(phase, activity, footerVisible || panel !== null);

  const [text, setText] = useState(() => drafts.get(leafId) ?? "");
  const [caret, setCaret] = useState(() => (drafts.get(leafId) ?? "").length);
  const [mentions, setMentions] = useState<Mention[]>(
    () => mentionDrafts.get(leafId) ?? [],
  );
  const [error, setError] = useTransientMessage(6000);
  const [busy, setBusy] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [nav, setNav] = useState<HistoryNav | null>(null);
  const [switching, setSwitching] = useState(false);
  const [queue, updateQueue, queueRef] = usePromptQueue(leafId);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const previews = useRef(new Set<string>());
  const textRef = useRef(text);
  textRef.current = text;
  const focusArea = useCallback(() => {
    requestAnimationFrame(() => area.current?.focus());
  }, []);
  const moveCaret = (to: number) => {
    setCaret(to);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(to, to);
    });
  };
  const stop = useCallback(() => pressStopFor(leafId), [leafId]);
  useStopTicker(leafId, working);
  // Set below, once dispatch and the queue exist.
  const submitRef = useRef<(text: string) => void>(() => {});

  // One continuous dictation, written live at the caret where the mic started.
  const dictation = useRef<Dictation | null>(null);
  // The draft as dictation last wrote it; any other change ends following.
  const dictated = useRef<string | null>(null);
  const writeDictation = (next: Dictation) => {
    if (dictated.current !== null && textRef.current !== dictated.current) {
      dictation.current = null;
      dictated.current = null;
      return;
    }
    dictation.current = next;
    const { value, caret: at } = renderDictation(next);
    dictated.current = value;
    textRef.current = value;
    setText(value);
    moveCaret(at);
  };
  const endDictation = () => {
    dictation.current = null;
    dictated.current = null;
  };
  const voice = useVoiceInput({
    onStart: () => {
      const at = area.current?.selectionEnd ?? textRef.current.length;
      dictation.current = beginDictation(textRef.current, at);
      dictated.current = textRef.current;
    },
    onInterim: (partial) => {
      if (dictation.current)
        writeDictation(dictationPartial(dictation.current, partial));
    },
    onFinal: (phrase) => {
      if (dictation.current)
        writeDictation(dictationFinal(dictation.current, phrase));
    },
    focusComposer: () => area.current?.focus(),
    onProblem: (message) => setError(message),
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // biome-ignore lint/correctness/useExhaustiveDependencies: moveCaret and answerKey only touch refs and setters
  useImperativeHandle(
    ref,
    () => ({
      focus: () => area.current?.focus(),
      insert: (chunk: string) => {
        const next = textRef.current + chunk;
        setText(next);
        moveCaret(next.length);
      },
      appendBlock: (block: string) => {
        const next = appendBlock(textRef.current, block);
        textRef.current = next;
        setText(next);
        setNav(null);
        moveCaret(next.length);
      },
      isEmpty: () => textRef.current.length === 0,
      answer: (key: string) => answerKey(key),
      stop,
      submit: (text: string) => submitRef.current(text),
      replace: (next: string) => {
        setText(next);
        setNav(null);
        moveCaret(next.length);
      },
      toggleVoice: () => voiceRef.current.toggle(),
    }),
    [stop],
  );

  /** A digit or Escape answers the dialog, but only while nothing is drafted. */
  const answerKey = (key: string): boolean => {
    const current = dialogRef.current;
    if (!current || current.multiSelect) return false;
    if (textRef.current.length > 0 || count.current > 0) return false;
    const option =
      key === "Escape"
        ? current.options.find((o) => o.escape)
        : /^[1-9]$/.test(key)
          ? current.options.find((o) => o.n === Number(key))
          : undefined;
    if (!option || !answerDialog(leafId, current, option.n)) return false;
    if (option.escape) focusArea();
    return true;
  };

  const suggest = useSuggestions(text, caret, cwd, leafId, sessionId);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const count = useRef(0);
  count.current = attachments.length;
  const attach = useCallback(
    (files: File[]) => {
      const room = Math.max(0, ATTACH_MAX - count.current);
      setError(
        files.length > room ? `Up to ${ATTACH_MAX} images per message.` : null,
      );
      const update = (id: string, patch: Partial<Attachment>) =>
        setAttachments((list) =>
          list.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        );
      const added = files.slice(0, room).map((file): Attachment => {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        const tooBig = file.size > ATTACHABLE_IMAGE_MAX_BYTES;
        if (!tooBig) {
          savePastedImage(file).then(
            (path) => update(preview, { path }),
            (reason: unknown) =>
              update(preview, { error: String(reason || "Could not attach") }),
          );
        }
        return {
          id: preview,
          preview,
          path: null,
          error: tooBig ? "Larger than 12 MB" : null,
        };
      });
      count.current += added.length;
      if (added.length > 0) setAttachments((list) => [...list, ...added]);
    },
    [setError],
  );

  const detach = (id: string) => {
    setAttachments((list) => list.filter((a) => a.id !== id));
    URL.revokeObjectURL(id);
    previews.current.delete(id);
  };

  /** Images dropped from Finder: copied into the cache, previewed from disk. */
  const attachPaths = useCallback(
    (paths: string[]) => {
      const room = Math.max(0, ATTACH_MAX - count.current);
      if (paths.length > room)
        setError(`Up to ${ATTACH_MAX} images per message.`);
      const update = (id: string, patch: Partial<Attachment>) =>
        setAttachments((list) =>
          list.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        );
      const added = paths.slice(0, room).map((source, i): Attachment => {
        const id = `drop:${Date.now()}:${i}:${source}`;
        saveDroppedImage(source).then(
          (path) => update(id, { path, preview: convertFileSrc(path) }),
          (reason: unknown) =>
            update(id, { error: String(reason || "Could not attach") }),
        );
        return { id, preview: convertFileSrc(source), path: null, error: null };
      });
      count.current += added.length;
      if (added.length > 0) setAttachments((list) => [...list, ...added]);
    },
    [setError],
  );

  const dropZone = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef({ attachPaths, cwd });
  dropRef.current = { attachPaths, cwd };
  // Finder drops never reach the webview as HTML5 `drop` events (Tauri's
  // native handler takes them), so listen for Tauri's drag-drop events and
  // claim the ones that land on this composer.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // A drop anywhere on this Reader (the document or the composer) attaches here.
    const inside = (x: number, y: number) => {
      const el = dropZone.current;
      if (!el || el.offsetParent === null) return false;
      const area = el.closest<HTMLElement>("[data-terax-reader]") ?? el;
      const point = toLogicalPoint(x, y, {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      });
      if (!pointInRect(point, area.getBoundingClientRect())) return false;
      // The topmost element decides, so a Reader hidden behind another tab never claims it.
      const hit = document.elementFromPoint(point.x, point.y);
      return Boolean(hit && area.contains(hit));
    };
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragging(inside(p.position.x, p.position.y));
          return;
        }
        if (p.type === "leave") {
          setDragging(false);
          return;
        }
        if (p.type !== "drop") return;
        setDragging(false);
        if (!p.paths.length || !inside(p.position.x, p.position.y)) return;
        const { images, files, unsupported } = routeDroppedPaths(p.paths);
        const { attachPaths: attachDropped, cwd: folder } = dropRef.current;
        if (images.length > 0) attachDropped(images);
        if (files.length > 0) {
          setMentions((list) =>
            files.reduce((acc, path) => {
              const ref = dropMentionRef(path, folder);
              return addMention(acc, { kind: "file", label: ref, ref });
            }, list),
          );
        }
        if (unsupported.length > 0) {
          setError(
            "HEIC and TIFF images can't be attached. Export them as PNG or JPEG first.",
          );
        }
        focusArea();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* No Tauri webview (tests): Finder drops stay unavailable. */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [focusArea, setError]);

  useEffect(() => {
    if (text) drafts.set(leafId, text);
    else drafts.delete(leafId);
  }, [leafId, text]);
  useEffect(() => {
    if (mentions.length > 0) mentionDrafts.set(leafId, mentions);
    else mentionDrafts.delete(leafId);
  }, [leafId, mentions]);

  const rowRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [multiline, setMultiline] = useState(() => text.includes("\n"));
  // One line keeps the controls at the right end of the text row; a draft that
  // wraps (or has a newline) gets the full width with the controls below it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const controls = controlsRef.current;
      const el = area.current;
      if (!row || !controls || !el) return;
      const style = getComputedStyle(el);
      const padding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const oneLine = row.clientWidth - controls.offsetWidth - 8 - padding;
      const width = measureTextWidth(textRef.current, style);
      setMultiline(needsMultiline(textRef.current, width, oneLine));
    };
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [text]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text or layout changes
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * COMPOSER_MAX_SHARE))}px`;
  }, [text, multiline]);

  /** Gathers any context attachments and types the prompt into Claude. */
  const dispatch = useCallback(
    async (item: Pick<QueuedPrompt, "text" | "mentions" | "images">) => {
      const contexts: SavedContext[] = [];
      const needed = item.mentions.filter((m) => CONTEXT_KINDS.has(m.kind));
      if (needed.length > 0) setBusy("Attaching context…");
      try {
        for (const m of needed) {
          const saved = await gatherContext(m, cwd);
          if (saved) contexts.push(saved);
        }
      } catch (reason) {
        setBusy(null);
        setError(`Couldn't attach context: ${String(reason)}`);
        return false;
      }
      setBusy(null);
      const prompt = serializePrompt(item.text, item.mentions, contexts);
      if (!prompt && item.images.length === 0) return false;
      await closeClaudePanel(leafId);
      if (!sendPrompt(leafId, prompt, item.images)) {
        setError("The terminal isn't ready. Open it and try again.");
        return false;
      }
      resetStopFor(leafId);
      onSent();
      return true;
    },
    [cwd, leafId, onSent, setError],
  );

  // The queue goes out one message at a time once Claude has settled.
  const idleSince = useRef<number | null>(null);
  const idle = !working && !dialog;
  useEffect(() => {
    if (!idle) idleSince.current = null;
    else if (idleSince.current === null) idleSince.current = Date.now();
  }, [idle]);
  useEffect(() => {
    updateQueue((q) => settleInFlight(q, phase));
  }, [phase, updateQueue]);
  // A manual Stop holds the queue until the user resumes it.
  const manualStops = useStopStore((s) => s.stops[leafId] ?? 0);
  const seenStops = useRef(manualStops);
  useEffect(() => {
    if (manualStops === seenStops.current) return;
    seenStops.current = manualStops;
    updateQueue((q) => (q.items.length > 0 ? pauseQueue(q) : q));
  }, [manualStops, updateQueue]);
  const hasQueued = queue.items.length > 0;
  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const ready = readyToSend(queueRef.current, {
        phase,
        dialog: dialogRef.current !== null,
        activityWorking,
        idleSince: idleSince.current,
        now,
      });
      if (!ready) return;
      const { queue: next, item } = takeNext(queueRef.current, now);
      updateQueue(() => next);
      idleSince.current = null;
      if (item) void dispatch(item);
    }, QUEUE_TICK_MS);
    return () => clearInterval(timer);
  }, [hasQueued, phase, activityWorking, dispatch, updateQueue, queueRef]);

  const uploading = attachments.some((a) => !a.path && !a.error);
  const paths = attachments.flatMap((a) => (a.path ? [a.path] : []));
  const canSend =
    !uploading &&
    busy === null &&
    (text.trim().length > 0 || paths.length > 0 || mentions.length > 0);

  const clearComposer = () => {
    setText("");
    setCaret(0);
    setMentions([]);
    setNav(null);
    for (const a of attachments) {
      URL.revokeObjectURL(a.preview);
      previews.current.delete(a.preview);
    }
    setAttachments([]);
  };

  /** Enter queues while Claude works; `steer` (Cmd+Enter) sends right away. */
  /**
   * Enter queues while Claude works; `steer` (Cmd+Enter) sends right away. A
   * question on screen always queues the message until it's answered: typed
   * text would land on Claude's menu and Enter would pick an answer.
   */
  const send = (steer: boolean) => {
    if (!canSend) return;
    if (voice.state === "listening") voice.stop();
    const item = {
      text: text.trim(),
      mentions,
      images: paths,
    };
    if (item.text) {
      const sent = sentHistory.get(leafId) ?? [];
      sentHistory.set(leafId, [...sent, item.text].slice(-100));
    }
    clearComposer();
    setError(null);
    focusArea();
    const decision = sendDecision({
      working,
      dialog: dialogRef.current !== null,
      steer,
    });
    if (decision !== "send") {
      updateQueue((q) =>
        enqueue(q, {
          id: queueId(),
          ...item,
          afterDialog: decision === "queueAfterDialog",
        }),
      );
      return;
    }
    void dispatch(item);
  };

  submitRef.current = (prompt: string) => {
    const item = { text: prompt.trim(), mentions: [], images: [] };
    if (!item.text) return;
    setError(null);
    const decision = sendDecision({
      working,
      dialog: dialogRef.current !== null,
      steer: false,
    });
    if (decision !== "send") {
      updateQueue((q) =>
        enqueue(q, {
          id: queueId(),
          ...item,
          afterDialog: decision === "queueAfterDialog",
        }),
      );
      return;
    }
    void dispatch(item);
  };

  const pickModel = (alias: string) => {
    const command = modelCommand(alias);
    if (!command) {
      setError("A model id is a single word, like opus or sonnet[1m].");
      return;
    }
    if (working || dialogRef.current) {
      updateQueue((q) =>
        enqueue(q, { id: queueId(), text: command, mentions: [], images: [] }),
      );
      return;
    }
    if (!sendPrompt(leafId, command)) setError("The terminal isn't ready.");
  };

  const pickMode = (target: PermissionMode) => {
    if (switching || readModeNow(leafId) === target) return;
    setSwitching(true);
    void cycleModeTo(leafId, target).then((problem) => {
      setSwitching(false);
      if (problem) setError(problem);
    });
  };

  const accept = (item: Suggestion, viaTab = false) => {
    const trigger = suggest.trigger;
    if (!trigger) return;
    if (item.kind === "command") {
      const next = applySuggestion(text, trigger, item.command.name);
      setText(next.text);
      moveCaret(next.caret);
      return;
    }
    // Tab on a folder keeps searching inside it.
    if (item.kind === "file" && item.file.isDir && viaTab) {
      const next = applySuggestion(text, trigger, item.file.rel, {
        folder: true,
      });
      setText(next.text);
      moveCaret(next.caret);
      return;
    }
    const mention: Mention =
      item.kind === "special"
        ? {
            kind: item.mention.kind,
            label: item.mention.label,
            ref: item.mention.ref,
          }
        : {
            kind: item.file.isDir ? "folder" : "file",
            label: item.file.rel,
            ref: item.file.rel,
          };
    setMentions((list) => addMention(list, mention));
    const without = text.slice(0, trigger.start) + text.slice(trigger.end);
    setText(without);
    moveCaret(trigger.start);
  };

  const insertAt = () => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const pad = before.length > 0 && !/\s$/u.test(before) ? " " : "";
    const next = `${before}${pad}@${text.slice(at)}`;
    setText(next);
    moveCaret(at + pad.length + 1);
  };

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart);

  const status = error ? (
    <span className="text-[var(--terminal-ansi-red)]">{error}</span>
  ) : busy ? (
    <span>{busy}</span>
  ) : uploading ? (
    <span>Attaching image…</span>
  ) : switching ? (
    <span>Switching mode…</span>
  ) : null;

  return (
    <div className="terax-reader-dock relative shrink-0 pb-3">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent"
      />
      <div className="terax-reader-composer terax-reader-column relative flex flex-col gap-2">
        {suggest.open && (
          <SuggestionPopup
            suggest={suggest}
            onPick={(item) => accept(item)}
            folder={cwd ? displayPath(cwd, null, null) : null}
          />
        )}
        {dialog && (
          <ActionCard
            leafId={leafId}
            dialog={dialog}
            pending={pendingTool}
            ctx={ctx}
            onOpenTerminal={onOpenTerminal}
            onAnswered={() => focusArea()}
          />
        )}
        {!dialog && panel && (
          <ClaudePanelCard
            leafId={leafId}
            panel={panel}
            onOpenTerminal={onOpenTerminal}
            onClosed={focusArea}
          />
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for images; the textarea and buttons stay the controls */}
        <div
          ref={dropZone}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            setDragging(false);
            const files = imageFiles(e.dataTransfer.files);
            if (files.length === 0) return;
            e.preventDefault();
            attach(files);
          }}
          className={cn(
            "flex flex-col gap-1.5 rounded-[14px] border border-border/70 bg-card px-2 py-1.5 shadow-[0_8px_28px_-18px_rgba(0,0,0,0.7)] transition-colors focus-within:border-primary/55 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_16%,transparent)]",
            dragging &&
              "border-primary/70 bg-[color-mix(in_oklab,var(--primary)_7%,var(--card))]",
          )}
        >
          <QueueChips
            items={queue.items}
            paused={queue.paused}
            onResume={() => updateQueue(resumeQueue)}
            onEdit={(id, value) => updateQueue((q) => editQueued(q, id, value))}
            onRemove={(id) => updateQueue((q) => removeQueued(q, id))}
            onMove={(id, d) => updateQueue((q) => moveQueued(q, id, d))}
            onSendNow={(id) => {
              const item = queueRef.current.items.find((i) => i.id === id);
              if (!item) return;
              updateQueue((q) => removeQueued(q, id));
              void dispatch(item);
            }}
          />
          {status && (
            <div className="px-0.5 text-[11px] text-muted-foreground">
              {status}
            </div>
          )}
          <MentionPills
            mentions={mentions}
            onRemove={(key) => setMentions((list) => removeMention(list, key))}
          />
          {attachments.length > 0 && (
            <ul
              className="flex flex-wrap gap-2 pt-1"
              aria-label="Attached images"
            >
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    "group/att relative size-14 overflow-hidden rounded-lg border bg-background/60",
                    a.error
                      ? "border-[var(--terminal-ansi-red)]"
                      : "border-border/70",
                  )}
                  title={a.error ?? a.path ?? "Attaching…"}
                >
                  <img
                    src={a.preview}
                    alt="Attached"
                    className={cn(
                      "h-full w-full object-cover",
                      (!a.path || a.error) && "opacity-50",
                    )}
                    draggable={false}
                  />
                  {!a.path && !a.error && (
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    </span>
                  )}
                  {a.error && (
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[9px] text-[var(--terminal-ansi-red)]">
                      Failed
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => detach(a.id)}
                    aria-label="Remove image"
                    className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 outline-none transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={11}
                      strokeWidth={2.4}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div
            ref={rowRef}
            data-multiline={multiline ? "" : undefined}
            className="terax-composer-row flex flex-wrap items-end gap-x-1.5 gap-y-1"
          >
            <textarea
              ref={area}
              value={text}
              rows={1}
              onChange={(e) => {
                setText(e.target.value);
                syncCaret(e.target);
                if (nav) setNav(null);
              }}
              onSelect={(e) => syncCaret(e.currentTarget)}
              onClick={(e) => syncCaret(e.currentTarget)}
              onBlur={() => suggest.dismiss()}
              aria-autocomplete="list"
              aria-controls={suggest.open ? "reader-suggestions" : undefined}
              aria-activedescendant={
                suggest.open && suggest.items[suggest.active]
                  ? `reader-suggestion-${suggest.active}`
                  : undefined
              }
              onPointerDown={() => {
                if (voice.state !== "listening") return;
                voice.stop();
                endDictation();
              }}
              onPaste={(e) => {
                const files = imageFiles(e.clipboardData.items);
                if (files.length === 0) return;
                // Keep any text that came with the image; only the image is taken over.
                if (!e.clipboardData.getData("text/plain")) e.preventDefault();
                attach(files);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                const mod = e.metaKey || e.ctrlKey;
                if (mod && e.key === ".") {
                  e.preventDefault();
                  stop();
                  return;
                }
                if (mod && e.shiftKey && e.code === "Space") {
                  e.preventDefault();
                  voice.toggle();
                  return;
                }
                if (e.key === "Escape" && voice.state === "listening") {
                  e.preventDefault();
                  e.stopPropagation();
                  voice.stop();
                  return;
                }
                // Typing or moving the caret takes over from dictation; what was heard stays.
                if (
                  voice.state === "listening" &&
                  !["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(
                    e.key,
                  )
                ) {
                  voice.stop();
                  endDictation();
                }
                if (suggest.open) {
                  const n = suggest.items.length;
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    suggest.dismiss();
                    return;
                  }
                  if (n > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                    e.preventDefault();
                    suggest.move(e.key === "ArrowDown" ? 1 : -1);
                    return;
                  }
                  if (
                    n > 0 &&
                    (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))
                  ) {
                    e.preventDefault();
                    accept(
                      suggest.items[suggest.active] ?? suggest.items[0],
                      e.key === "Tab",
                    );
                    return;
                  }
                }
                if (e.key === "ArrowUp" && !mod && !e.shiftKey && !e.altKey) {
                  const el = e.currentTarget;
                  if (shouldBrowseUp(text, el.selectionStart, nav !== null)) {
                    const entries = buildHistory(
                      history,
                      sentHistory.get(leafId) ?? [],
                    );
                    const step = historyUp(nav ?? startNav(entries, text));
                    if (step) {
                      e.preventDefault();
                      setNav(step.nav);
                      setText(step.text);
                      moveCaret(step.text.length);
                    }
                    return;
                  }
                }
                if (e.key === "ArrowDown" && nav && !mod && !e.shiftKey) {
                  const step = historyDown(nav);
                  if (step) {
                    e.preventDefault();
                    setNav(step.nav.index === null ? null : step.nav);
                    setText(step.text);
                    moveCaret(step.text.length);
                  }
                  return;
                }
                if (e.key === "Escape" && nav) {
                  e.preventDefault();
                  e.stopPropagation();
                  const back = historyEscape(nav);
                  setNav(null);
                  setText(back.text);
                  moveCaret(back.text.length);
                  return;
                }
                if (
                  (e.key === "Escape" || /^[1-9]$/.test(e.key)) &&
                  !mod &&
                  !e.altKey &&
                  answerKey(e.key)
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                if (e.key !== "Enter") return;
                if (e.shiftKey && !mod) return;
                e.preventDefault();
                send(mod);
              }}
              placeholder={
                attachments.length > 0
                  ? "Add a message, or send the images…"
                  : dialog
                    ? "Type a message; it waits until you answer Claude above…"
                    : panel
                      ? "Use Claude's panel above, or send a message to close it…"
                      : working
                        ? "Queue a follow-up, or ⌘Enter to steer now…"
                        : phase === "attention"
                          ? "Claude is waiting for your message…"
                          : "Message Claude…"
              }
              aria-label="Message Claude"
              className={cn(
                "min-h-[28px] min-w-0 flex-1 resize-none self-center bg-transparent px-1.5 py-1 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/80",
                multiline && "basis-full",
              )}
            />
            <div
              key={multiline ? "multi" : "single"}
              ref={controlsRef}
              className="terax-composer-controls ml-auto flex shrink-0 items-center gap-0.5 pb-0.5"
            >
              <input
                ref={filePicker}
                type="file"
                accept={ATTACHABLE_IMAGE_TYPES.join(",")}
                multiple
                hidden
                onChange={(e) => {
                  attach(imageFiles(e.target.files));
                  e.target.value = "";
                  focusArea();
                }}
              />
              <IconTool
                label="Attach images"
                icon={ImageAdd01Icon}
                onClick={() => filePicker.current?.click()}
              />
              <IconTool
                label="Add context (@)"
                icon={AtIcon}
                onClick={insertAt}
              />
              <MicButton
                state={voice.state}
                lang={voice.lang}
                onToggle={voice.toggle}
                onLang={voice.setLang}
              />
              <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />
              <ModelPicker
                current={facts.model}
                onPick={pickModel}
                onAfterClose={focusArea}
              />
              <ModePicker
                current={facts.mode}
                switching={switching}
                onPick={pickMode}
                onAfterClose={focusArea}
              />
              <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />
              <span className="flex items-center gap-1.5">
                <ContextMiniMeter percent={facts.contextPercent} />
                <StopButton leafId={leafId} working={working} />
                <button
                  type="button"
                  onClick={() => send(false)}
                  disabled={!canSend}
                  aria-label={working || dialog ? "Queue message" : "Send"}
                  title={
                    dialog
                      ? "Queue until you answer Claude (Enter)"
                      : working
                        ? "Queue (Enter) · ⌘Enter steers now · ⌘. stops"
                        : "Send (Enter) · ⇧Enter new line · ↑ history · / commands · @ context"
                  }
                  className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-35"
                >
                  <HugeiconsIcon icon={SentIcon} size={15} strokeWidth={2} />
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function IconTool({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof File01Icon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/45"
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
    </button>
  );
}

const MENTION_DEBOUNCE_MS = 120;

/** The composer's `/` and `@` autocomplete state for `text` at `caret`. */
function useSuggestions(
  text: string,
  caret: number,
  cwd: string | null,
  leafId: number,
  sessionId: string | null,
) {
  const trigger = useMemo(() => findTrigger(text, caret), [text, caret]);
  const key = trigger ? `${trigger.kind}:${trigger.start}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = trigger !== null && dismissed !== key;
  const [commands, setCommands] = useState(() => cachedCommands(cwd));
  const [files, setFiles] = useState<FileSuggestion[]>([]);
  const [sources, setSources] = useState<SpecialSources | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);

  const slashOpen = open && trigger?.kind === "slash";
  useEffect(() => {
    if (!slashOpen) return;
    let alive = true;
    void listCommands(cwd).then((list) => {
      if (alive) setCommands(list);
    });
    return () => {
      alive = false;
    };
  }, [slashOpen, cwd]);

  const mentionOpen = open && trigger?.kind === "mention";
  useEffect(() => {
    if (!mentionOpen) return;
    let alive = true;
    void specialSources(leafId, cwd, sessionId)
      .then((s) => {
        if (alive) setSources(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mentionOpen, leafId, cwd, sessionId]);

  const mentionQuery =
    open && trigger?.kind === "mention" ? trigger.query : null;
  useEffect(() => {
    if (mentionQuery === null || !cwd || mentionQuery.length === 0) {
      setFiles([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchFiles(cwd, mentionQuery)
        .then((hits) => {
          if (alive && hits) setFiles(hits);
        })
        .catch(() => {
          if (alive) setFiles([]);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, MENTION_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mentionQuery, cwd]);

  const items = useMemo<Suggestion[]>(() => {
    if (!open || !trigger) return [];
    if (trigger.kind === "slash") {
      return rankCommands(trigger.query, commands).map((command) => ({
        kind: "command",
        key: `c:${command.name}`,
        command,
      }));
    }
    const specials: Suggestion[] = sources
      ? specialMentions(trigger.query, sources).map((mention) => ({
          kind: "special",
          key: `s:${mentionKey(mention)}`,
          mention,
        }))
      : [];
    const fileItems: Suggestion[] = files.map((file) => ({
      kind: "file",
      key: `f:${file.rel}`,
      file,
    }));
    return [...specials, ...fileItems];
  }, [open, trigger, commands, files, sources]);

  const query = trigger?.query ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query or list restarts the selection
  useEffect(() => setActive(0), [key, query, items.length]);

  return {
    trigger,
    open,
    items,
    active,
    searching,
    setActive,
    move: (delta: number) =>
      setActive((i) =>
        items.length === 0 ? 0 : (i + delta + items.length) % items.length,
      ),
    dismiss: () => setDismissed(key),
    hasFolder: cwd !== null,
  };
}

function SuggestionPopup({
  suggest,
  onPick,
  folder,
}: {
  suggest: ReturnType<typeof useSuggestions>;
  onPick: (item: Suggestion) => void;
  folder: string | null;
}) {
  const { trigger, items, active } = suggest;
  useEffect(() => {
    document
      .getElementById(`reader-suggestion-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!trigger) return null;
  const mention = trigger.kind === "mention";
  const empty = mention
    ? !suggest.hasFolder
      ? "This session has no folder to search."
      : trigger.query.length === 0
        ? `Type to search files in ${folder ?? "this folder"}`
        : suggest.searching
          ? "Searching…"
          : "No matching files or context"
    : "No matching commands";
  const firstFile = items.findIndex((i) => i.kind === "file");
  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-[0_18px_40px_-16px_rgba(0,0,0,0.75)]">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <HugeiconsIcon
          icon={mention ? AtIcon : SlashIcon}
          size={12}
          strokeWidth={2}
        />
        {mention ? "Context" : "Commands"}
        <span className="ml-auto font-normal normal-case tracking-normal">
          ↑↓ choose · Enter add{mention ? " · Tab opens a folder" : ""} · Esc
          close
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-[12.5px] text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div
          id="reader-suggestions"
          role="listbox"
          aria-label={mention ? "Context" : "Commands"}
          className="max-h-[300px] overflow-y-auto p-1"
        >
          {items.map((item, index) => (
            <div key={item.key}>
              {mention && index === firstFile && firstFile > 0 && (
                <div className="mx-2 my-1 border-t border-border/60" />
              )}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the textarea owns the keyboard (aria-activedescendant) */}
              <div
                id={`reader-suggestion-${index}`}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => suggest.setActive(index)}
                onClick={() => onPick(item)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                  index === active
                    ? "bg-primary/15 text-foreground"
                    : "text-foreground/90",
                )}
              >
                {item.kind === "command" ? (
                  <>
                    <span className="terax-reader-mono shrink-0 text-[12.5px] font-semibold text-primary">
                      /{item.command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                      {item.command.description}
                    </span>
                    <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground">
                      {SOURCE_LABEL[item.command.source]}
                    </span>
                  </>
                ) : item.kind === "special" ? (
                  <>
                    <HugeiconsIcon
                      icon={MENTION_ICON[item.mention.kind]}
                      size={13}
                      className="shrink-0 text-primary"
                    />
                    <span className="min-w-0 shrink-0 truncate text-[12.5px] font-medium">
                      {item.mention.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                      {item.mention.detail}
                    </span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={item.file.isDir ? Folder01Icon : File01Icon}
                      size={13}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="terax-reader-mono min-w-0 flex-1 truncate text-[12.5px]">
                      {item.file.rel}
                      {item.file.isDir ? "/" : ""}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
