import type { Diagnostic } from "@codemirror/lint";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import {
  isInactiveCodeDiagnostic,
  lspSeverityToCm,
  offsetToPosition,
  pathToUri,
  uriToPath,
  type LspDiagnosticCode,
  type LspRange,
} from "./protocol";
import type { LspConnection } from "./connection";
import { lspDebugPatch, lspDebugPush } from "./debugStore";
import { parseHoverContents, type HoverBlock } from "./hoverContent";
import type { LspInlayHintDisplay } from "./editorClient";

type LspDiagnostic = {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
  code?: LspDiagnosticCode;
};

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: LspDiagnostic[];
};

function rangeToOffsets(
  text: string,
  range: LspRange,
): { from: number; to: number } {
  const lines = text.split("\n");
  const lineStart = (line: number) => {
    let off = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      off += lines[i].length + 1;
    }
    return off;
  };
  const from = lineStart(range.start.line) + range.start.character;
  const to = lineStart(range.end.line) + range.end.character;
  return { from, to };
}

type CompletionItem = {
  label: string | { label: string };
  kind?: number;
  detail?: string;
  filterText?: string;
  insertText?: string;
  sortText?: string;
  textEdit?: { range: LspRange; newText: string };
  data?: unknown;
};

function itemLabel(item: CompletionItem): string {
  return typeof item.label === "string" ? item.label : String(item.label);
}

function isAfterTriggerChar(before: string): boolean {
  return (
    before.endsWith("::") ||
    before.endsWith(".") ||
    before.endsWith("(") ||
    before.endsWith("#") ||
    before.endsWith("'") ||
    before.endsWith('"')
  );
}

function keepCompletionItem(label: string, typed: string): boolean {
  if (label.startsWith("__cmd_")) return false;
  if (label.startsWith("__") && label.endsWith("!")) return false;
  if (typed.includes("::")) {
    if (label === "self::" || label === "crate::" || label === "super::") {
      return false;
    }
  }
  return true;
}

type LspLocation = {
  uri: string;
  range: LspRange;
};

type LspLocationLink = {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
};

export type LspDefinitionTarget = {
  path: string;
  line: number;
  character: number;
  originFrom: number;
  originTo: number;
};

function pickDefinitionLocation(
  result: unknown,
  text: string,
  offset: number,
): { uri: string; range: LspRange; originFrom: number; originTo: number } | null {
  if (!result) return null;
  const items = Array.isArray(result) ? result : [result];
  const first = items[0] as LspLocation | LspLocationLink | undefined;
  if (!first) return null;
  if ("targetUri" in first && first.targetUri) {
    const range = first.targetSelectionRange ?? first.targetRange;
    const origin = first.originSelectionRange
      ? rangeToOffsets(text, first.originSelectionRange)
      : expandWordRange(text, offset);
    return {
      uri: first.targetUri,
      range,
      originFrom: origin.from,
      originTo: origin.to,
    };
  }
  if ("uri" in first && first.uri && first.range) {
    const origin = expandWordRange(text, offset);
    return {
      uri: first.uri,
      range: first.range,
      originFrom: origin.from,
      originTo: origin.to,
    };
  }
  return null;
}

function expandWordRange(text: string, offset: number): { from: number; to: number } {
  const word = /[\w$]+/g;
  let from = offset;
  let to = offset;
  let match: RegExpExecArray | null;
  while ((match = word.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      from = start;
      to = end;
      break;
    }
  }
  return { from, to };
}

function completionKind(kind: number): string {
  const map: Record<number, string> = {
    3: "function",
    6: "variable",
    7: "constant",
    8: "type",
    9: "class",
    14: "keyword",
    15: "text",
  };
  return map[kind] ?? "text";
}

function formatHoverContents(contents: unknown): HoverBlock[] {
  return parseHoverContents(contents);
}

