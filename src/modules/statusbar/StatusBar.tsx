import { AiTools } from "./AiTools";
import { CwdBreadcrumb } from "./CwdBreadcrumb";

type Props = {
  cwd: string | null;
  home: string | null;
  onCd: (path: string) => void;
  aiOpen: boolean;
  canSubmit: boolean;
  onOpenAi: () => void;
  onSubmit: () => void;
};

export function StatusBar({
  cwd,
  home,
  onCd,
  aiOpen,
  canSubmit,
  onOpenAi,
  onSubmit,
}: Props) {
  return (
    <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3">
      <div className="min-w-0 flex-1 truncate">
        <CwdBreadcrumb cwd={cwd} home={home} onCd={onCd} />
      </div>
      <div className="shrink-0">
        <AiTools
          aiOpen={aiOpen}
          canSubmit={canSubmit}
          onOpenAi={onOpenAi}
          onSubmit={onSubmit}
        />
      </div>
    </footer>
  );
}
