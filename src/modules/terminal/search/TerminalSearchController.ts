export type TerminalSearchOptions = {
  readonly incremental?: boolean;
  readonly decorations?: {
    readonly matchBackground?: string;
    readonly activeMatchBackground?: string;
    readonly matchOverviewRuler?: string;
    readonly activeMatchColorOverviewRuler?: string;
  };
};

export type SearchMatchStatus = {
  readonly current: number;
  readonly total: number;
  readonly complete: boolean;
};

export interface TerminalSearchController {
  findNext(query: string, options?: TerminalSearchOptions): boolean;
  findPrevious(query: string, options?: TerminalSearchOptions): boolean;
  clearDecorations(): void;
  matchStatus(): SearchMatchStatus;
  subscribe(listener: () => void): () => void;
}
