import { type FormEvent, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

      <FieldGroup className="gap-2">
        <FieldSet className="gap-1">
          <FieldLegend
            variant="label"
            className="mb-0 text-[10px] text-muted-foreground"
          >
            Transport
          </FieldLegend>
          <ToggleGroup
            type="single"
            value={draft.transport}
            aria-label="MCP transport"
            onValueChange={(value) => {
              if (value) updateDraft({ transport: value as McpTransport });
            }}
          >
            {(["stdio", "http"] as McpTransport[]).map((transport) => (
              <ToggleGroupItem
                key={transport}
                size="sm"
                variant="outline"
                value={transport}
                className="h-6 rounded-md px-2 text-[10px]"
                disabled={disabled}
              >
                {transport === "stdio" ? "stdio" : "HTTP"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>

        <FieldGroup className="grid grid-cols-2 gap-1.5">
          <Field
            data-disabled={disabled || editingId !== null ? true : undefined}
          >
            <FieldLabel
              htmlFor={fieldId("id")}
              className="text-[10px] text-muted-foreground"
            >
              Server id
            </FieldLabel>
            <Input
              id={fieldId("id")}
              value={draft.id}
              disabled={disabled || editingId !== null}
              placeholder="filesystem"
              className="h-7 text-[11px]"
              onChange={(event) => updateDraft({ id: event.target.value })}
            />
          </Field>
          <Field data-disabled={disabled ? true : undefined}>
            <FieldLabel
              htmlFor={fieldId("name")}
              className="text-[10px] text-muted-foreground"
            >
              Name
            </FieldLabel>
            <Input
              id={fieldId("name")}
              value={draft.name}
              disabled={disabled}
              placeholder="Filesystem"
              className="h-7 text-[11px]"
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
          </Field>
        </FieldGroup>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("command")}
            className="text-[10px] text-muted-foreground"
          >
            Command
          </FieldLabel>
          <Input
            id={fieldId("command")}
            value={draft.command}
            disabled={disabled}
            placeholder="node"
            className="h-7 font-mono text-[11px]"
            onChange={(event) => updateDraft({ command: event.target.value })}
          />
          <FieldDescription className="text-[9.5px] leading-snug text-muted-foreground/70">
            Required for stdio. Use an absolute executable path or allowlisted
            command: node, npx, pnpm, uvx.
          </FieldDescription>
        </Field>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("url")}
            className="text-[10px] text-muted-foreground"
          >
            HTTP URL
          </FieldLabel>
          <Input
            id={fieldId("url")}
            value={draft.url}
            disabled={disabled}
            placeholder="https://mcp.example.com/mcp"
            className="h-7 font-mono text-[11px]"
            onChange={(event) => updateDraft({ url: event.target.value })}
          />
        </Field>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("oauth")}
            className="text-[10px] text-muted-foreground"
          >
            OAuth token env name
          </FieldLabel>
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
          <FieldDescription className="text-[9.5px] leading-snug text-muted-foreground/70">
            Optional bearer token. Store its value with Set or use OAuth after
            saving.
          </FieldDescription>
        </Field>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("args")}
            className="text-[10px] text-muted-foreground"
          >
            Arguments, one per line
          </FieldLabel>
          <Textarea
            id={fieldId("args")}
            value={draft.argsText}
            disabled={disabled}
            placeholder="server.js\n--stdio"
            className="min-h-14 resize-none font-mono text-[11px]"
            onChange={(event) => updateDraft({ argsText: event.target.value })}
          />
        </Field>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("cwd")}
            className="text-[10px] text-muted-foreground"
          >
            cwd
          </FieldLabel>
          <Input
            id={fieldId("cwd")}
            value={draft.cwd}
            disabled={disabled}
            placeholder="/Users/me/project"
            className="h-7 font-mono text-[11px]"
            onChange={(event) => updateDraft({ cwd: event.target.value })}
          />
        </Field>

        <Field data-disabled={disabled ? true : undefined}>
          <FieldLabel
            htmlFor={fieldId("env")}
            className="text-[10px] text-muted-foreground"
          >
            Env names only, comma or newline separated
          </FieldLabel>
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
        </Field>
      </FieldGroup>

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
