import type { GhosttyTerminalEvent } from "@terax/ghostty-core/protocol";
import { parseOsc7, parseOsc52Clipboard } from "../../lib/osc-handlers";

export type GhosttySemanticEventCallbacks = {
  readonly onBell?: () => void;
  readonly onClipboard?: (text: string) => void;
  readonly onCommandState?: (running: boolean) => void;
  readonly onCwd?: (cwd: string) => void;
  readonly onNotification?: (title: string, body: string) => void;
  readonly onOverflow?: (dropped: number) => void;
  readonly onTitle?: (title: string) => void;
};

/**
 * Routes parser-owned semantic events into Terax product callbacks.
 *
 * OSC 7 is accepted only between commands. Output produced by a command is
 * untrusted and must not be allowed to change the workspace directory.
 */
export class GhosttySemanticEventRouter {
  private inCommand = false;

  constructor(private readonly callbacks: GhosttySemanticEventCallbacks) {}

  handle(event: GhosttyTerminalEvent): void {
    switch (event.type) {
      case "bell":
        this.callbacks.onBell?.();
        break;
      case "title":
        this.callbacks.onTitle?.(event.title);
        break;
      case "pwd": {
        if (this.inCommand) break;
        const cwd = parseOsc7(event.uri);
        if (cwd) this.callbacks.onCwd?.(cwd);
        break;
      }
      case "clipboard": {
        const text = parseOsc52Clipboard(`${event.selection};${event.data}`);
        if (text !== null) this.callbacks.onClipboard?.(text);
        break;
      }
      case "notification":
        this.callbacks.onNotification?.(event.title, event.body);
        break;
      case "prompt-start":
        this.inCommand = false;
        this.callbacks.onCommandState?.(false);
        break;
      case "prompt-continuation":
        break;
      case "prompt-end":
        this.inCommand = true;
        break;
      case "end-of-input":
        this.inCommand = true;
        this.callbacks.onCommandState?.(true);
        break;
      case "end-of-command":
        this.inCommand = false;
        this.callbacks.onCommandState?.(false);
        break;
      case "overflow":
        this.callbacks.onOverflow?.(event.dropped);
        break;
    }
  }

  reset(): void {
    this.inCommand = false;
  }
}
