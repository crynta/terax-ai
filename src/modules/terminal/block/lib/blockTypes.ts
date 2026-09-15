export type BlockContext = {
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
};

export type PositionedBlock = {
  id: string;
  command: string;
  canRerun: boolean;
  cwd: string;
  exitCode: number | null;
  running: boolean;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  top: number;
  bottom: number;
  // Pixel top of the header row (one line above the command, in the blank gap).
  headerTop: number;
};

export type VisibleBlocks = {
  blocks: PositionedBlock[];
  sticky: PositionedBlock | null;
  generation: number;
};

export type BlockMatch = { line: number; col: number; len: number };
