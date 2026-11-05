import type { ImeAnchor } from "@/modules/terminal/ghostty/input/ImeAnchor";
import type { TerminalMouse } from "@/modules/terminal/ghostty/input/TerminalMouse";
import { TerminalInputProxy } from "@/modules/terminal/ghostty/input/TerminalInputProxy";
import { TerminalNativeSelection } from "@/modules/terminal/ghostty/input/TerminalNativeSelection";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { Key, KeyAction, type KeyEvent } from "@terax/ghostty-core/protocol";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import {
  buildKeyEvent,
  canonicalKittyPress,
  ignoredForIme,
  KITTY_REPORT_EVENT_TYPES,
  type KeyContext,
  type KeyRoute,
  keyModifiers,
  routeKeyDown,
} from "./keyRouting";
import { type MacOptionAsAlt, optionActsAsMeta } from "./macOptionAsAlt";
import { encodeTerminalPaste } from "./terminalInputEncoding";
import {
  cursorKeySequence,
  DEFAULT_SCROLL_SPEED,
  MAX_WHEEL_REPORTS_PER_EVENT,
  WheelAccumulator,
  wheelLines,
  wheelRoute,
  wheelUnits,
} from "./terminalWheel";

const DUPLICATE_INPUT_WINDOW_MS = 75;
const MODE_CURSOR_KEYS = 1;
const MODE_ALTERNATE_SCROLL = 1007;

type InputSource = "keydown" | "beforeinput" | "composition" | "paste";

export type GhosttyInputControllerOptions = {
  readonly model: GhosttyTerminalModelApi;
  readonly input: HTMLTextAreaElement;
  readonly pointerTarget: HTMLElement;
  readonly cellSize: () => { width: number; height: number };
  /** CSS pixels the drawn grid is moved up inside the pointer target; zero when absent. */
  readonly gridShiftY?: () => number;
  readonly onData: (bytes: Uint8Array) => void;
  readonly onCopy: () => boolean;
  readonly getSelection?: () => string | null;
  readonly onPaste?: (text: string) => boolean;
  readonly onText?: (text: string) => boolean;
  readonly onKeyDown?: (event: KeyboardEvent) => boolean;
  /** Which Option key acts as Alt (Meta); read per key so a preference change applies at once. */
  readonly macOptionAsAlt?: () => MacOptionAsAlt;
  readonly isMac?: boolean;
  readonly isWindows?: boolean;
  /** Selected-placeholder input proxy (a macOS WebKit fix); defaults to `isMac`. */
  readonly inputPlaceholder?: boolean;
  /** Wheel distance multiplier; read per event so a preference change applies at once. */
  readonly scrollSpeed?: () => number;
};

export class GhosttyInputController {
  private readonly encoder = new TextEncoder();
  private readonly isMac: boolean;
  private readonly proxy: TerminalInputProxy;
  private imeAnchor: ImeAnchor | null = null;
  private mouse: TerminalMouse | null = null;
  private readonly nativeSelection: TerminalNativeSelection | null;
  private readonly keyContext: KeyContext;
  private readonly pressedKeys = new Map<string, KeyEvent>();
  private readonly wheel = new WheelAccumulator();
  private composing = false;
  private optionKeys = 0;
  private lastData = "";
  private lastSource: InputSource | null = null;
  private lastDataAt = 0;
  private disposed = false;

