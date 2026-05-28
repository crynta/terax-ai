import { usePreferencesStore } from "@/modules/settings/preferences";
import { emit, listen } from "@tauri-apps/api/event";
import type { ITerminalAddon, Terminal } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "terax:cmd-history";
const MAX_HISTORY = 500;

/**
 * Common Linux / dev commands pre-seeded so auto-suggest works immediately
 * on first launch without any history. The list covers the most frequently
 * used coreutils, package managers, dev tools, and sysadmin commands.
 */
const BUILTIN_COMMANDS: readonly string[] = [
  // Filesystem
  "ls", "ls -la", "ls -lah", "ll",
  "cd", "cd ..", "cd ~", "cd -",
  "pwd", "mkdir", "mkdir -p", "rmdir",
  "cp", "cp -r", "mv", "rm", "rm -rf", "rm -f",
  "touch", "cat", "less", "more", "head", "tail", "tail -f",
  "ln", "ln -s", "stat", "file", "du", "du -sh", "df", "df -h",
  "find", "locate", "which", "whereis", "readlink",
  // Text / search
  "grep", "grep -r", "grep -rn", "grep -i",
  "awk", "sed", "sort", "uniq", "wc", "wc -l",
  "cut", "tr", "diff", "comm", "tee", "xargs",
  // Permissions
  "chmod", "chmod +x", "chown", "chgrp",
  // Archives
  "tar", "tar -xzf", "tar -czf", "zip", "unzip", "gzip", "gunzip",
  // Network
  "curl", "wget", "ping", "ssh", "scp", "rsync",
  "ip", "ifconfig", "netstat", "ss", "nslookup", "dig", "traceroute",
  "nc", "nmap",
  // Process
  "ps", "ps aux", "top", "htop", "kill", "killall", "pkill",
  "bg", "fg", "jobs", "nohup",
  // System
  "sudo", "su", "whoami", "id", "uname", "uname -a",
  "hostname", "uptime", "free", "free -h",
  "dmesg", "lsblk", "mount", "umount", "fdisk",
  "systemctl", "systemctl status", "systemctl start", "systemctl stop",
  "systemctl restart", "systemctl enable", "systemctl disable",
  "journalctl", "journalctl -u", "journalctl -f",
  "service",
  // Package managers
  "apt", "apt update", "apt upgrade", "apt install", "apt remove", "apt search",
  "apt-get", "apt-get update", "apt-get install",
  "pacman", "pacman -S", "pacman -Syu", "pacman -R", "pacman -Ss",
  "yay", "yay -S", "yay -Syu",
  "dnf", "dnf install", "dnf update", "dnf search",
  "yum", "yum install", "yum update",
  "snap", "snap install", "flatpak",
  "brew", "brew install", "brew update", "brew upgrade",
  // Node / JS
  "node", "npm", "npm install", "npm run", "npm run dev", "npm run build",
  "npm start", "npm test", "npm init",
  "npx", "pnpm", "pnpm install", "pnpm dev", "pnpm build", "pnpm add",
  "pnpm run", "pnpm test",
  "yarn", "yarn install", "yarn dev", "yarn build", "yarn add",
  "bun", "bun install", "bun run", "bun dev",
  // Python
  "python", "python3", "pip", "pip install", "pip3", "pip3 install",
  "pipenv", "poetry", "conda",
  // Rust
  "cargo", "cargo build", "cargo run", "cargo test", "cargo clippy",
  "cargo fmt", "cargo add", "cargo init", "cargo new",
  "rustup", "rustc",
  // Go
  "go", "go build", "go run", "go test", "go mod", "go mod tidy", "go get",
  // Docker
  "docker", "docker ps", "docker images", "docker build", "docker run",
  "docker-compose", "docker-compose up", "docker-compose down",
  "docker compose", "docker compose up", "docker compose down",
  // Git
  "git", "git status", "git add", "git add .", "git commit", "git commit -m",
  "git push", "git pull", "git fetch", "git merge", "git rebase",
  "git branch", "git checkout", "git checkout -b", "git switch",
  "git log", "git log --oneline", "git diff", "git stash", "git stash pop",
  "git clone", "git remote", "git reset", "git cherry-pick", "git tag",
  // Tauri / project-specific
  "pnpm tauri dev", "pnpm tauri build",
  // Misc dev
  "make", "cmake", "gcc", "g++", "clang",
  "vim", "nvim", "nano", "vi",
  "tmux", "screen",
  "echo", "printf", "export", "env", "printenv", "set", "unset",
  "alias", "source", "history", "clear", "reset", "exit",
  "man", "help", "info", "type",
  "date", "cal", "sleep", "watch",
  "xdg-open", "open",
];

// ---------------------------------------------------------------------------
// History store (Set-backed, persisted to localStorage)
// ---------------------------------------------------------------------------

function loadHistory(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set<string>();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set<string>();
    // Only keep strings, cap at MAX_HISTORY
    return new Set<string>(
      arr.filter((x): x is string => typeof x === "string").slice(-MAX_HISTORY),
    );
  } catch {
    return new Set<string>();
  }
}