export class LspDocumentClient {
  private readonly uri: string;
  private version = 0;
  /** Last document text acknowledged by didOpen/didChange. */
  private syncedText: string;
  private rawDiagnostics: PublishDiagnosticsParams["diagnostics"] = [];
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pullDiagnosticsEnabled: boolean;
  private readonly inlayHintsEnabled: boolean;
  private inlayHintTimer: ReturnType<typeof setTimeout> | null = null;
  private inlayHintListeners = new Set<() => void>();
  private diagnosticsListeners = new Set<() => void>();
  private completionRequestId = 0;
  /** Bumped on each didChange / local edit — stale pull responses are ignored. */
  private diagnosticPullId = 0;

  constructor(
    readonly path: string,
    private text: string,
    private readonly languageId: string,
    private readonly connection: LspConnection,
    opts?: { pullDiagnostics?: boolean; inlayHints?: boolean },
  ) {
    this.uri = pathToUri(path);
    this.syncedText = text;
    this.pullDiagnosticsEnabled = opts?.pullDiagnostics ?? false;
    this.inlayHintsEnabled = opts?.inlayHints ?? false;
    this.openDocument(text);
  }

  private applyDiagnosticItems(
    items: PublishDiagnosticsParams["diagnostics"],
  ) {
    this.rawDiagnostics = items;
    // Explorer badges are updated only from textDocument/publishDiagnostics in
    // manager.ts — pull results must not wipe counts on other open documents.
    lspDebugPush(
      "info",
      "diagnostics",
      `${items.length} for ${this.path}`,
    );
    lspDebugPatch({ diagnosticCount: items.length });
    for (const listener of this.diagnosticsListeners) listener();
    if (this.inlayHintsEnabled) this.scheduleInlayHintRefresh();
  }

  hasInlayHints(): boolean {
    return this.inlayHintsEnabled;
  }

  onInlayHints(listener: () => void): () => void {
    this.inlayHintListeners.add(listener);
    return () => this.inlayHintListeners.delete(listener);
  }

  private scheduleInlayHintRefresh() {
    if (this.inlayHintTimer) clearTimeout(this.inlayHintTimer);
    this.inlayHintTimer = setTimeout(() => {
      this.inlayHintTimer = null;
      for (const listener of this.inlayHintListeners) listener();
    }, 400);
  }

  /** Ranges for #[cfg]-inactive code (styled separately, not as lint squiggles). */
  getInactiveRegions(): LspRange[] {
    return this.rawDiagnostics
      .filter(isInactiveCodeDiagnostic)
      .map((d) => d.range);
  }

  /** Map LSP ranges to CM offsets using the live editor text. */
  getDiagnosticsForText(text: string): Diagnostic[] {
    const len = text.length;
    return this.rawDiagnostics
      .filter((d) => !isInactiveCodeDiagnostic(d))
      .map((d) => {
      const { from, to } = rangeToOffsets(text, d.range);
      const clampedFrom = Math.max(0, Math.min(from, len));
      let clampedTo = Math.max(0, Math.min(to, len));
      if (clampedTo <= clampedFrom && clampedFrom < len) {
        clampedTo = clampedFrom + 1;
      }
        return {
          from: clampedFrom,
          to: clampedTo,
          severity: lspSeverityToCm(d.severity),
          message: d.message,
          source: d.source,
        };
      });
  }

  hasDiagnostics(): boolean {
    return this.rawDiagnostics.length > 0;
  }

  applyExternalDiagnostics(items: PublishDiagnosticsParams["diagnostics"]) {
    // Server push is authoritative — drop any in-flight pull responses.
    this.diagnosticPullId += 1;
    this.applyDiagnosticItems(items);
  }