  constructor(private readonly options: GhosttyInputControllerOptions) {
    const userAgent =
      typeof navigator === "undefined" ? "" : navigator.userAgent;
    this.isMac = options.isMac ?? /Mac|iPhone|iPad/.test(userAgent);
    const isWindows =
      options.isWindows ?? (!this.isMac && /Windows/.test(userAgent));
    this.keyContext = {
      isMac: this.isMac,
      isWindows,
      optionIsMeta: () =>
        optionActsAsMeta(options.macOptionAsAlt?.() ?? "off", this.optionKeys),
      composing: () => this.composing,
      alternateScreen: () => options.model.modes().alternateScreen,
      kittyFlags: () => this.kittyFlags(),
    };
    this.proxy = new TerminalInputProxy(options.input, {
      placeholder: options.inputPlaceholder ?? this.isMac,
    });
    this.nativeSelection = options.getSelection
      ? new TerminalNativeSelection({
          proxy: this.proxy,
          input: options.input,
          target: options.pointerTarget,
          getSelection: options.getSelection,
          mouseTracking: () => options.model.modes().mouseTracking,
          isMac: this.isMac,
        })
      : null;
    for (const [target, type, listener, listenerOptions] of this.listeners())
      target.addEventListener(type, listener, listenerOptions);
    this.loadColdModules(true);
  }

  /**
   * Cold paths load apart from the keyboard: only composing users need the
   * anchor and only programs that track the mouse need the reports. A failed
   * load is retried once, then reported once; the keyboard works without them.
   */
  private loadColdModules(retry: boolean): void {
    const { options } = this;
    void Promise.all([import("./ImeAnchor"), import("./TerminalMouse")]).then(
      ([{ ImeAnchor }, { TerminalMouse }]) => {
        if (this.disposed) return;
        this.imeAnchor = new ImeAnchor(options.input.style, () =>
          this.cursorCell(),
        );
        this.mouse = new TerminalMouse({
          model: options.model,
          pointerTarget: options.pointerTarget,
          cellSize: options.cellSize,
          gridShiftY: options.gridShiftY,
          send: (report) => this.emitText(report, "keydown", false, false),
        });
      },
      (error: unknown) => {
        if (this.disposed) return;
        if (retry) this.loadColdModules(false);
        else console.warn("Terax: mouse and IME input failed to load", error);
      },
    );
  }

