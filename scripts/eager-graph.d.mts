export const DEFAULT_WATCH: string[];
export function traceEager(
  entry: string,
  watch?: string[],
): {
  moduleCount: number;
  hits: Map<string, { spec: string; file: string }>;
};
