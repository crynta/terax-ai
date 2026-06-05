export type BlockMeta = {
  id: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  startLine: number;
  endLine: number;
};