  paste(text: string): void {
    if (this.disposed || !text) return;
    this.nativeSelection?.reset();
    if (this.options.onPaste?.(text)) return;
    this.emitText(
      encodeTerminalPaste(text, this.options.model.modes().bracketedPaste),
      "paste",
      false,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.imeAnchor?.end();
    this.mouse?.dispose();
    this.nativeSelection?.dispose();
    this.proxy.dispose();
    this.pressedKeys.clear();
    for (const [target, type, listener] of this.listeners())
      target.removeEventListener(type, listener);
  }

  private listeners(): [
    EventTarget,
    string,
    EventListener,
    AddEventListenerOptions?,
  ][] {
    const { input, pointerTarget } = this.options;
    return [
      [input, "keydown", this.handleKeyDown as EventListener],
      [input, "keyup", this.handleKeyUp as EventListener],
      [input, "beforeinput", this.handleBeforeInput as EventListener],
      [input, "compositionstart", this.handleCompositionStart],
      [input, "compositionend", this.handleCompositionEnd as EventListener],
      [input, "paste", this.handlePaste as EventListener],
      [input, "focus", this.handleFocus],
      [input, "blur", this.handleBlur],
      [
        pointerTarget,
        "wheel",
        this.handleWheel as EventListener,
        { passive: false },
      ],
    ];
  }

  private kittyFlags(): number {
    return this.options.model.kittyKeyboardFlags?.() ?? 0;
  }

  /** Which Option keys are held (1 left, 2 right): a key event does not say. */
  private trackOptionKeys(event: KeyboardEvent, down: boolean): void {
    const bit =
      event.code === "AltLeft" ? 1 : event.code === "AltRight" ? 2 : 0;
    if (bit)
      this.optionKeys = down ? this.optionKeys | bit : this.optionKeys & ~bit;
    if (!event.altKey) this.optionKeys = 0;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.nativeSelection?.reset();
    this.trackOptionKeys(event, true);
    if (ignoredForIme(event, this.keyContext)) return;

    let route = routeKeyDown(event, this.keyContext);
    if (route.kind === "paste") {
      consume(event);
      this.pasteFromClipboard(event, route);
      return;
    }
    if (route.kind === "copy") {
      if (this.options.onCopy()) {
        consume(event);
        return;
      }
      route = routeKeyDown(event, this.keyContext, true);
    }

    if (this.options.onKeyDown?.(event)) {
      consume(event);
      return;
    }

    switch (route.kind) {
      case "bytes":
        consume(event);
        this.emitText(route.text, "keydown");
        return;
      case "text":
        consume(event);
        this.emitText(
          route.text,
          "keydown",
          true,
          true,
          true,
          route.key === null ? undefined : { event, key: route.key },
        );
        return;
      case "key": {
        const encoded = this.encodeKeyDown(event, route.key, route.utf8);
        if (encoded.byteLength > 0) {
          consume(event);
          this.options.model.scrollToBottom();
          this.options.onData(encoded);
        }
        return;
      }
      default:
        return;
    }
  };

  private pasteFromClipboard(
    event: KeyboardEvent,
    route: Extract<KeyRoute, { kind: "paste" }>,
  ): void {
    // Ctrl+V is also a key: an application that reads the clipboard itself (an
    // image paste) gets it when there is no text to paste.
    const fallback = route.forwardKeyWhenEmpty
      ? this.options.model.encodeKey(
          buildKeyEvent(event, Key.V, KeyAction.PRESS, this.kittyFlags()),
        )
      : null;
    void readTerminalClipboard().then((text) => {
      if (this.disposed) return;
      if (text) this.paste(text);
      else if (fallback && fallback.byteLength > 0)
        this.options.onData(fallback);
    });
  }

  private encodeKeyDown(
    event: KeyboardEvent,
    key: Key,
    utf8?: string,
  ): Uint8Array {
    const flags = this.kittyFlags();
    const action = event.repeat ? KeyAction.REPEAT : KeyAction.PRESS;
    const data = buildKeyEvent(event, key, action, flags, utf8);
    let encoded = this.options.model.encodeKey(data);
    if (encoded.byteLength === 0) return encoded;
    // A press that went out as plain text has no release to report.
    if (encoded[0] === 0x1b) this.pressedKeys.set(event.code, data);
    if (action === KeyAction.PRESS && (flags & KITTY_REPORT_EVENT_TYPES) !== 0)
      encoded = canonicalKittyPress(encoded);
    return encoded;
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.trackOptionKeys(event, false);
    const pressed = this.pressedKeys.get(event.code);
    if (!pressed) return;
    this.pressedKeys.delete(event.code);
    if (event.defaultPrevented || this.composing || event.isComposing) return;
    const encoded = this.options.model.encodeKey({
      ...pressed,
      action: KeyAction.RELEASE,
      mods: keyModifiers(event, this.kittyFlags()),
    });
    if (encoded.byteLength > 0) {
      consume(event);
      this.options.onData(encoded);
    }
  };

  /** Applications that track key events must not see a key stay down. */
  private releasePressedKeys(): void {
    if (this.pressedKeys.size === 0) return;
    const reports = (this.kittyFlags() & KITTY_REPORT_EVENT_TYPES) !== 0;
    const pressed = [...this.pressedKeys.values()];
    this.pressedKeys.clear();
    if (!reports || this.disposed) return;
    for (const key of pressed) {
      const encoded = this.options.model.encodeKey({
        ...key,
        action: KeyAction.RELEASE,
      });
      if (encoded.byteLength > 0) this.options.onData(encoded);
    }
  }

  private readonly handleBeforeInput = (event: InputEvent): void => {
    if (this.composing || event.isComposing) return;
    const { inputType } = event;
    if (inputType === "insertFromPaste") {
      if (event.data) this.paste(event.data);
      consume(event);
      return;
    }
    const text =
      inputType === "insertText" || inputType === "insertReplacementText";
    const data = text
      ? event.data
      : (BEFORE_INPUT_BYTES.get(inputType) ?? null);
    if (!data) return;
    consume(event);
    this.emitText(data, "beforeinput", true, true, text);
    this.proxy.arm();
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
    this.imeAnchor?.begin();
  };

  private readonly handleCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    this.imeAnchor?.end();
    if (event.data) this.emitText(event.data, "composition", true, true, true);
    this.proxy.arm();
  };

