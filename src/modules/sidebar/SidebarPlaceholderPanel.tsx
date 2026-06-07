import { SidebarPanelBody, SidebarPanelFrame } from "./SidebarPanel";

type SidebarPlaceholderPanelProps = {
  title: string;
  description: string;
};

export function SidebarPlaceholderPanel({
  title,
  description,
}: SidebarPlaceholderPanelProps) {
  return (
    <SidebarPanelFrame aria-label={title}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <div className="truncate text-[11.5px] font-medium text-foreground">
          {title}
        </div>
        <span className="rounded-md border border-border/55 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          Coming soon
        </span>
      </header>
      <SidebarPanelBody className="items-center justify-center p-4 text-center">
        <p className="max-w-48 text-pretty text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </SidebarPanelBody>
    </SidebarPanelFrame>
  );
}
