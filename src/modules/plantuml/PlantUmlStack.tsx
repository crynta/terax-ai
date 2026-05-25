import { cn } from "@/lib/utils";
import type { PlantUmlTab, Tab } from "@/modules/tabs";
import { PlantUmlPreviewPane } from "./PlantUmlPreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function PlantUmlStack({ tabs, activeId }: Props) {
  const plantumls = tabs.filter((t): t is PlantUmlTab => t.kind === "plantuml");
  if (plantumls.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {plantumls.map((t) => {
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
            <PlantUmlPreviewPane path={t.path} visible={visible} />
          </div>
        );
      })}
    </div>
  );
}
