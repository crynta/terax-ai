import {
  Cancel01Icon,
  Folder01Icon,
  PlusSignIcon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";

export type Tab = {
  id: number;
  title: string;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClose: (id: number) => void;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
};

const ICON_BTN =
  "h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5";

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onClose,
  onToggleSidebar,
  onOpenSearch,
  onOpenSettings,
}: Props) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center gap-2 h-10 px-2 border-b border-white/5 bg-black/20 select-none"
      style={{ paddingLeft: 80 /* leave room for macOS traffic lights */ }}
    >
      {/* LEFT — file explorer toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={ICON_BTN}
        onClick={onToggleSidebar}
        title="Files"
      >
        <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.75} />
      </Button>

      {/* CENTER — tabs */}
      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
        <Tabs
          value={String(activeId)}
          onValueChange={(v) => onSelect(Number(v))}
          className="min-w-0 flex-shrink"
        >
          <TabsList className="h-7 bg-transparent p-0 gap-0.5">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={String(t.id)}
                className="group h-7 px-2.5 gap-1.5 text-xs data-[state=active]:bg-white/8 data-[state=active]:text-foreground text-muted-foreground"
              >
                <span className="truncate max-w-[140px]">{t.title}</span>
                {tabs.length > 1 && (
                  <span
                    role="button"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-white/10 rounded p-0.5"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={11}
                      strokeWidth={2}
                    />
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon"
          className={`${ICON_BTN} flex-shrink-0`}
          onClick={onNew}
          title="New tab (⌘T)"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
        </Button>
      </div>

      {/* RIGHT — search, settings */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BTN}
          onClick={onOpenSearch}
          title="Search (⌘F)"
        >
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BTN}
          onClick={onOpenSettings}
          title="Settings"
        >
          <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
