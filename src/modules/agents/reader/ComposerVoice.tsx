import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  Mic01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { info as logInfo } from "@tauri-apps/plugin-log";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  applyNativeSpeechEvent,
  describeNativeStartError,
  type NativeSpeechEvent,
  PendingSpeechEvents,
  pickSpeechLanguage,
  SPEECH_LANGUAGES,
  type SpeechProblem,
  webSpeechFailed,
} from "./lib/speech";

/** The parts of the Web Speech API the composer uses. */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Writes a voice step to Terax.log; never throws (tests have no log plugin). */
function voiceLog(message: string): void {
  try {
    void logInfo(`voice: ${message}`).catch(() => undefined);
  } catch {
    /* No Tauri bridge. */
  }
}

const LANG_KEY = "terax:reader-speech-lang";

function readLang(): string {
  try {
    return (
      localStorage.getItem(LANG_KEY) ?? pickSpeechLanguage(navigator.language)
    );
  } catch {
    return pickSpeechLanguage(navigator.language);
  }
}

export type VoiceState = "idle" | "listening" | "dictation";

type Engine = "native" | "web" | "dictation";

/* The latest voice problem, shown by the mic button with an "Open settings" action. */
let problem: SpeechProblem | null = null;
const problemListeners = new Set<() => void>();
function setVoiceProblem(next: SpeechProblem | null) {
  problem = next;
  for (const l of problemListeners) l();
}
function useVoiceProblem() {
  return useSyncExternalStore(
    (l) => {
      problemListeners.add(l);
      return () => problemListeners.delete(l);
    },
    () => problem,
  );
}

type Permission = { speech: string; microphone: string };

/**
 * Speech to text for the composer. Tries, in order: native macOS speech
 * recognition (one continuous session: live partials, each finished
 * utterance committed as you go), the webview's Web Speech API (only if it
 * actually hears something), then macOS Dictation in the focused composer.
 * Never sends anything.
 */
export function useVoiceInput({
  onStart,
  onInterim,
  onFinal,
  focusComposer,
  onProblem,
}: {
  /** A session is about to deliver text; called before any interim or final. */
  onStart?: () => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** Focuses the composer's text box (Dictation types into the focused field). */
  focusComposer: () => void;
  onProblem: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [lang, setLangState] = useState(readLang);
  const recognition = useRef<Recognition | null>(null);
  const nativeSession = useRef<number | null>(null);
  const pending = useRef(new PendingSpeechEvents());
  const engine = useRef<Engine | null>(null);
  // Latest partial not yet committed; a stopped session may end with an empty final.
  const lastInterim = useRef("");
  const cbs = useRef({ onStart, onInterim, onFinal, onProblem });
  cbs.current = { onStart, onInterim, onFinal, onProblem };

  const setLang = (code: string) => {
    setLangState(code);
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      /* Per-viewer convenience only. */
    }
  };

  const report = useCallback((p: SpeechProblem) => {
    setVoiceProblem(p);
    cbs.current.onProblem(p.message);
  }, []);

  // Applies one native recogniser event for the session this composer started.
  const handleNative = useCallback(
    (payload: NativeSpeechEvent) => {
      const update = applyNativeSpeechEvent(
        nativeSession.current,
        payload,
        lastInterim.current,
      );
      if (!update) return;
      if (payload.kind === "partial")
        lastInterim.current = update.interim ?? "";
      if (update.interim !== undefined) cbs.current.onInterim(update.interim);
      if (update.commit) {
        lastInterim.current = "";
        cbs.current.onFinal(update.commit);
      }
      if (update.problem) report(update.problem);
      if (update.ended) {
        nativeSession.current = null;
        if (engine.current === "native") engine.current = null;
        setState((s) => (s === "listening" ? "idle" : s));
      }
    },
    [report],
  );

  // The recogniser can fail and end before `speech_start` returns its id;
  // hold those events and replay them once the id is known.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<NativeSpeechEvent>("terax:speech", (event) => {
      if (nativeSession.current === null && pending.current.hold(event.payload))
        return;
      handleNative(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* No Tauri event bridge (tests): native speech stays unavailable. */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleNative]);

  const startDictation = useCallback(async () => {
    focusComposer();
    await new Promise((r) => requestAnimationFrame(r));
    const started = await invoke<boolean>("app_start_dictation").catch(
      () => false,
    );
    voiceLog(`dictation fallback started=${started}`);
    if (started) {
      engine.current = "dictation";
      setState("dictation");
      // Dictation runs on its own; the button just reflects that it was asked.
      setTimeout(() => setState((s) => (s === "dictation" ? "idle" : s)), 4000);
    } else {
      report({
        message:
          "Voice input isn't available. Allow Terax under Privacy & Security → Microphone and Speech Recognition, or turn on Dictation in System Settings → Keyboard.",
        settings: "microphone",
      });
    }
  }, [focusComposer, report]);

  const startWebSpeech = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      voiceLog("web speech unavailable");
      void startDictation();
      return;
    }
    let r: Recognition;
    try {
      r = new Ctor();
    } catch (err) {
      voiceLog(`web speech constructor failed: ${String(err)}`);
      void startDictation();
      return;
    }
    const startedAt = Date.now();
    let gotResult = false;
    let lastError: string | undefined;
    const settle = () => {
      if (recognition.current !== r) return;
      recognition.current = null;
      engine.current = null;
      cbs.current.onInterim("");
      setState("idle");
      voiceLog(
        `web speech ended after ${Date.now() - startedAt}ms result=${gotResult} error=${lastError ?? "none"}`,
      );
      if (
        webSpeechFailed({
          startedAt,
          endedAt: Date.now(),
          gotResult,
          error: lastError,
        })
      ) {
        void startDictation();
      }
    };
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      gotResult = true;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) cbs.current.onFinal(text);
        else interim += text;
      }
      cbs.current.onInterim(interim);
    };
    r.onerror = (event) => {
      lastError = event.error;
    };
    r.onend = settle;
    try {
      cbs.current.onStart?.();
      r.start();
      recognition.current = r;
      engine.current = "web";
      setState("listening");
      focusComposer();
    } catch {
      void startDictation();
    }
  }, [lang, startDictation, focusComposer]);

  const startNative = useCallback(async (): Promise<boolean> => {
    let perms: Permission;
    try {
      perms = await invoke<Permission>("speech_permission_status");
    } catch (err) {
      voiceLog(`native status unavailable: ${String(err)}`);
      return false;
    }
    voiceLog(`native status speech=${perms.speech} mic=${perms.microphone}`);
    if (perms.speech === "unsupported") return false;
    if (
      perms.speech === "notDetermined" ||
      perms.microphone === "notDetermined"
    ) {
      perms = await invoke<Permission>("speech_request_permission").catch(
        (err) => {
          voiceLog(`native permission request failed: ${String(err)}`);
          return perms;
        },
      );
    }
    pending.current.begin();
    try {
      const id = await invoke<number>("speech_start", { lang });
      voiceLog(`native started session ${id}`);
      lastInterim.current = "";
      cbs.current.onStart?.();
      nativeSession.current = id;
      engine.current = "native";
      setVoiceProblem(null);
      setState("listening");
      focusComposer();
      for (const held of pending.current.release(id)) handleNative(held);
      return true;
    } catch (err) {
      pending.current.release(null);
      voiceLog(`native start failed: ${String(err)}`);
      const p = describeNativeStartError(String(err));
      if (!p) return false;
      report(p);
      return true; // a real answer (e.g. permission denied): don't fall through
    }
  }, [lang, focusComposer, report, handleNative]);

  const stop = useCallback(() => {
    if (engine.current === "native") {
      // The final transcript and an `end` event follow; keep the session id
      // so the final still lands in the composer.
      void invoke("speech_stop").catch(() => undefined);
    }
    const r = recognition.current;
    recognition.current = null;
    r?.stop();
    if (engine.current !== "native") cbs.current.onInterim("");
    engine.current = null;
    setState("idle");
  }, []);

  const start = useCallback(() => {
    setVoiceProblem(null);
    void startNative().then((handled) => {
      if (!handled) startWebSpeech();
    });
  }, [startNative, startWebSpeech]);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else start();
  }, [state, start, stop]);

  useEffect(
    () => () => {
      recognition.current?.abort();
      if (nativeSession.current !== null) {
        void invoke("speech_stop").catch(() => undefined);
      }
    },
    [],
  );

  return { state, toggle, stop, lang, setLang };
}

