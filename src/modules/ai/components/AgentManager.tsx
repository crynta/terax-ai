import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SidebarPanelBody,
  SidebarPanelFrame,
  SidebarPanelScrollRegion,
} from "@/modules/sidebar";

import {
  useAgents,
  type AgentDefinition,
  type AgentInfo,
} from "../../agents/useAgents";

const AVAILABLE_TOOLS = [
  { id: "read_file", label: "Read" },
  { id: "list_directory", label: "List Dir" },
  { id: "write_file", label: "Write" },
  { id: "create_directory", label: "Mkdir" },
  { id: "edit", label: "Edit" },
  { id: "multi_edit", label: "Multi Edit" },
  { id: "grep", label: "Grep" },
  { id: "glob", label: "Glob" },
  { id: "bash_run", label: "Bash" },
  { id: "bash_background", label: "Bg Run" },
  { id: "bash_logs", label: "Logs" },
  { id: "bash_list", label: "Ps" },
  { id: "bash_kill", label: "Kill" },
  { id: "todo_write", label: "Todo" },
] as const;

const KNOWN_TOOL_IDS = new Set<string>(AVAILABLE_TOOLS.map((t) => t.id));

type Props = {
  open: boolean;
};

export const AgentManager = memo(function AgentManager({ open }: Props) {
  const { agents, loading, load, save, remove } = useAgents();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentDefinition | null>(null);
  const [showNew, setShowNew] = useState(false);

  const handleEdit = useCallback(
    async (slug: string) => {
      const def = await load(slug);
      setEditing(def);
      setShowNew(false);
    },
    [load],
  );

  const handleSave = useCallback(
    async (def: AgentDefinition) => {
      await save(def);
      setEditing(null);
      setShowNew(false);
    },
    [save],
  );

  const handleImportOpenClicky = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Select OpenClicky agents folder",
    });
    if (!selected) return;
    const count = await invoke<number>("agents_import_openclicky", {
      path: selected,
    });
    if (count > 0) await load("");
  }, [load]);

  const handleNew = useCallback(() => {
    const def: AgentDefinition = {
      schemaVersion: 1,
      slug: "",
      displayName: "",
      description: "",
      accentColorHex: "#6366f1",
      systemPrompt: "",
      toolWhitelist: [],
      skills: [],
      memory: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditing(def);
    setShowNew(true);
  }, []);

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <SidebarPanelFrame aria-label="Agents">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon
              icon={UserCircleIcon}
              size={14}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="text-[11.5px] font-medium text-foreground">
              Agents
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void handleImportOpenClicky()}
                >
                  <HugeiconsIcon
                    icon={Download04Icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Import OpenClicky</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={handleNew}>
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New agent</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <SidebarPanelBody>
          {editing ? (
            <AgentEditor
              agent={editing}
              isNew={showNew}
              onSave={handleSave}
              onCancel={() => {
                setEditing(null);
                setShowNew(false);
              }}
            />
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Spinner className="size-4" />
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-sm font-medium text-muted-foreground">
                No agents
              </div>
              <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground/75">
                Create custom agents with their own system prompts, tools, and
                memory.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={handleNew}
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  size={12}
                  strokeWidth={1.75}
                  className="mr-1"
                />
                Create agent
              </Button>
            </div>
          ) : (
            <SidebarPanelScrollRegion>
              <div className="flex flex-col gap-0.5 p-1.5">
                {agents.map((agent) => (
                  <AgentRow
                    key={agent.slug}
                    agent={agent}
                    selected={selectedSlug === agent.slug}
                    onSelect={setSelectedSlug}
                    onEdit={handleEdit}
                    onRemove={remove}
                  />
                ))}
              </div>
            </SidebarPanelScrollRegion>
          )}
        </SidebarPanelBody>
      </SidebarPanelFrame>
    </TooltipProvider>
  );
});

