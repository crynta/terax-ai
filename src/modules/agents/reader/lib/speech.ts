/**
 * Tidies recognised speech before it lands in the composer: spoken
 * punctuation words, spacing around punctuation, a capital at the start of
 * each sentence, and a single space when joining onto existing text.
 */

const SPOKEN: [RegExp, string][] = [
  [/\s*\b(?:full stop|period)\b/giu, "."],
  [/\s*\bcomma\b/giu, ","],
  [/\s*\bquestion mark\b/giu, "?"],
  [/\s*\bexclamation (?:mark|point)\b/giu, "!"],
  [/\s*\bcolon\b/giu, ":"],
  [/\s*\bsemicolon\b/giu, ";"],
  [/\s*\b(?:new line|newline)\b\s*/giu, "\n"],
  [/\s*\bnew paragraph\b\s*/giu, "\n\n"],
];

/** Speech-recognition languages offered next to the mic. */
export const SPEECH_LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "en-US", label: "English (US)" },
  { code: "hi-IN", label: "Hindi" },
] as const;

/** The best offered language for `preferred` (navigator.language), else en-US. */
export function pickSpeechLanguage(preferred: string | undefined): string {
  const want = (preferred ?? "").toLowerCase();
  const exact = SPEECH_LANGUAGES.find((l) => l.code.toLowerCase() === want);
  if (exact) return exact.code;
  const base = want.split("-")[0];
  const sameBase = SPEECH_LANGUAGES.find((l) =>
    l.code.toLowerCase().startsWith(`${base}-`),
  );
  return sameBase?.code ?? "en-US";
}

/** One recognised phrase, cleaned. `startsSentence` capitalises its first letter. */
export function cleanTranscript(raw: string, startsSentence = true): string {
  let text = raw.replace(/[ \t]+/gu, " ").trim();
  if (!text) return "";
  for (const [pattern, mark] of SPOKEN) text = text.replace(pattern, mark);
  text = text
    // No space before punctuation, one after it (unless at a line end).
    .replace(/[ \t]+([.,!?;:])/gu, "$1")
    .replace(/([.,!?;:])(?=[^\s.,!?;:\n])/gu, "$1 ")
    .replace(/ *\n */gu, "\n")
    // Capitalise after sentence ends and line breaks.
    .replace(
      /([.!?]\s+|\n)(\p{Ll})/gu,
      (_m, gap: string, ch: string) => `${gap}${ch.toUpperCase()}`,
    )
    .replace(/\bi\b/gu, "I")
    .trim();
  if (startsSentence) text = text.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
  return text;
}

/** How long Web Speech gets to produce a first result before it counts as broken. */
export const WEB_SPEECH_PROBE_MS = 2000;

/**
 * Whether a Web Speech session that just ended failed, so the next engine
 * should be tried. WKWebView often exposes the API but ends it at once
 * without asking for the microphone; that silent, result-less early end is a
 * failure too, not just an error event.
 */
export function webSpeechFailed(session: {
  startedAt: number;
  endedAt: number;
  gotResult: boolean;
  error?: string;
}): boolean {
  if (session.gotResult) return false;
  if (session.error && session.error !== "aborted") return true;
  return session.endedAt - session.startedAt < WEB_SPEECH_PROBE_MS;
}

/** An update from the native recogniser (`terax:speech`). */
export type NativeSpeechEvent = {
  session: number;
  kind: "partial" | "final" | "error" | "end";
  text?: string;
  error?: string;
};

/** What a native event does to the composer, or null when it belongs to another session. */
export type NativeSpeechUpdate = {
  interim?: string;
  commit?: string;
  problem?: SpeechProblem;
  ended?: boolean;
};

export function applyNativeSpeechEvent(
  activeSession: number | null,
  event: NativeSpeechEvent,
  /** The latest uncommitted partial: macOS often finishes a stopped session with an empty final. */
  lastInterim = "",
): NativeSpeechUpdate | null {
  if (activeSession === null || event.session !== activeSession) return null;
  switch (event.kind) {
    case "partial":
      return { interim: event.text ?? "" };
    case "final": {
      const text = event.text?.trim() ? event.text : lastInterim;
      return text.trim() ? { interim: "", commit: text } : { interim: "" };
    }
    case "error":
      return {
        interim: "",
        problem: describeSpeechError(
          event.error || "Speech recognition failed.",
        ),
      };
    case "end":
      // A session that ends without a final still keeps what was heard.
      return lastInterim.trim()
        ? { interim: "", commit: lastInterim, ended: true }
        : { interim: "", ended: true };
  }
}

/**
 * Holds native events that arrive while `speech_start` is still resolving:
 * the recogniser can fail (and end) before the session id reaches the UI.
 */
export class PendingSpeechEvents {
  private events: NativeSpeechEvent[] = [];
  private waiting = false;

  begin(): void {
    this.events = [];
    this.waiting = true;
  }

  /** True when the event was held for {@link release}. */
  hold(event: NativeSpeechEvent): boolean {
    if (!this.waiting) return false;
    this.events.push(event);
    if (this.events.length > 64) this.events.shift();
    return true;
  }

