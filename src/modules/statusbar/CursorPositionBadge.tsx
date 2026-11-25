import { useCursorStore } from "@/modules/editor";

type Props = {
  filePath: string | null;
};

export function CursorPositionBadge({ filePath }: Props) {
  const position = useCursorStore((s) =>
    filePath ? s.byPath[filePath] : undefined,
  );
  if (!position) return null;

  return (
    <span className="shrink-0 cursor-default text-[10.5px] font-medium tabular-nums text-muted-foreground">
      Ln {position.line}, Col {position.col}
    </span>
  );
}