  private schedulePullDiagnostics() {
    if (!this.pullDiagnosticsEnabled || this.version < 1) return;
    this.diagnosticPullId += 1;
    if (this.pullTimer) clearTimeout(this.pullTimer);
    const delay = this.languageId === "rust" ? 900 : 350;
    const pullId = this.diagnosticPullId;
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null;
      void this.pullDiagnostics(pullId);
    }, delay);
  }

  /** Reattach editor view — never send duplicate didOpen. */
  syncEditor(text: string) {
    this.text = text;
    if (this.version < 1) {
      this.openDocument(text);
      return;
    }
    if (text === this.syncedText) {
      if (this.changeTimer) {
        clearTimeout(this.changeTimer);
        this.changeTimer = null;
      }
      return;
    }
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    this.pushChange(text);
  }

  private async pullDiagnostics(
    pullId: number,
    attempt = 0,
  ): Promise<void> {
    if (pullId !== this.diagnosticPullId) return;
    const versionAtStart = this.version;
    try {
      if (this.text !== this.syncedText) {
        this.pushChange(this.text);
      }
      if (pullId !== this.diagnosticPullId) return;
      const result = (await this.connection.request("textDocument/diagnostic", {
        textDocument: { uri: this.uri },
      })) as {
        kind?: string;
        items?: PublishDiagnosticsParams["diagnostics"];
      } | null;
      if (pullId !== this.diagnosticPullId) return;
      if (versionAtStart !== this.version) return;
      if (result?.kind === "full") {
        this.applyDiagnosticItems(result.items ?? []);
      }
    } catch (e) {
      if (pullId !== this.diagnosticPullId) return;
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("cancelled") && attempt < 4) {
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * (attempt + 1)),
        );
        return this.pullDiagnostics(pullId, attempt + 1);
      }
      if (attempt === 0) {
        lspDebugPush("warn", "pullDiagnostics failed", message);
      }
    }
  }

  onDiagnostics(listener: () => void): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  openDocument(text: string) {
    this.text = text;
    this.syncedText = text;
    this.version = 1;
    this.connection.notify("textDocument/didOpen", {
      textDocument: {
        uri: this.uri,
        languageId: this.languageId,
        version: this.version,
        text,
      },
    });
    this.schedulePullDiagnostics();
    if (this.inlayHintsEnabled) this.scheduleInlayHintRefresh();
  }

  scheduleChange(text: string) {
    const changed = text !== this.syncedText;
    this.text = text;
    if (!changed) {
      if (this.changeTimer) {
        clearTimeout(this.changeTimer);
        this.changeTimer = null;
      }
      return;
    }
    // Local edit — ignore in-flight diagnostic pulls for the previous server snapshot.
    this.diagnosticPullId += 1;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    const debounce = this.languageId === "rust" ? 500 : 300;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.pushChange(text);
    }, debounce);
  }

  /** Flush pending edits and give the server a moment before queries. */
  private async ensureSyncedForQuery(
    text: string,
    immediate = false,
  ): Promise<void> {
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    if (text !== this.syncedText) {
      this.pushChange(text);
      if (!immediate) {
        const delay = this.languageId === "rust" ? 80 : 25;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private lspCompletionContext(
    context: CompletionContext,
    text: string,
  ): { triggerKind: number; triggerCharacter?: string } {
    if (context.explicit) return { triggerKind: 1 };
    const before = text.slice(0, context.pos);
    const trigger = before.slice(-1);
    if (
      trigger === ":" ||
      trigger === "." ||
      trigger === "(" ||
      trigger === "'" ||
      trigger === "#"
    ) {
      return { triggerKind: 2, triggerCharacter: trigger };
    }
    return { triggerKind: 1 };
  }

  /** CM filters options by text between `from` and cursor — use only the leaf token. */
  private completionReplaceFrom(context: CompletionContext, text: string): number {
    const pos = context.pos;
    const before = text.slice(0, pos);
    if (isAfterTriggerChar(before)) return pos;
    const leaf = before.match(/[\w$]+$/);
    if (leaf) return pos - leaf[0].length;
    return pos;
  }

  private async requestCompletionItems(
    pos: ReturnType<typeof offsetToPosition>,
    context: { triggerKind: number; triggerCharacter?: string },
  ) {
    return (await this.connection.request("textDocument/completion", {
      textDocument: { uri: this.uri },
      position: pos,
      context,
    })) as { items?: CompletionItem[]; isIncomplete?: boolean } | CompletionItem[] | null;
  }

  private textEditFrom(
    text: string,
    range: LspRange,
    cursorOffset: number,
  ): number | null {
    const cursorLine = offsetToPosition(text, cursorOffset).line;
    if (range.start.line !== cursorLine) return null;
    return rangeToOffsets(text, range).from;
  }

  private pushChange(text: string) {
    this.text = text;
    this.syncedText = text;
    this.version += 1;
    this.connection.notify("textDocument/didChange", {
      textDocument: { uri: this.uri, version: this.version },
      contentChanges: [{ text }],
    });
    this.schedulePullDiagnostics();
    if (this.inlayHintsEnabled) this.scheduleInlayHintRefresh();
  }

  closeDocument() {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    if (this.inlayHintTimer) clearTimeout(this.inlayHintTimer);
    if (this.pullTimer) clearTimeout(this.pullTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.version < 1) return;
    this.version = 0;
    this.connection.notify("textDocument/didClose", {
      textDocument: { uri: this.uri },
    });
  }

  getDiagnostics(): Diagnostic[] {
    return this.getDiagnosticsForText(this.text);
  }

  async definitionAt(
    offset: number,
    text = this.text,
  ): Promise<LspDefinitionTarget | null> {
    await this.ensureSyncedForQuery(text);
    const pos = offsetToPosition(text, offset);
    const result = await this.connection.request("textDocument/definition", {
      textDocument: { uri: this.uri },
      position: pos,
    });
    const location = pickDefinitionLocation(result, text, offset);
    if (!location) {
      lspDebugPush("info", "definition empty", `at ${pos.line}:${pos.character}`);
      return null;
    }
    return {
      path: uriToPath(location.uri),
      line: location.range.start.line + 1,
      character: location.range.start.character,
      originFrom: location.originFrom,
      originTo: location.originTo,
    };
  }

  async linkableRangeAt(
    offset: number,
    text = this.text,
  ): Promise<{ from: number; to: number } | null> {
    await this.ensureSyncedForQuery(text);
    const pos = offsetToPosition(text, offset);
    const [defResult, hoverResult] = await Promise.all([
      this.connection.request("textDocument/definition", {
        textDocument: { uri: this.uri },
        position: pos,
      }),
      this.connection.request("textDocument/hover", {
        textDocument: { uri: this.uri },
        position: pos,
      }),
    ]);
    if (!pickDefinitionLocation(defResult, text, offset)) return null;
    const hover = hoverResult as { range?: LspRange } | null;
    if (hover?.range) return rangeToOffsets(text, hover.range);
    const location = pickDefinitionLocation(defResult, text, offset);
    if (location) return { from: location.originFrom, to: location.originTo };
    return null;
  }

  async hoverAt(offset: number, text = this.text): Promise<HoverBlock[] | null> {
    await this.ensureSyncedForQuery(text);
    const pos = offsetToPosition(text, offset);
    const result = (await this.connection.request("textDocument/hover", {
      textDocument: { uri: this.uri },
      position: pos,
    })) as { contents?: unknown } | null;
    const blocks = formatHoverContents(result?.contents);
    return blocks.length > 0 ? blocks : null;
  }

  async documentHighlightAt(
    offset: number,
  ): Promise<Array<{ from: number; to: number }>> {
    const pos = offsetToPosition(this.text, offset);
    const result = (await this.connection.request(
      "textDocument/documentHighlight",
      {
        textDocument: { uri: this.uri },
        position: pos,
      },
    )) as Array<{ range: LspRange }> | null;
    if (!result?.length) return [];
    return result.map((entry) => {
      const { from, to } = rangeToOffsets(this.text, entry.range);
      return { from, to };
    });
  }

  async completionAt(
    context: CompletionContext,
    text: string,
  ): Promise<CompletionResult | null> {
    const requestId = ++this.completionRequestId;
    await this.ensureSyncedForQuery(text, context.explicit);
    if (requestId !== this.completionRequestId) return null;

    const pos = offsetToPosition(text, context.pos);
    const completionContext = this.lspCompletionContext(context, text);
    let result = await this.requestCompletionItems(pos, completionContext);

    const empty =
      !result ||
      (Array.isArray(result) ? result.length === 0 : (result.items ?? []).length === 0);
    if (empty && completionContext?.triggerKind === 2) {
      result = await this.requestCompletionItems(pos, { triggerKind: 1 });
    }

    if (requestId !== this.completionRequestId) return null;
    if (!result) return null;

    const replaceFrom = this.completionReplaceFrom(context, text);
    let from = replaceFrom;
    const typed = text.slice(from, context.pos);
    const triggered = completionContext.triggerKind === 2;

    let rawItems = Array.isArray(result) ? result : (result.items ?? []);
    if (!triggered) {
      const filtered = rawItems.filter((item) =>
        keepCompletionItem(itemLabel(item), typed),
      );
      rawItems =
        filtered.length > 0
          ? filtered
          : rawItems.filter((item) => !itemLabel(item).startsWith("__cmd_"));
    } else {
      rawItems = rawItems.filter(
        (item) => !itemLabel(item).startsWith("__cmd_"),
      );
    }
    if (rawItems.length === 0) return null;

    const afterTrigger = triggered || replaceFrom === context.pos;
    if (!afterTrigger) {
      for (const item of rawItems) {
        if (!item.textEdit) continue;
        const editFrom = this.textEditFrom(text, item.textEdit.range, context.pos);
        if (editFrom != null && editFrom >= replaceFrom) {
          from = Math.min(from, editFrom);
        }
      }
      from = Math.max(from, replaceFrom);
      if (from > context.pos) from = replaceFrom;
    }

    const options: Completion[] = rawItems.slice(0, 64).map((item) => {
      const label = itemLabel(item);
      let apply = item.insertText ?? label;
      if (item.textEdit) {
        const editFrom = this.textEditFrom(text, item.textEdit.range, context.pos);
        if (
          afterTrigger ||
          (editFrom != null && editFrom >= replaceFrom)
        ) {
          apply = item.textEdit.newText;
        }
      }
      return {
        label,
        type: item.kind ? completionKind(item.kind) : undefined,
        detail: item.detail,
        apply,
        boost: item.sortText?.startsWith("0") ? 1 : 0,
      };
    });

    lspDebugPush(
      "info",
      "completion",
      `${options.length} at ${pos.line}:${pos.character} from=${from}${afterTrigger ? ` trigger${completionContext.triggerCharacter ? `:${completionContext.triggerCharacter}` : ""}` : ""}`,
    );
    if (afterTrigger) {
      // After :: . # ( — CM must not match options against the full path prefix.
      return { from, options, filter: false };
    }
    return {
      from,
      options,
      validFor: /^[\w$.:#'(-]*$/,
    };
  }

  async inlayHintsAt(text: string): Promise<LspInlayHintDisplay[]> {
    if (!this.inlayHintsEnabled) return [];
    await this.ensureSyncedForQuery(text);
    const lines = text.split("\n");
    const lastLine = lines.length > 0 ? lines.length - 1 : 0;
    const lastChar = lines[lastLine]?.length ?? 0;
    try {
      const result = (await this.connection.request("textDocument/inlayHint", {
        textDocument: { uri: this.uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLine, character: lastChar },
        },
      })) as
        | Array<{ position: LspRange["start"]; label: unknown }>
        | { hints?: Array<{ position: LspRange["start"]; label: unknown }> }
        | null;
      const raw = Array.isArray(result) ? result : (result?.hints ?? []);
      return raw.map((hint) => ({
        pos: rangeToOffsets(text, {
          start: hint.position,
          end: hint.position,
        }).from,
        label: formatInlayLabel(hint.label),
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      lspDebugPush("warn", "inlayHint failed", message);
      return [];
    }
  }
}

function formatInlayLabel(label: unknown): string {
  if (typeof label === "string") return label;
  if (Array.isArray(label)) {
    return label
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "value" in part) {
          return String((part as { value: unknown }).value);
        }
        return "";
      })
      .join("");
  }
  if (label && typeof label === "object" && "value" in label) {
    return String((label as { value: unknown }).value);
  }
  return "";
}
