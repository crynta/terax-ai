import { Button } from "@/components/ui/button";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import { Settings01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import type { RefObject } from "react";
import { SearchInline, type SearchInlineHandle } from "./SearchInline";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClose: (id: number) => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  searchAddon: SearchAddon | null;
  searchRef: RefObject<SearchInlineHandle | null>;
};

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onClose,
  onToggleSidebar,
  onOpenSettings,
  searchAddon,
  searchRef,
}: Props) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 items-center gap-2 border-b border-card/80 bg-card pr-2 pl-20 select-none"
    >
      <Button
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        variant="ghost"
        size="icon"
        className="rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
      >
        <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
      </Button>

      <span className="w-px bg-border h-full mx-1" />
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={onSelect}
        onNew={onNew}
        onClose={onClose}
      />

      <div data-tauri-drag-region className="h-full min-w-6 flex-1" />

      <SearchInline ref={searchRef} addon={searchAddon} />

      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
        onClick={onOpenSettings}
        title="Settings"
      >
        <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
      </Button>
    </div>
  );
}
