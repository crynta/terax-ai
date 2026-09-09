import { terminalReadlineSequence } from "@/modules/terminal/lib/keymap";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import {
  Key,
  KeyAction,
  Mods,
  type KeyEvent,
} from "@terax/ghostty-core/protocol";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import { encodeTerminalPaste } from "./terminalInputEncoding";

import { TerminalNativeSelection } from "@/modules/terminal/ghostty/input/TerminalNativeSelection";

const DUPLICATE_INPUT_WINDOW_MS = 75;

const KEY_MAP: Readonly<Record<string, Key>> = {
  KeyA: Key.A,
  KeyB: Key.B,
  KeyC: Key.C,
  KeyD: Key.D,
  KeyE: Key.E,
  KeyF: Key.F,
  KeyG: Key.G,
  KeyH: Key.H,
  KeyI: Key.I,
  KeyJ: Key.J,
  KeyK: Key.K,
  KeyL: Key.L,
  KeyM: Key.M,
  KeyN: Key.N,
  KeyO: Key.O,
  KeyP: Key.P,
  KeyQ: Key.Q,
  KeyR: Key.R,
  KeyS: Key.S,
  KeyT: Key.T,
  KeyU: Key.U,
  KeyV: Key.V,
  KeyW: Key.W,
  KeyX: Key.X,
  KeyY: Key.Y,
  KeyZ: Key.Z,
  Digit0: Key.ZERO,
  Digit1: Key.ONE,
  Digit2: Key.TWO,
  Digit3: Key.THREE,
  Digit4: Key.FOUR,
  Digit5: Key.FIVE,
  Digit6: Key.SIX,
  Digit7: Key.SEVEN,
  Digit8: Key.EIGHT,
  Digit9: Key.NINE,
  Backquote: Key.GRAVE,
  Backslash: Key.BACKSLASH,
  BracketLeft: Key.BRACKET_LEFT,
  BracketRight: Key.BRACKET_RIGHT,
  Comma: Key.COMMA,
  Equal: Key.EQUAL,
  IntlBackslash: Key.INTL_BACKSLASH,
  Minus: Key.MINUS,
  Period: Key.PERIOD,
  Quote: Key.QUOTE,
  Semicolon: Key.SEMICOLON,
  Slash: Key.SLASH,
  Backspace: Key.BACKSPACE,
  Enter: Key.ENTER,
  Space: Key.SPACE,
  Tab: Key.TAB,
  Delete: Key.DELETE,
  End: Key.END,
  Home: Key.HOME,
  Insert: Key.INSERT,
  PageDown: Key.PAGE_DOWN,
  PageUp: Key.PAGE_UP,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  ArrowUp: Key.UP,
  Escape: Key.ESCAPE,
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
  F13: Key.F13,
  F14: Key.F14,
  F15: Key.F15,
  F16: Key.F16,
  F17: Key.F17,
  F18: Key.F18,
  F19: Key.F19,
  F20: Key.F20,
  F21: Key.F21,
  F22: Key.F22,
  F23: Key.F23,
  F24: Key.F24,
  Numpad0: Key.KP_0,
  Numpad1: Key.KP_1,
  Numpad2: Key.KP_2,
  Numpad3: Key.KP_3,
  Numpad4: Key.KP_4,
  Numpad5: Key.KP_5,
  Numpad6: Key.KP_6,
  Numpad7: Key.KP_7,
  Numpad8: Key.KP_8,
  Numpad9: Key.KP_9,
  NumpadAdd: Key.KP_PLUS,
  NumpadDecimal: Key.KP_PERIOD,
  NumpadDivide: Key.KP_DIVIDE,
  NumpadEnter: Key.KP_ENTER,
  NumpadEqual: Key.KP_EQUAL,
  NumpadMultiply: Key.KP_MULTIPLY,
  NumpadSubtract: Key.KP_MINUS,
  AltLeft: Key.ALT_LEFT,
  AltRight: Key.ALT_RIGHT,
  ControlLeft: Key.CONTROL_LEFT,
  ControlRight: Key.CONTROL_RIGHT,
  MetaLeft: Key.META_LEFT,
  MetaRight: Key.META_RIGHT,
  ShiftLeft: Key.SHIFT_LEFT,
  ShiftRight: Key.SHIFT_RIGHT,
};

