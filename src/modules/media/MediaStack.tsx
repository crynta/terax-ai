import { cn } from "@/lib/utils";
import type { MediaTab, Tab } from "@/modules/tabs";
import { MediaPane } from "./components/MediaPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function MediaStack({ tabs, activeId }: Props) {
  const medias = tabs.filter((t): t is MediaTab => t.kind === "media");
  if (medias.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {medias.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <MediaPane
              path={t.path}
              mediaKind={t.mediaKind}
              visible={visible}
            />
          </div>
        );
      })}
    </div>
  );
}
