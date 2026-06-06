import { type FormEvent, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { McpTransport } from "@/modules/pi/lib/native";
import type { McpConfigDraft } from "./PiMcpConfig";

export function McpConfigEditor({
  disabled,
  draft,
  editingId,
  error,
  onCancelEdit,
  onDraftChange,
  onSubmit,
}: {
  disabled: boolean;
  draft: McpConfigDraft;
  editingId: string | null;
  error: string | null;
  onCancelEdit: () => void;
  onDraftChange: (draft: McpConfigDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fieldPrefix = useId();
  const fieldId = (field: string) => `${fieldPrefix}-${field}`;
  const updateDraft = (patch: Partial<McpConfigDraft>) => {
    onDraftChange({ ...draft, ...patch });
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border/35 bg-background/65 px-2.5 py-2"
      onSubmit={onSubmit}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-foreground">
            {editingId ? "Edit MCP server" : "Add MCP server"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Env and OAuth values are read at connect time and are never saved
            here.
          </div>
        </div>
        {editingId ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-5 rounded-md px-1.5 text-[10px]"
            disabled={disabled}
            onClick={onCancelEdit}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert
          variant="destructive"
          className="rounded-md border-destructive/35 px-2 py-1.5 text-[10px]"
        >
          {error}
        </Alert>
      ) : null}

      <div className="flex min-w-0 flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Transport</Label>
        <div className="flex gap-1">
          {(["stdio", "http"] as McpTransport[]).map((transport) => (
            <Button
              key={transport}
              type="button"
              size="xs"
              variant={draft.transport === transport ? "secondary" : "outline"}
              className="h-6 rounded-md px-2 text-[10px]"
              disabled={disabled}
              onClick={() => updateDraft({ transport })}
            >
              {transport === "stdio" ? "stdio" : "HTTP"}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex min-w-0 flex-col gap-1">
          <Label
            htmlFor={fieldId("id")}
            className="text-[10px] text-muted-foreground"
          >
            Server id
          </Label>
          <Input
            id={fieldId("id")}
            value={draft.id}
            disabled={disabled || editingId !== null}
            placeholder="filesystem"
            className="h-7 text-[11px]"
            onChange={(event) => updateDraft({ id: event.target.value })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label
            htmlFor={fieldId("name")}
            className="text-[10px] text-muted-foreground"
          >
            Name
          </Label>
          <Input
            id={fieldId("name")}
            value={draft.name}
            disabled={disabled}
            placeholder="Filesystem"
            className="h-7 text-[11px]"
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("command")}
          className="text-[10px] text-muted-foreground"
        >
          Command
        </Label>
        <Input
          id={fieldId("command")}
          value={draft.command}
          disabled={disabled}
          placeholder="node"
          className="h-7 font-mono text-[11px]"
          onChange={(event) => updateDraft({ command: event.target.value })}
        />
        <div className="text-[9.5px] leading-snug text-muted-foreground/70">
          Required for stdio. Use an absolute executable path or allowlisted
          command: node, npx, pnpm, uvx.
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("url")}
          className="text-[10px] text-muted-foreground"
        >
          HTTP URL
        </Label>
        <Input
          id={fieldId("url")}
          value={draft.url}
          disabled={disabled}
          placeholder="https://mcp.example.com/mcp"
          className="h-7 font-mono text-[11px]"
          onChange={(event) => updateDraft({ url: event.target.value })}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("oauth")}
          className="text-[10px] text-muted-foreground"
        >
          OAuth token env name
        </Label>
        <Input
          id={fieldId("oauth")}
          value={draft.oauthTokenEnv}
          disabled={disabled}
          placeholder="REMOTE_MCP_TOKEN"
          className="h-7 font-mono text-[11px]"
          onChange={(event) =>
            updateDraft({ oauthTokenEnv: event.target.value })
          }
        />
        <div className="text-[9.5px] leading-snug text-muted-foreground/70">
          Optional bearer token. Store its value with Set or use OAuth after
          saving.
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("args")}
          className="text-[10px] text-muted-foreground"
        >
          Arguments, one per line
        </Label>
        <Textarea
          id={fieldId("args")}
          value={draft.argsText}
          disabled={disabled}
          placeholder="server.js\n--stdio"
          className="min-h-14 resize-none font-mono text-[11px]"
          onChange={(event) => updateDraft({ argsText: event.target.value })}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("cwd")}
          className="text-[10px] text-muted-foreground"
        >
          cwd
        </Label>
        <Input
          id={fieldId("cwd")}
          value={draft.cwd}
          disabled={disabled}
          placeholder="/Users/me/project"
          className="h-7 font-mono text-[11px]"
          onChange={(event) => updateDraft({ cwd: event.target.value })}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={fieldId("env")}
          className="text-[10px] text-muted-foreground"
        >
          Env names only, comma or newline separated
        </Label>
        <Textarea
          id={fieldId("env")}
          value={draft.envNamesText}
          disabled={disabled}
          placeholder="SAFE_TOKEN"
          className="min-h-12 resize-none font-mono text-[11px]"
          onChange={(event) =>
            updateDraft({ envNamesText: event.target.value })
          }
        />
      </div>

      <Button
        type="submit"
        size="xs"
        variant="secondary"
        className="h-6 rounded-md px-2 text-[10.5px]"
        disabled={disabled}
      >
        {editingId ? "Save changes" : "Save MCP server"}
      </Button>
    </form>
  );
}
