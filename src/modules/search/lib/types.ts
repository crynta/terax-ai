/** Mirrors Rust GrepHit from src-tauri/src/modules/fs/grep.rs */
export type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

/** Mirrors Rust GrepResponse from grep.rs */
export type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

export type SearchModifiers = {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
};