function saveHistory(history: Set<string>): void {
  try {
    // Trim to MAX_HISTORY (keep the most recent entries)
    const arr = Array.from(history);
    const trimmed = arr.length > MAX_HISTORY ? arr.slice(-MAX_HISTORY) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or unavailable — silently ignore */
  }
}

// ---------------------------------------------------------------------------
// AutoSuggestAddon
// ---------------------------------------------------------------------------

export class AutoSuggestAddon implements ITerminalAddon {
  private _terminal: Terminal | null = null;
  private _history: Set<string>;

  /** The text the user has typed on the current prompt line so far. */
  private _currentInput = "";

  /** The full command string being suggested, or null if nothing matches. */
  private _activeSuggestion: string | null = null;

  /** The overlay DOM element used to render ghost text. */
  private _overlayEl: HTMLSpanElement | null = null;

  /** Disposables registered on the terminal. */
  private _disposables: { dispose(): void }[] = [];

  /** Unlisten function for Tauri events. */
  private _unlistenClear: (() => void) | null = null;

  constructor() {
    this._history = loadHistory();
    void listen("terax:clear-cmd-history", () => {
      this._history.clear();
      saveHistory(this._history);
      this._updateSuggestion();
    }).then((un) => {
      this._unlistenClear = un;
    });
  }

  // ---- ITerminalAddon interface -------------------------------------------

  activate(terminal: Terminal): void {
    this._terminal = terminal;

    // NOTE: We do NOT create the overlay here because activate() is called
    // during loadAddon(), which runs BEFORE term.open(). At this point
    // terminal.element is null. The overlay is created lazily in
    // _ensureOverlay() on the first suggestion render.

    // Listen to data coming *from the user* (keyboard input).
    const onDataDisp = terminal.onData((data) => this._onData(data));
    this._disposables.push(onDataDisp);

    // When the terminal is resized or scrolled, reposition or hide overlay.
    const onRenderDisp = terminal.onRender(() => {
      if (this._activeSuggestion) {
        requestAnimationFrame(() => this._showOverlay());
      }
    });
    this._disposables.push(onRenderDisp);
  }

  dispose(): void {
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this._disposables = [];
    if (this._unlistenClear) {
      this._unlistenClear();
      this._unlistenClear = null;
    }
    this._overlayEl?.remove();
    this._overlayEl = null;
    this._terminal = null;
  }

  // ---- Public API ---------------------------------------------------------

  /** Returns the current active suggestion, or null. */
  getActiveSuggestion(): string | null {
    return this._activeSuggestion;
  }

  /** Returns the remaining text that would be inserted on accept. */
  getSuggestionRemainder(): string | null {
    if (!this._activeSuggestion) return null;
    return this._activeSuggestion.slice(this._currentInput.length) || null;
  }

  /**
   * Accept the current suggestion: write the remainder to the PTY and
   * commit the full command to history. Returns true if a suggestion was
   * accepted.
   */
  acceptSuggestion(writeToPty: (data: string) => void): boolean {
    const remainder = this.getSuggestionRemainder();
    if (!remainder) return false;
    writeToPty(remainder);
    this._currentInput = this._activeSuggestion!;
    this._activeSuggestion = null;
    this._hideOverlay();
    return true;
  }

  /** Manually reset input tracking (e.g. when a slot is rebound). */
  resetInput(): void {
    this._currentInput = "";
    this._activeSuggestion = null;
    this._hideOverlay();
  }

  // ---- Private: input tracking --------------------------------------------

  private _onData(data: string): void {
    // Enter — commit the current input to history.
    if (data === "\r" || data === "\n") {
      const trimmed = this._currentInput.trim();
      if (trimmed.length > 0) {
        // Re-add to move it to the end of the Set (most recent)
        this._history.delete(trimmed);
        this._history.add(trimmed);
        this._trimHistory();
        saveHistory(this._history);
      }
      this._currentInput = "";
      this._activeSuggestion = null;
      this._hideOverlay();
      return;
    }

    // Backspace / DEL
    if (data === "\x7f" || data === "\b") {
      this._currentInput = this._currentInput.slice(0, -1);
      this._updateSuggestion();
      return;
    }

    // Ctrl-C — cancel the line
    if (data === "\x03") {
      this._currentInput = "";
      this._activeSuggestion = null;
      this._hideOverlay();
      return;
    }

    // Ctrl-U — kill line
    if (data === "\x15") {
      this._currentInput = "";
      this._activeSuggestion = null;
      this._hideOverlay();
      return;
    }

    // Ctrl-W — kill word
    if (data === "\x17") {
      const trimmed = this._currentInput.trimEnd();
      const lastSpace = trimmed.lastIndexOf(" ");
      this._currentInput = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : "";
      this._updateSuggestion();
      return;
    }

    // Ignore other escape sequences (arrows, function keys, etc.)
    if (data.startsWith("\x1b") || data.charCodeAt(0) < 32) {
      console.log("[AutoSuggest] Ignoring control sequence:", data.split('').map(c => c.charCodeAt(0)));
      this._activeSuggestion = null;
      this._hideOverlay();
      return;
    }

    // Regular printable character(s)
    this._currentInput += data;
    console.log("[AutoSuggest] Input updated:", this._currentInput);
    this._updateSuggestion();
  }

