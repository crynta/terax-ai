import { useCallback, useState } from "react";
import { SearchInput } from "./SearchInput";
import { SearchResultsList } from "./SearchResultsList";
import { executeSearch } from "./lib/searchHits";
import type { GrepResponse, SearchModifiers } from "./lib/types";

type Props = {
  rootPath: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onGoToLine: (path: string, line: number) => void;
};

export function SearchPanel({ rootPath, onOpenFile, onGoToLine }: Props) {
  const [response, setResponse] = useState<GrepResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pattern, setPattern] = useState("");

  const handleSearch = useCallback(
    async (raw: string, modifiers: SearchModifiers) => {
      setPattern(raw);
      if (!raw.trim() || !rootPath) {
        setResponse(null);
        return;
      }
      setLoading(true);
      try {
        const result = await executeSearch(raw, rootPath, modifiers);
        setResponse(result);
      } catch {
        setResponse(null);
      } finally {
        setLoading(false);
      }
    },
    [rootPath],
  );

  const handleSelectHit = useCallback(
    (path: string, line: number) => {
      onOpenFile(path, true);
      onGoToLine(path, line);
    },
    [onOpenFile, onGoToLine],
  );

  return (
    <div className="flex h-full flex-col">
      <SearchInput onSearch={handleSearch} loading={loading} />
      <SearchResultsList
        response={response}
        pattern={pattern}
        onSelectHit={handleSelectHit}
      />
    </div>
  );
}