type InputSource = "keydown" | "beforeinput" | "composition" | "paste";

export type GhosttyInputControllerOptions = {
  readonly model: GhosttyTerminalModelApi;
  readonly input: HTMLTextAreaElement;
  readonly pointerTarget: HTMLElement;
  readonly cellSize: () => { width: number; height: number };
  readonly onData: (bytes: Uint8Array) => void;
  readonly onCopy: () => boolean;
  readonly getSelection?: () => string | null;
  readonly onPaste?: (text: string) => boolean;
  readonly onText?: (text: string) => boolean;
  readonly onKeyDown?: (event: KeyboardEvent) => boolean;
  readonly macOptionIsMeta?: boolean;
  readonly isMac?: boolean;
};

export class GhosttyInputController {
  private readonly encoder = new TextEncoder();
  private readonly isMac: boolean;
  private readonly nativeSelection: TerminalNativeSelection | null;
  private readonly pressedKeys = new Map<string, KeyEvent>();
  private composing = false;
  private mouseButtons = 0;
  private lastData = "";
  private lastSource: InputSource | null = null;
  private lastDataAt = 0;
  private wheelRemainder = 0;
  private lastMouseMotion: string | null = null;
  private disposed = false;

  constructor(private readonly options: GhosttyInputControllerOptions) {
    this.isMac = options.isMac ?? /Mac|iPhone|iPad/.test(navigator.userAgent);
    this.nativeSelection = options.getSelection
      ? new TerminalNativeSelection({
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
    this.nativeSelection?.dispose();
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

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.nativeSelection?.reset();
    if (
      event.defaultPrevented ||
      this.composing ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === "Dead" ||
      event.key === "Process"
    )
      return;

    if (isPasteShortcut(event, this.isMac)) {
      consume(event);
      void readTerminalClipboard().then((text) => this.paste(text));
      return;
    }
    if (isCopyShortcut(event, this.isMac) && this.options.onCopy()) {
      consume(event);
      return;
    }

    if (this.options.onKeyDown?.(event)) {
      consume(event);
      return;
    }

    const readline = terminalReadlineSequence(event, {
      isMac: this.isMac,
      isAlternateScreen: this.options.model.modes().alternateScreen,
    });
    if (readline) {
      consume(event);
      this.emitText(readline, "keydown");
      return;
    }
    // Unclaimed Command shortcuts belong to the native menu, even in Kitty mode.
    if (this.isMac && event.metaKey) return;
    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      consume(event);
      this.emitText("\x1b\r", "keydown");
      return;
    }

    const printable =
      event.key.length === 1 &&
      !event.metaKey &&
      ((!event.ctrlKey && !event.altKey) ||
        (event.ctrlKey && event.altKey) ||
        (this.isMac &&
          event.altKey &&
          !event.ctrlKey &&
          this.options.macOptionIsMeta !== true));
    if (printable) {
      consume(event);
      this.emitText(
        event.key,
        "keydown",
        true,
        true,
        true,
        !event.altKey && KEY_MAP[event.code] !== undefined ? event : undefined,
      );
      return;
    }

    const key = KEY_MAP[event.code];
    if (key === undefined) return;
    const encoded = this.encodeKeyDown(event, key);
    if (encoded.byteLength > 0) {
      consume(event);
      this.options.model.scrollToBottom();
      this.options.onData(encoded);
    }
  };

  private encodeKeyDown(event: KeyboardEvent, key: Key): Uint8Array {
    const data = {
      action: event.repeat ? KeyAction.REPEAT : KeyAction.PRESS,
      key,
      mods: modifiers(event),
      utf8: event.key.length === 1 ? event.key : undefined,
      unshiftedCodepoint: unshiftedCodepoint(event),
    };
    const encoded = this.options.model.encodeKey(data);
    if (encoded.byteLength > 0) this.pressedKeys.set(event.code, data);
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
      mods: modifiers(event),
      utf8: undefined,
    });
    if (encoded.byteLength > 0) {
      consume(event);
      this.options.onData(encoded);
    }
  };

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
    this.options.input.value = "";
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly handleCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    if (event.data) this.emitText(event.data, "composition", true, true, true);
    this.options.input.value = "";
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
    this.pressedKeys.clear();
    this.composing = false;
    if (this.options.model.modes().focusReporting) {
      this.emitText("\x1b[O", "keydown", false, false);
    }
  };

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
    if (this.options.model.modes().mouseTracking && !event.shiftKey) {
      const position = this.mousePosition(event);
      if (!position) return;
      consume(event);
      this.sendMouse(
        event.deltaY < 0 ? 64 : 65,
        position.col,
        position.row,
        false,
        event,
      );
      return;
    }

    if (this.options.model.scrollPosition().history === 0) return;
    const cellHeight = Math.max(1, this.options.cellSize().height);
    const delta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * this.options.model.rows
          : event.deltaY / cellHeight;
    this.wheelRemainder += delta;
    const lines =
      this.wheelRemainder < 0
        ? Math.ceil(this.wheelRemainder)
        : Math.floor(this.wheelRemainder);
    this.wheelRemainder -= lines;
    if (lines !== 0) this.options.model.scrollBy(lines);
    consume(event);
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
          Math.floor((event.clientY - rect.top) / cell.height) + 1,
        ),
      ),
    };
  }

  private sendMouse(
    button: number,
    col: number,
    row: number,
    release: boolean,
    event: MouseEvent,
  ): void {
    const modifiers = terminalMouseModifiers(event);
    const encodedButton = button + modifiers;
    if (this.options.model.mode(1006)) {
      this.emitText(
        `\x1b[<${encodedButton};${col};${row}${release ? "m" : "M"}`,
        "keydown",
        false,
        false,
      );
      return;
    }
    const legacyButton = release ? 3 : encodedButton;
    this.emitText(
      `\x1b[M${String.fromCharCode(legacyButton + 32)}${String.fromCharCode(
        Math.min(255, col + 32),
      )}${String.fromCharCode(Math.min(255, row + 32))}`,
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
    keyEvent?: KeyboardEvent,
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
    const bytes = keyEvent
      ? this.encodeKeyDown(keyEvent, KEY_MAP[keyEvent.code])
      : this.encoder.encode(data);
    if (bytes.byteLength > 0) this.options.onData(bytes);
  }
}

