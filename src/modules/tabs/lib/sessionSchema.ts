/** Storage schema for a saved tab session. Versioned so future tab-kind
 *  additions don't break old saves. */
export const SESSION_SCHEMA_VERSION = 1 as const;

export type SerializedPaneNode =
  | {
      kind: "leaf";
      id: number;
      cwd: string | null;
      /**
       * xterm SerializeAddon scrollback snapshot (display-only). Re-rendered
       * into the fresh terminal on restore so the user sees their prior
       * history above the new prompt. Optional + size-capped at save time;
       * omitted when empty. Old saves without it still load.
       */
      snapshot?: string;
    }
  | {
      kind: "split";
      id: number;
      dir: "row" | "col";
      children: SerializedPaneNode[];
      /** Per-child sizes (percent, sums to ~100); optional. */
      sizes?: number[];
    };

export type SerializedTerminalTab = {
  kind: "terminal";
  id: number;
  title: string;
  cwd: string | null;
  paneTree: SerializedPaneNode;
  activeLeafId: number;
  private?: boolean;
};

export type SerializedEditorTab = {
  kind: "editor";
  id: number;
  path: string;
};

export type SerializedMarkdownTab = {
  kind: "markdown";
  id: number;
  path: string;
};

export type SerializedTab =
  | SerializedTerminalTab
  | SerializedEditorTab
  | SerializedMarkdownTab;

export type SessionV1 = {
  version: 1;
  updatedAt: number;
  activeTabId: number | null;
  tabs: SerializedTab[];
};
