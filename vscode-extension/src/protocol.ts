/**
 * Messages between the extension host and the Reader webview. Shared by both
 * builds, so keep it free of runtime imports.
 */

export type ReaderPhase = "working" | "attention" | "finished" | "idle";

/** `vscode` follows the active VS Code color theme; `tokyo-night` is Terax's look. */
export type ReaderTheme = "vscode" | "tokyo-night";

/** `neutral` greys out the accent; `theme` uses the VS Code theme's button colour. */
export type ReaderAccent = "neutral" | "theme";

/** Text sizes in px: Claude's prose (VS Code chat size) and code (editor size). */
export type ReaderFonts = { prose: number; code: number };

/** Everything the webview mirrors about one Claude terminal. */
export type LeafState = {
  leafId: number;
  cwd: string | null;
  /** Visible screen text, rebuilt from the terminal's output stream. */
  screen: string | null;
  bracketedPaste: boolean;
  phase: ReaderPhase | null;
  sessionId: string | null;
  startedAt: number | null;
  /** False when VS Code shell integration isn't reporting this terminal's output. */
  screenAvailable: boolean;
  /** False until the terminal was opened after the extension set TERAX_TERMINAL. */
  hooksAvailable: boolean;
  alive: boolean;
};

/** Host facts the webview needs before it can render. */
export type HostEnv = {
  home: string;
  downloads: string;
  /** `webview.asWebviewUri(file:///)` without the trailing slash. */
  resourceBase: string;
  platform: string;
  theme: ReaderTheme;
  accent: ReaderAccent;
  fonts: ReaderFonts;
};

export type HostToWebview =
  | { type: "init"; leafId: number; env: HostEnv; leaves: LeafState[] }
  | { type: "leaf"; leaf: LeafState }
  | { type: "leafGone"; leafId: number }
  | { type: "theme"; theme: ReaderTheme; accent: ReaderAccent }
  | { type: "fonts"; fonts: ReaderFonts }
  | { type: "rpcResult"; id: number; ok: true; value: unknown }
  | { type: "rpcResult"; id: number; ok: false; error: string };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "rpc"; id: number; cmd: string; args: Record<string, unknown> }
  | { type: "write"; leafId: number; data: string }
  | { type: "log"; level: "info" | "error"; message: string };