function AgentRow({
  agent,
  selected,
  onSelect,
  onEdit,
  onRemove,
}: {
  agent: AgentInfo;
  selected: boolean;
  onSelect: (slug: string) => void;
  onEdit: (slug: string) => void;
  onRemove: (slug: string) => Promise<void>;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(agent.slug)}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-[background-color] duration-100",
        selected ? "bg-accent/60" : "hover:bg-accent/30",
      )}
    >
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: agent.accentColorHex || "#6366f1" }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12px] font-medium leading-tight text-foreground/95">
          {agent.displayName}
        </span>
        <span className="truncate text-[10.5px] leading-tight text-muted-foreground/75">
          {agent.description}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onEdit(agent.slug);
          }}
        >
          <HugeiconsIcon
            icon={Edit02Icon}
            size={12}
            strokeWidth={1.75}
            className="text-muted-foreground hover:text-foreground"
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onRemove(agent.slug);
          }}
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            size={12}
            strokeWidth={1.75}
            className="text-muted-foreground hover:text-destructive"
          />
        </button>
      </div>
    </div>
  );
}

function AgentEditor({
  agent,
  isNew,
  onSave,
  onCancel,
}: {
  agent: AgentDefinition;
  isNew: boolean;
  onSave: (def: AgentDefinition) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(agent);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    if (!form.slug.trim() || !form.displayName.trim()) return;
    setSaving(true);
    const toSave = { ...form, updatedAt: new Date().toISOString() };
    void onSave(toSave).finally(() => setSaving(false));
  }, [form, onSave]);

  const set = <K extends keyof AgentDefinition>(
    key: K,
    value: AgentDefinition[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <div className="text-[11.5px] font-medium text-foreground">
          {isNew ? "New Agent" : "Edit Agent"}
        </div>
      </div>
      <input
        value={form.slug}
        onChange={(e) => set("slug", e.target.value)}
        placeholder="Slug (lowercase, hyphens)"
        disabled={!isNew}
        className={cn(
          "h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
          !isNew && "opacity-60",
        )}
      />
      <input
        value={form.displayName}
        onChange={(e) => set("displayName", e.target.value)}
        placeholder="Display name"
        className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <input
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
        placeholder="Description"
        className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <input
        value={form.accentColorHex}
        onChange={(e) => set("accentColorHex", e.target.value)}
        placeholder="Accent color (e.g. #6366f1)"
        className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <Textarea
        value={form.systemPrompt}
        onChange={(e) => set("systemPrompt", e.target.value)}
        placeholder="System prompt"
        rows={6}
        className="min-h-0 resize-none text-[12px]"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          Tools
        </span>
        <div className="flex flex-wrap gap-1">
          {AVAILABLE_TOOLS.map((tool) => (
            <label
              key={tool.id}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors",
                form.toolWhitelist.includes(tool.id)
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/40 text-muted-foreground hover:border-border",
              )}
            >
              <input
                type="checkbox"
                checked={form.toolWhitelist.includes(tool.id)}
                onChange={(e) => {
                  const list = e.target.checked
                    ? [...form.toolWhitelist, tool.id]
                    : form.toolWhitelist.filter((t) => t !== tool.id);
                  set("toolWhitelist", list);
                }}
                className="sr-only"
              />
              {tool.label}
            </label>
          ))}
        </div>
        {form.toolWhitelist.some((t) => !KNOWN_TOOL_IDS.has(t)) && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[10px] text-yellow-600 dark:text-yellow-400">
            Unknown tools:{" "}
            {form.toolWhitelist
              .filter((t) => !KNOWN_TOOL_IDS.has(t))
              .join(", ")}
          </div>
        )}
      </div>
      <Textarea
        value={form.memory}
        onChange={(e) => set("memory", e.target.value)}
        placeholder="Agent memory (persistent context appended to system prompt)"
        rows={3}
        className="min-h-0 resize-none text-[12px]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-6 text-[11px]"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !form.slug.trim() || !form.displayName.trim()}
          className="h-6 text-[11px]"
        >
          {isNew ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );
}