  // ---- Private: suggestion matching ---------------------------------------

  private _updateSuggestion(): void {
    this._activeSuggestion = null;
    this._hideOverlay();

    if (!this._terminal || this._currentInput.length === 0 || !usePreferencesStore.getState().terminalAutoSuggestEnabled) {
      return;
    }

    const input = this._currentInput;

    // Search custom suggestions first, then history (most recent → oldest), then built-in commands.
    const customSuggestions = usePreferencesStore.getState().terminalCustomSuggestions;
    const historyArr = Array.from(this._history).reverse();

    const match =
      customSuggestions.find((cmd) => cmd.startsWith(input) && cmd !== input) ??
      historyArr.find((cmd) => cmd.startsWith(input) && cmd !== input) ??
      BUILTIN_COMMANDS.find((cmd) => cmd.startsWith(input) && cmd !== input);

    if (match) {
      this._activeSuggestion = match;
      // Defer rendering slightly so the terminal processes the keystroke first.
      requestAnimationFrame(() => this._showOverlay());
    }
  }

  // ---- Private: overlay rendering -----------------------------------------

  /**
   * Lazily create and attach the overlay element. Called on the first render
   * attempt, by which point term.open() has been called and terminal.element
   * is available.
   */
  private _ensureOverlay(): HTMLSpanElement | null {
    if (this._overlayEl) return this._overlayEl;
    if (!this._terminal) return null;

    const screenEl = this._terminal.element?.querySelector(".xterm-screen");
    if (!screenEl) return null;

    this._overlayEl = document.createElement("span");
    this._overlayEl.setAttribute("data-terax-autosuggest", "");
    Object.assign(this._overlayEl.style, {
      position: "absolute",
      pointerEvents: "none",
      opacity: "0.45",
      whiteSpace: "pre",
      zIndex: "10",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    (screenEl as HTMLElement).style.position = "relative";
    screenEl.appendChild(this._overlayEl);
    return this._overlayEl;
  }

  private _showOverlay(): void {
    if (!this._terminal || !this._activeSuggestion) return;

    const overlay = this._ensureOverlay();
    if (!overlay) return;

    const remainder = this._activeSuggestion.slice(this._currentInput.length);
    if (!remainder) {
      this._hideOverlay();
      return;
    }

    const term = this._terminal;
    const buf = term.buffer.active;
    const cursorX = buf.cursorX;
    const cursorY = buf.cursorY;

    // Get the cell dimensions from the terminal's internal renderer.
    // `_core` is an internal API but `allowProposedApi: true` is already set.
    const core = (term as unknown as { _core: {
      _renderService: { dimensions: { css: { cell: { width: number; height: number } } } }
    } })._core;
    const cellWidth = core?._renderService?.dimensions?.css?.cell?.width ?? 9;
    const cellHeight = core?._renderService?.dimensions?.css?.cell?.height ?? 17;

    // Use the terminal's foreground color for the ghost text.
    const fgColor = term.options.theme?.foreground ?? "#888";

    // Inherit the terminal's font settings for consistent rendering.
    Object.assign(overlay.style, {
      display: "block",
      left: `${cursorX * cellWidth}px`,
      top: `${cursorY * cellHeight}px`,
      height: `${cellHeight}px`,
      lineHeight: `${cellHeight}px`,
      fontSize: `${term.options.fontSize ?? 14}px`,
      fontFamily: term.options.fontFamily ?? "monospace",
      letterSpacing: `${term.options.letterSpacing ?? 0}px`,
      color: fgColor,
    });

    console.log("[AutoSuggest] Rendered overlay:", {
      remainder, left: overlay.style.left, top: overlay.style.top,
      cursorX, cursorY, cellWidth, cellHeight
    });

    overlay.textContent = remainder;
  }

  private _hideOverlay(): void {
    if (this._overlayEl) {
      this._overlayEl.style.display = "none";
      this._overlayEl.textContent = "";
    }
  }

  // ---- Private: history management ----------------------------------------

  private _trimHistory(): void {
    if (this._history.size <= MAX_HISTORY) return;
    const excess = this._history.size - MAX_HISTORY;
    let removed = 0;
    for (const val of this._history) {
      if (removed >= excess) break;
      this._history.delete(val);
      removed++;
    }
  }
}

/** Global helper to wipe history. */
export async function clearTerminalHistory(): Promise<void> {
  // Clear localStorage for future launches
  localStorage.removeItem(STORAGE_KEY);
  // Broadcast to all active addons to clear their memory caches
  await emit("terax:clear-cmd-history");
}
