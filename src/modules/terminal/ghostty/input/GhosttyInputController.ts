import { ImeAnchor } from "@/modules/terminal/ghostty/input/ImeAnchor";
import { TerminalInputProxy } from "@/modules/terminal/ghostty/input/TerminalInputProxy";
import { TerminalNativeSelection } from "@/modules/terminal/ghostty/input/TerminalNativeSelection";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { type Key, KeyAction, type KeyEvent } from "@terax/ghostty-core/protocol";
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
import { KEY_MAP } from "./keyTable";
import { encodeTerminalPaste } from "./terminalInputEncoding";
import {
  cursorKeySequence,
  DEFAULT_SCROLL_SPEED,
  MAX_WHEEL_REPORTS_PER_EVENT,
  WheelAccumulator,
  wheelLines,
  wheelRoute,
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
  readonly macOptionIsMeta?: boolean;
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
  private readonly imeAnchor: ImeAnchor;
  private readonly nativeSelection: TerminalNativeSelection | null;
  private readonly keyContext: KeyContext;
  private readonly pressedKeys = new Map<string, KeyEvent>();
  private readonly wheel = new WheelAccumulator();
  private composing = false;
  private mouseButtons = 0;
  private lastData = "";
  private lastSource: InputSource | null = null;
  private lastDataAt = 0;
  private lastMouseMotion: string | null = null;
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
      macOptionIsMeta: options.macOptionIsMeta === true,
      composing: () => this.composing,
      alternateScreen: () => options.model.modes().alternateScreen,
      kittyFlags: () => this.kittyFlags(),
    };
    this.proxy = new TerminalInputProxy(options.input, {
      placeholder: options.inputPlaceholder ?? this.isMac,
    });
    this.imeAnchor = new ImeAnchor(options.input.style, () =>
      this.cursorCell(),
    );
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
    options.input.addEventListener("keydown", this.handleKeyDown);
    options.input.addEventListener("keyup", this.handleKeyUp);
    options.input.addEventListener("beforeinput", this.handleBeforeInput);
    options.input.addEventListener(
      "compositionstart",
      this.handleCompositionStart,
    );
    options.input.addEventListener("compositionend", this.handleCompositionEnd);
    options.input.addEventListener("paste", this.handlePaste);
    options.input.addEventListener("focus", this.handleFocus);
    options.input.addEventListener("blur", this.handleBlur);
    options.pointerTarget.addEventListener("mousedown", this.handleMouseDown);
    options.pointerTarget.addEventListener("mouseup", this.handleMouseUp);
    options.pointerTarget.addEventListener("mousemove", this.handleMouseMove);
    options.pointerTarget.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
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
    this.imeAnchor.end();
    this.nativeSelection?.dispose();
    this.proxy.dispose();
    this.pressedKeys.clear();
    const { input, pointerTarget } = this.options;
    input.removeEventListener("keydown", this.handleKeyDown);
    input.removeEventListener("keyup", this.handleKeyUp);
    input.removeEventListener("beforeinput", this.handleBeforeInput);
    input.removeEventListener("compositionstart", this.handleCompositionStart);
    input.removeEventListener("compositionend", this.handleCompositionEnd);
    input.removeEventListener("paste", this.handlePaste);
    input.removeEventListener("focus", this.handleFocus);
    input.removeEventListener("blur", this.handleBlur);
    pointerTarget.removeEventListener("mousedown", this.handleMouseDown);
    pointerTarget.removeEventListener("mouseup", this.handleMouseUp);
    pointerTarget.removeEventListener("mousemove", this.handleMouseMove);
    pointerTarget.removeEventListener("wheel", this.handleWheel);
  }

  private kittyFlags(): number {
    return this.options.model.kittyKeyboardFlags?.() ?? 0;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.nativeSelection?.reset();
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
    const key = route.forwardKeyWhenEmpty ? KEY_MAP[event.code] : undefined;
    const fallback =
      key === undefined
        ? null
        : this.options.model.encodeKey(
            buildKeyEvent(event, key, KeyAction.PRESS, this.kittyFlags()),
          );
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
    let data: string | null = null;
    switch (event.inputType) {
      case "insertText":
      case "insertReplacementText":
        data = event.data;
        break;
      case "insertLineBreak":
      case "insertParagraph":
        data = "\r";
        break;
      case "deleteContentBackward":
        data = "\x7f";
        break;
      case "deleteContentForward":
        data = "\x1b[3~";
        break;
      case "insertFromPaste":
        if (event.data) this.paste(event.data);
        consume(event);
        return;
      default:
        return;
    }
    if (!data) return;
    consume(event);
    this.emitText(
      data,
      "beforeinput",
      true,
      true,
      event.inputType === "insertText" ||
        event.inputType === "insertReplacementText",
    );
    this.proxy.arm();
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
    this.imeAnchor.begin();
  };

  private readonly handleCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    this.imeAnchor.end();
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
    this.composing = false;
    this.imeAnchor.end();
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

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.options.model.modes().mouseTracking || event.shiftKey) return;
    const position = this.mousePosition(event);
    if (!position) return;
    this.mouseButtons |= 1 << event.button;
    this.lastMouseMotion = null;
    consume(event);
    this.sendMouse(event.button, position.col, position.row, false, event);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (!this.options.model.modes().mouseTracking || event.shiftKey) return;
    const position = this.mousePosition(event);
    if (!position) return;
    this.mouseButtons &= ~(1 << event.button);
    this.lastMouseMotion = null;
    consume(event);
    this.sendMouse(event.button, position.col, position.row, true, event);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (event.shiftKey) {
      this.lastMouseMotion = null;
      return;
    }
    const buttonMotion = this.options.model.mode(1002);
    const anyMotion = this.options.model.mode(1003);
    if (!anyMotion && (!buttonMotion || this.mouseButtons === 0)) {
      this.lastMouseMotion = null;
      return;
    }
    const position = this.mousePosition(event);
    if (!position) return;
    let button = 32;
    if ((this.mouseButtons & 1) !== 0) button += 0;
    else if ((this.mouseButtons & 2) !== 0) button += 1;
    else if ((this.mouseButtons & 4) !== 0) button += 2;
    const signature = [
      button,
      position.col,
      position.row,
      terminalMouseModifiers(event),
      buttonMotion ? 1 : 0,
      anyMotion ? 1 : 0,
      this.options.model.mode(1006) ? 1 : 0,
    ].join(":");
    consume(event);
    if (signature === this.lastMouseMotion) return;
    this.lastMouseMotion = signature;
    this.sendMouse(button, position.col, position.row, false, event);
  };

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
      const whole = this.wheel.push(route, lines);
      if (whole !== 0) model.scrollBy(whole);
      consume(event);
      return;
    }

    consume(event);
    const count = this.wheel.push(route, lines, MAX_WHEEL_REPORTS_PER_EVENT);
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
    const position = this.mousePosition(event);
    if (!position) return;
    this.emitText(
      this.mouseReport(
        count < 0 ? 64 : 65,
        position.col,
        position.row,
        false,
        event,
      ).repeat(times),
      "keydown",
      false,
      false,
    );
  };

  private mousePosition(
    event: MouseEvent,
  ): { col: number; row: number } | null {
    const rect = this.options.pointerTarget.getBoundingClientRect();
    const cell = this.options.cellSize();
    if (cell.width <= 0 || cell.height <= 0) return null;
    return {
      col: Math.max(
        1,
        Math.min(
          this.options.model.cols,
          Math.floor((event.clientX - rect.left) / cell.width) + 1,
        ),
      ),
      row: Math.max(
        1,
        Math.min(
          this.options.model.rows,
          Math.floor(
            (event.clientY - rect.top + (this.options.gridShiftY?.() ?? 0)) /
              cell.height,
          ) + 1,
        ),
      ),
    };
  }

  private mouseReport(
    button: number,
    col: number,
    row: number,
    release: boolean,
    event: MouseEvent,
  ): string {
    const encodedButton = button + terminalMouseModifiers(event);
    if (this.options.model.mode(1006))
      return `\x1b[<${encodedButton};${col};${row}${release ? "m" : "M"}`;
    const legacyButton = release ? 3 : encodedButton;
    return `\x1b[M${String.fromCharCode(legacyButton + 32)}${String.fromCharCode(
      Math.min(255, col + 32),
    )}${String.fromCharCode(Math.min(255, row + 32))}`;
  }

  private sendMouse(
    button: number,
    col: number,
    row: number,
    release: boolean,
    event: MouseEvent,
  ): void {
    this.emitText(
      this.mouseReport(button, col, row, release, event),
      "keydown",
      false,
      false,
    );
  }

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
    const bytes = keyed
      ? this.encodeKeyDown(keyed.event, keyed.key)
      : this.encoder.encode(data);
    if (bytes.byteLength > 0) this.options.onData(bytes);
  }
}

export function terminalMouseModifiers(
  event: Pick<MouseEvent, "altKey" | "ctrlKey" | "shiftKey">,
): number {
  let modifiers = 0;
  if (event.shiftKey) modifiers |= 4;
  if (event.altKey) modifiers |= 8;
  if (event.ctrlKey) modifiers |= 16;
  return modifiers;
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
