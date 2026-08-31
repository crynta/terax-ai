export type TerminalSearchOptions = {
  readonly incremental?: boolean;
  readonly decorations?: {
    readonly matchBackground?: string;
    readonly activeMatchBackground?: string;
    readonly matchOverviewRuler?: string;
    readonly activeMatchColorOverviewRuler?: string;
  };
};

export interface TerminalSearchController {
  findNext(query: string, options?: TerminalSearchOptions): boolean;
  findPrevious(query: string, options?: TerminalSearchOptions): boolean;
  clearDecorations(): void;
}