  /** Stops holding and returns the held events for `session`, oldest first. */
  release(session: number | null): NativeSpeechEvent[] {
    this.waiting = false;
    const held =
      session === null ? [] : this.events.filter((e) => e.session === session);
    this.events = [];
    return held;
  }
}

export type SpeechProblem = {
  message: string;
  /** Offer to open this System Settings pane. */
  settings?: "microphone" | "speech" | "keyboard";
};

const DICTATION_OFF =
  /siri and dictation|dictation (?:is |are )?(?:disabled|turned off|not enabled|off)|kAFAssistantErrorDomain/iu;

export const DICTATION_OFF_PROBLEM: SpeechProblem = {
  message:
    "Turn on Dictation to use voice — System Settings → Keyboard → Dictation (Siri isn't needed).",
  settings: "keyboard",
};

/** What a recogniser error means for the user. */
export function describeSpeechError(error: string): SpeechProblem {
  if (DICTATION_OFF.test(error)) return DICTATION_OFF_PROBLEM;
  return { message: `Voice input stopped: ${error}` };
}

/** True when the problem means every engine would fail the same way. */
export function isDictationOff(problem: SpeechProblem | null): boolean {
  return problem?.settings === "keyboard";
}

/**
 * Turns a native `speech_start` / permission failure into what the user
 * sees, or null when the native engine simply isn't there (try the next one).
 */
export function describeNativeStartError(error: string): SpeechProblem | null {
  if (DICTATION_OFF.test(error)) return DICTATION_OFF_PROBLEM;
  const m = /^permission:(speech|microphone):(\w+)$/u.exec(error);
  if (m) {
    const pane = m[1] as "speech" | "microphone";
    const what = pane === "speech" ? "Speech Recognition" : "Microphone";
    if (m[2] === "restricted") {
      return {
        message: `${what} access is restricted on this Mac by device management, so voice input can't run.`,
      };
    }
    return {
      message: `Allow Terax in System Settings → Privacy & Security → ${what}, then try again. macOS may ask again after a Terax rebuild.`,
      settings: pane,
    };
  }
  if (/unsupported|not available|isn't loaded/iu.test(error)) return null;
  return { message: `Voice input couldn't start: ${error}` };
}

/**
 * Joins `addition` onto `existing` at the end: one space between words, none
 * before punctuation, and a capital when the text so far ends a sentence.
 */
export function appendDictation(existing: string, addition: string): string {
  const before = existing.replace(/[ \t]+$/u, "");
  const startsSentence = !before || /[.!?]\s*$|\n$/u.test(before);
  const clean = cleanTranscript(addition, startsSentence);
  if (!clean) return existing;
  if (!before) return clean;
  if (/^[.,!?;:]/u.test(clean) || before.endsWith("\n")) return before + clean;
  return `${before} ${clean}`;
}

/**
 * One continuous dictation into the composer: the draft around the caret when
 * the mic started, the utterances already finished, and the one in progress.
 * Pauses close an utterance; nothing heard is ever dropped.
 */
export type Dictation = {
  before: string;
  after: string;
  segments: string[];
  partial: string;
};

export function beginDictation(value: string, caret: number): Dictation {
  const at = Math.max(0, Math.min(caret, value.length));
  return {
    before: value.slice(0, at),
    after: value.slice(at),
    segments: [],
    partial: "",
  };
}

const comparable = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * Whether `next` revises the utterance `prev` (the recogniser rewrites the
 * words it has so far) rather than starting a new one after a pause.
 */
export function isPartialRevision(prev: string, next: string): boolean {
  const a = comparable(prev);
  const b = comparable(next);
  if (!a || !b) return true;
  if (b.startsWith(a.slice(0, Math.min(a.length, 12))) || a.startsWith(b)) {
    return true;
  }
  // A rewrite keeps most of the words (a misheard word or two changes);
  // a new utterance after a pause shares almost none of them.
  const before = a.split(" ");
  const after = new Set(b.split(" "));
  const kept = before.filter((w) => after.has(w)).length;
  return kept >= Math.ceil(before.length * 0.6);
}

/** A live partial: replaces the utterance in progress, or starts the next one. */
export function dictationPartial(d: Dictation, text: string): Dictation {
  if (!text.trim()) return d;
  if (d.partial && !isPartialRevision(d.partial, text)) {
    return { ...d, segments: [...d.segments, d.partial], partial: text };
  }
  return { ...d, partial: text };
}

/** A finished utterance (an empty final keeps what was heard so far). */
export function dictationFinal(d: Dictation, text: string): Dictation {
  const done = text.trim() ? text : d.partial;
  if (!done.trim()) return { ...d, partial: "" };
  return { ...d, segments: [...d.segments, done], partial: "" };
}

/** The composer text and caret for a dictation in progress. */
export function renderDictation(d: Dictation): {
  value: string;
  caret: number;
} {
  let spoken = d.before;
  for (const segment of [...d.segments, d.partial]) {
    spoken = appendDictation(spoken, segment);
  }
  if (!d.after) return { value: spoken, caret: spoken.length };
  const joined =
    spoken === d.before || /\s$/u.test(spoken) || /^[\s.,!?;:]/u.test(d.after)
      ? spoken + d.after
      : `${spoken} ${d.after}`;
  return { value: joined, caret: spoken.length };
}