const UNSHIFTED_SYMBOLS: Readonly<Record<string, string>> = {
  Backquote: "`~",
  Backslash: "\\|",
  BracketLeft: "[{",
  BracketRight: "]}",
  Comma: ",<",
  Equal: "=+",
  IntlBackslash: "\\|",
  Minus: "-_",
  Period: ".>",
  Quote: "'\"",
  Semicolon: ";:",
  Slash: "/?",
};

function unshiftedCodepoint(event: KeyboardEvent): number {
  const character = event.key.toLowerCase().codePointAt(0) ?? 0;
  if (event.key.length === 1 && character >= 32 && character !== 127) {
    if (event.shiftKey) {
      const pair = UNSHIFTED_SYMBOLS[event.code];
      if (pair?.[1] === event.key) return pair.charCodeAt(0);
      if (event.code.startsWith("Digit") && event.code.length === 6) {
        const digit = event.code.charCodeAt(5) - 48;
        if (")!@#$%^&*("[digit] === event.key) return digit + 48;
      }
    }
    return character;
  }
  return event.code.startsWith("Key") && event.code.length === 4
    ? event.code.toLowerCase().charCodeAt(3)
    : 0;
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

function modifiers(event: KeyboardEvent): Mods {
  let result = Mods.NONE;
  if (event.shiftKey) result |= Mods.SHIFT;
  if (event.ctrlKey) result |= Mods.CTRL;
  if (event.altKey) result |= Mods.ALT;
  if (event.metaKey) result |= Mods.SUPER;
  if (event.getModifierState("CapsLock")) result |= Mods.CAPSLOCK;
  if (event.getModifierState("NumLock")) result |= Mods.NUMLOCK;
  return result;
}

function isCopyShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return (
      event.metaKey && !event.ctrlKey && !event.altKey && event.code === "KeyC"
    );
  }
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "KeyC"
  );
}

function isPasteShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return (
      event.metaKey && !event.ctrlKey && !event.altKey && event.code === "KeyV"
    );
  }
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "KeyV"
  );
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