/** A small card above the mic explaining why voice can't run, with a way to fix it. */
function VoiceProblemCard() {
  const p = useVoiceProblem();
  if (!p) return null;
  return (
    <div
      role="alert"
      className="absolute bottom-full left-0 z-[60] mb-2 w-72 rounded-xl border border-border/70 bg-popover p-3 text-[12px] leading-relaxed text-popover-foreground shadow-lg"
    >
      <p className="text-muted-foreground">{p.message}</p>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setVoiceProblem(null)}
          className="rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          Dismiss
        </button>
        {p.settings && (
          <button
            type="button"
            onClick={() => {
              void invoke("speech_open_settings", { pane: p.settings }).catch(
                () => undefined,
              );
              setVoiceProblem(null);
            }}
            className="rounded-md bg-primary/15 px-2 py-1 text-[11.5px] font-medium text-primary hover:bg-primary/25"
          >
            {p.settings === "keyboard"
              ? "Open Keyboard settings"
              : "Open settings"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The mic button with its language menu. */
export function MicButton({
  state,
  lang,
  onToggle,
  onLang,
}: {
  state: VoiceState;
  lang: string;
  onToggle: () => void;
  onLang: (code: string) => void;
}) {
  const listening = state === "listening";
  return (
    <span className="relative flex items-center">
      <VoiceProblemCard />
      {listening && (
        <span
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-1/2 z-[55] mb-1.5 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/30 bg-popover px-2 py-0.5 text-[11px] font-medium text-primary shadow-sm"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          Listening…
          <span className="font-normal text-muted-foreground">Esc to stop</span>
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={listening}
        title={
          listening
            ? "Listening… click or Esc to stop"
            : "Voice input (⌘⇧Space)"
        }
        aria-label={listening ? "Stop voice input" : "Voice input"}
        className={cn(
          "relative grid size-7 place-items-center rounded-l-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
          listening && "bg-primary/15 text-primary",
          state === "dictation" && "text-primary",
        )}
      >
        {listening && (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-lg border border-primary/50 motion-reduce:animate-none"
          />
        )}
        <HugeiconsIcon icon={Mic01Icon} size={14} strokeWidth={1.9} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Voice language"
            title="Voice language"
            className="grid h-7 w-4 place-items-center rounded-r-lg text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2.2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="z-[1000] w-52 rounded-2xl"
        >
          <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            Voice language
          </DropdownMenuLabel>
          {SPEECH_LANGUAGES.map((l) => (
            <DropdownMenuItem
              key={l.code}
              onSelect={() => onLang(l.code)}
              className="rounded-xl"
            >
              <span className="flex-1 text-[13px]">{l.label}</span>
              {lang === l.code && (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={14}
                  className="text-primary"
                />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
