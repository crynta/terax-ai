import type { SearchMatchStatus } from "@/modules/terminal/search/TerminalSearchController";

export type { SearchMatchStatus };

export function formatSearchCount(
  query: string,
  status: SearchMatchStatus | null,
): string | null {
  if (!query || !status) return null;
  if (status.total === 0) return status.complete ? "0" : null;
  const current = status.current > 0 ? status.current : 1;
  return `${current}/${status.total}`;
}

export function searchMissed(
  query: string,
  status: SearchMatchStatus | null,
): boolean {
  return Boolean(query && status?.complete && status.total === 0);
}