  private readonly handlePaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    consume(event);
    this.paste(text);
  };

  private readonly handleFocus = (): void => {
    if (this.options.model.modes().focusReporting) {
      this.emitText("\x1b[I", "keydown", false, false);
    }
  };

  private readonly handleBlur = (): void => {
    this.releasePressedKeys();
    this.optionKeys = 0;
    this.composing = false;
    this.imeAnchor?.end();
    this.wheel.reset();
    if (this.options.model.modes().focusReporting) {
      this.emitText("\x1b[O", "keydown", false, false);
    }
  };

  private cursorCell(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const cell = this.options.cellSize();
    if (!(cell.width > 0 && cell.height > 0)) return null;
    const cursor = this.options.model.cursor();
    return {
      left: cursor.x * cell.width,
      top: cursor.y * cell.height - (this.options.gridShiftY?.() ?? 0),
      width: cell.width,
      height: cell.height,
    };
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const { model } = this.options;
    const modes = model.modes();
    const route = wheelRoute({
      mouseTracking: modes.mouseTracking,
      shiftKey: event.shiftKey,
      alternateScreen: modes.alternateScreen,
      alternateScroll:
        modes.alternateScreen && model.mode(MODE_ALTERNATE_SCROLL),
    });
    const lines = wheelLines(
      event.deltaY,
      event.deltaMode,
      this.options.cellSize().height,
      model.rows,
      this.options.scrollSpeed?.() ?? DEFAULT_SCROLL_SPEED,
    );

    if (route === "scrollback") {
      if (model.scrollPosition().history === 0) {
        this.wheel.reset();
        return;
      }
      const whole = this.wheel.push(route, wheelUnits(route, lines));
      if (whole !== 0) model.scrollBy(whole);
      consume(event);
      return;
    }

    consume(event);
    const count = this.wheel.push(
      route,
      wheelUnits(route, lines),
      MAX_WHEEL_REPORTS_PER_EVENT,
    );
    if (count === 0) return;
    const times = Math.abs(count);
    if (route === "arrows") {
      const sequence = cursorKeySequence(
        count < 0 ? "up" : "down",
        model.mode(MODE_CURSOR_KEYS),
      );
      this.emitText(sequence.repeat(times), "keydown", false);
      return;
    }
    this.mouse?.wheel(event, count < 0, times);
  };

  private emitText(
    data: string,
    source: InputSource,
    deduplicate = true,
    scrollToBottom = true,
    editableText = false,
    keyed?: { event: KeyboardEvent; key: Key },
  ): void {
    if (this.disposed) return;
    const now = performance.now();
    if (
      deduplicate &&
      source !== this.lastSource &&
      data === this.lastData &&
      now - this.lastDataAt < DUPLICATE_INPUT_WINDOW_MS
    ) {
      this.lastData = "";
      this.lastSource = null;
      return;
    }
    this.lastData = data;
    this.lastSource = source;
    this.lastDataAt = now;
    if (editableText && this.options.onText?.(data)) return;
    if (scrollToBottom) this.options.model.scrollToBottom();
    let bytes = keyed
      ? this.encodeKeyDown(keyed.event, keyed.key)
      : this.encoder.encode(data);
    // Typed text is never dropped because the encoder had no form for the key.
    if (keyed && bytes.byteLength === 0) bytes = this.encoder.encode(data);
    if (bytes.byteLength > 0) this.options.onData(bytes);
  }
}

/** What an editing command that reaches the input element means to the PTY. */
const BEFORE_INPUT_BYTES: ReadonlyMap<string, string> = new Map([
  ["insertLineBreak", "\r"],
  ["insertParagraph", "\r"],
  ["deleteContentBackward", "\x7f"],
  ["deleteContentForward", "\x1b[3~"],
]);

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
