/**
 * Port of Terax's agent detector (src-tauri/src/modules/pty/agent_detect.rs)
 * for one Claude run: finds the hook marker
 * `OSC 777;notify;Terax;claude;<event>[;<session uuid>]` in the terminal's
 * output stream and turns it into Reader signals. Output is untrusted, so only
 * known events and UUID-shaped session ids get through.
 */

export type OscSignal =
  | { kind: "working" }
  | { kind: "attention" }
  | { kind: "finished" }
  | { kind: "linked"; session: string };

const ESC = "\x1b";
const BEL = "\x07";
const OSC_MAX = 2048;
const MARKER = "notify;Terax;";
const AGENTS = new Set(["claude", "codex", "gemini", "pi", "opencode", "grok"]);
const SESSION_ID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
/** A plain OSC 9 / foreign OSC 777 repeat within this window is the same moment. */
const ATTENTION_REPEAT_MS = 3000;

type State = "ground" | "esc" | "osc" | "oscEsc";

export class OscSignalParser {
  private state: State = "ground";
  private body = "";
  private waiting = false;
  private lastAttention = 0;
  private session: string | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Feeds one chunk of output; returns the signals it completed. */
  feed(chunk: string): OscSignal[] {
    const out: OscSignal[] = [];
    let i = 0;
    while (i < chunk.length) {
      switch (this.state) {
        case "ground": {
          const esc = chunk.indexOf(ESC, i);
          if (esc < 0) return out;
          this.state = "esc";
          i = esc + 1;
          break;
        }
        case "esc": {
          const c = chunk[i++];
          if (c === "]") {
            this.state = "osc";
            this.body = "";
          } else if (c !== ESC) {
            this.state = "ground";
          }
          break;
        }
        case "osc": {
          let end = i;
          while (end < chunk.length && chunk[end] !== BEL && chunk[end] !== ESC) {
            end += 1;
          }
          const room = OSC_MAX - this.body.length;
          if (end - i > room) {
            this.body = "";
            this.state = "ground";
            i += room + 1;
            break;
          }
          this.body += chunk.slice(i, end);
          i = end;
          if (i < chunk.length) {
            if (chunk[i] === BEL) {
              this.finish(out);
              this.state = "ground";
            } else {
              this.state = "oscEsc";
            }
            i += 1;
          }
          break;
        }
        case "oscEsc": {
          const c = chunk[i++];
          if (c === "\\") {
            this.finish(out);
            this.state = "ground";
          } else if (c !== ESC) {
            this.body = "";
            this.state = "ground";
          }
          break;
        }
      }
    }
    return out;
  }

  private finish(out: OscSignal[]): void {
    const body = this.body;
    this.body = "";
    const semi = body.indexOf(";");
    const ps = semi < 0 ? body : body.slice(0, semi);
    const pt = semi < 0 ? "" : body.slice(semi + 1);
    if (ps === "777") this.osc777(pt, out);
    else if (ps === "9" && pt !== "4" && !pt.startsWith("4;")) {
      this.genericAttention(out);
    }
  }

  private osc777(pt: string, out: OscSignal[]): void {
    if (!pt.startsWith(MARKER)) {
      this.genericAttention(out);
      return;
    }
    const tail = pt.slice(MARKER.length);
    let rest = tail;
    const agentEnd = tail.indexOf(";");
    if (agentEnd >= 0) {
      if (!AGENTS.has(tail.slice(0, agentEnd))) return;
      rest = tail.slice(agentEnd + 1);
    }
    const idAt = rest.indexOf(";");
    const event = idAt < 0 ? rest : rest.slice(0, idAt);
    const id = idAt < 0 ? null : rest.slice(idAt + 1);
    if (event !== "working" && event !== "attention" && event !== "finished") {
      return;
    }
    if (id && SESSION_ID.test(id) && id !== this.session) {
      this.session = id;
      out.push({ kind: "linked", session: id });
    }
    if (event === "working") {
      if (this.waiting) {
        this.waiting = false;
        out.push({ kind: "working" });
      }
      return;
    }
    this.waiting = true;
    this.lastAttention = this.now();
    out.push({ kind: event });
  }

  private genericAttention(out: OscSignal[]): void {
    const now = this.now();
    if (this.waiting && now - this.lastAttention < ATTENTION_REPEAT_MS) return;
    this.waiting = true;
    this.lastAttention = now;
    out.push({ kind: "attention" });
  }
}

/**
 * Whether a shell command line runs Claude Code: any non-flag token whose
 * basename is `claude` or starts with `claude-` (same rule as Terax's
 * detector, so `npx claude`, `~/bin/claude --resume x` and `claude-dev` match).
 */
export function isClaudeCommand(commandLine: string): boolean {
  for (const token of commandLine.trim().split(/\s+/u)) {
    if (!token || token.startsWith("-")) continue;
    const base = token.replace(/^["']|["']$/gu, "").split("/").pop() ?? "";
    if (base === "claude" || base.startsWith("claude-")) return true;
  }
  return false;
}
