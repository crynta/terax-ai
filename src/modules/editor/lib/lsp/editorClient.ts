import type { Diagnostic } from "@codemirror/lint";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { LspDocumentClient } from "./client";
import type { HoverBlock } from "./hoverContent";
import type { LspDefinitionTarget } from "./client";
import type { LspRange } from "./protocol";

export type LspInlayHintDisplay = {
  pos: number;
  label: string;
};

/** Surface shared by single and composite LSP document clients. */
export type LspEditorClient = {
  path: string;
  getInactiveRegions(): LspRange[];
  getDiagnosticsForText(text: string): Diagnostic[];
  onDiagnostics(listener: () => void): () => void;
  scheduleChange(text: string): void;
  syncEditor(text: string): void;
  closeDocument(): void;
  hoverAt(offset: number, text?: string): Promise<HoverBlock[] | null>;
  completionAt(
    context: CompletionContext,
    text: string,
  ): Promise<CompletionResult | null>;
  definitionAt(
    offset: number,
    text?: string,
  ): Promise<LspDefinitionTarget | null>;
  linkableRangeAt(
    offset: number,
    text?: string,
  ): Promise<{ from: number; to: number } | null>;
  hasInlayHints(): boolean;
  inlayHintsAt(text: string): Promise<LspInlayHintDisplay[]>;
  onInlayHints(listener: () => void): () => void;
};

export class CompositeLspDocumentClient implements LspEditorClient {
  readonly path: string;

  constructor(
    path: string,
    private readonly clients: LspDocumentClient[],
    private readonly inlayClient: LspDocumentClient | null,
  ) {
    this.path = path;
  }

  getInactiveRegions(): LspRange[] {
    return this.clients.flatMap((c) => c.getInactiveRegions());
  }

  getDiagnosticsForText(text: string): Diagnostic[] {
    return this.clients.flatMap((c) => c.getDiagnosticsForText(text));
  }

  onDiagnostics(listener: () => void): () => void {
    const unsubs = this.clients.map((c) => c.onDiagnostics(listener));
    return () => unsubs.forEach((u) => u());
  }

  scheduleChange(text: string) {
    for (const c of this.clients) c.scheduleChange(text);
  }

  syncEditor(text: string) {
    for (const c of this.clients) c.syncEditor(text);
  }

  closeDocument() {
    for (const c of this.clients) c.closeDocument();
  }

  async hoverAt(offset: number, text?: string): Promise<HoverBlock[] | null> {
    for (const c of this.clients) {
      const blocks = await c.hoverAt(offset, text);
      if (blocks?.length) return blocks;
    }
    return null;
  }

  async completionAt(
    context: CompletionContext,
    text: string,
  ): Promise<CompletionResult | null> {
    for (const c of this.clients) {
      const result = await c.completionAt(context, text);
      if (result?.options?.length) return result;
    }
    return null;
  }

  async definitionAt(
    offset: number,
    text?: string,
  ): Promise<LspDefinitionTarget | null> {
    for (const c of this.clients) {
      const target = await c.definitionAt(offset, text);
      if (target) return target;
    }
    return null;
  }

  async linkableRangeAt(
    offset: number,
    text?: string,
  ): Promise<{ from: number; to: number } | null> {
    for (const c of this.clients) {
      const range = await c.linkableRangeAt(offset, text);
      if (range) return range;
    }
    return null;
  }

  hasInlayHints(): boolean {
    return this.inlayClient?.hasInlayHints() ?? false;
  }

  async inlayHintsAt(text: string): Promise<LspInlayHintDisplay[]> {
    if (!this.inlayClient) return [];
    return this.inlayClient.inlayHintsAt(text);
  }

  onInlayHints(listener: () => void): () => void {
    return this.inlayClient?.onInlayHints(listener) ?? (() => {});
  }

  /** Underlying clients — used when releasing pooled server refs. */
  underlyingClients(): LspDocumentClient[] {
    return this.clients;
  }
}
