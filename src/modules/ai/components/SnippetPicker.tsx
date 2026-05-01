import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Snippet } from "../lib/snippets";
import type { SlashCommandMeta } from "../lib/slashCommands";

export type PickerItem =
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "command"; command: SlashCommandMeta };

type Props = {
  items: readonly PickerItem[];
  activeIndex: number;
  onPick: (item: PickerItem) => void;
  onHover: (index: number) => void;
};

export function SnippetPickerContent({
  items,
  activeIndex,
  onPick,
  onHover,
}: Props) {
  const commands = items.filter((it) => it.kind === "command");
  const snippets = items.filter((it) => it.kind === "snippet");
  let cursor = -1;

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={6}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className="w-72 overflow-hidden rounded-lg border border-border/60 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
          No matches. Add snippets in Settings → Agents.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto py-1">
          {commands.length > 0 && (
            <>
              <SectionHeader label="Pre-built snippets" />
              <ul>
                {commands.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "command") return null;
                  const c = it.command;
                  return (
                    <li key={`cmd-${c.name}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <HugeiconsIcon
                          icon={c.icon}
                          size={13}
                          strokeWidth={1.75}
                          className="text-muted-foreground"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-muted-foreground">
                              #{c.name}
                            </span>
                            <span className="font-medium">{c.label}</span>
                          </span>
                          <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                            {c.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {snippets.length > 0 && (
            <>
              <SectionHeader label="Snippets" />
              <ul>
                {snippets.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "snippet") return null;
                  const s = it.snippet;
                  return (
                    <li key={`sn-${s.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span className="font-mono text-muted-foreground">
                            #{s.handle}
                          </span>
                          <span className="font-medium">{s.name}</span>
                        </span>
                        {s.description ? (
                          <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                            {s.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </PopoverContent>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {label}
    </div>
  );
}
