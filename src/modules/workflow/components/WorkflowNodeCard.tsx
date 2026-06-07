import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { TerminalPane } from "@/modules/terminal";
import {
  type WorkflowDiscoveredProviderModels,
  type WorkflowProviderSettingField,
  workflowProviderCredentialStatus,
  workflowProviderModelOptions,
  workflowProviderOptionsForNode,
  workflowProviderSettingsForNode,
} from "../lib/providerConfigUi";
import type { WorkflowArtifact, WorkflowNode } from "../lib/schema";
import {
  shouldMountTerminalSurface,
  workflowTerminalLeafId,
} from "../lib/terminalNode";
import { ArtifactList } from "./WorkflowCanvasArtifacts";
import { nodeSubtitle } from "./WorkflowCanvasMetadata";
import type {
  WorkflowConnectionHandle,
  WorkflowFlowNode,
} from "./WorkflowCanvasTypes";

const workflowInputClassName =
  "nodrag nowheel h-7 rounded-md border-border/60 bg-background px-2 text-xs focus-visible:ring-2";
const workflowMonoInputClassName = cn(workflowInputClassName, "font-mono");
const workflowTextareaClassName =
  "nodrag nowheel rounded-md border-border/60 bg-muted/30 p-2 text-xs focus-visible:ring-2";
const workflowMonoTextareaClassName = cn(
  workflowTextareaClassName,
  "font-mono",
);
const workflowSelectClassName =
  "nodrag nowheel h-7 w-full rounded-md border border-border/60 bg-background px-2 text-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

function ConfigField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-[10px] uppercase tracking-wide">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function WorkflowNodeCard({
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  const node = data.node;
  const [terminalExpanded, setTerminalExpanded] = useState(
    node.uiState.expanded === true,
  );
  const visibleNode: WorkflowNode = {
    ...node,
    uiState: { ...node.uiState, expanded: terminalExpanded },
  };
  const shouldMountTerminal = shouldMountTerminalSurface(
    visibleNode,
    data.visible,
  );

  return (
    <div
      className={cn(
        "relative min-w-[220px] overflow-visible rounded-xl border bg-card/95 text-card-foreground shadow-lg backdrop-blur",
        selected ? "border-ring shadow-ring/20" : "border-border/70",
      )}
      style={{ width: node.size.width }}
    >
      <NodeHandles
        node={node}
        pendingConnection={data.pendingConnection}
        onHandleClick={data.onHandleClick}
        onHandleMouseDown={data.onHandleMouseDown}
      />
      <div className="flex items-center justify-between gap-3 border-border/60 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{node.title}</div>
          <div className="truncate text-muted-foreground text-xs">
            {nodeSubtitle(node)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="nodrag nopan nowheel h-6 px-2 text-[10px]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onDuplicateNode(node.id);
            }}
          >
            Copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="nodrag nopan nowheel h-6 px-2 text-[10px] text-destructive hover:text-destructive"
            data-testid={`workflow-delete-node-${node.id}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onDeleteNode(node.id);
            }}
          >
            Delete node
          </Button>
          <Badge variant="secondary" className="text-[10px] uppercase">
            {node.runtimeState.status}
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <NodeBody
          node={node}
          artifacts={data.artifacts}
          discoveredProviderModels={data.discoveredProviderModels}
          reusableArtifacts={data.reusableArtifacts}
          onConfigChange={(patch) => data.onUpdateNodeConfig(node.id, patch)}
          onActionError={data.onArtifactActionError}
          onArtifactMaterialized={data.onArtifactMaterialized}
          onDeleteArtifact={data.onDeleteArtifact}
          onPreviewArtifact={data.onPreviewArtifact}
          workflowDocumentId={data.workflowDocumentId}
          workflowFilePath={data.workflowFilePath}
        />
        <RuntimeDetails
          node={node}
          onApprove={() => data.onApproveNode(node.id)}
          onReject={() => data.onRejectNode(node.id)}
        />
        {node.type === "terminal" ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              variant={terminalExpanded ? "secondary" : "outline"}
              className="nodrag nowheel h-7 w-full"
              onClick={() => setTerminalExpanded((current) => !current)}
            >
              {terminalExpanded ? "Collapse terminal" : "Open WebGL terminal"}
            </Button>
            {shouldMountTerminal ? (
              <div className="nodrag nowheel h-48 overflow-hidden rounded-md border border-border/70 bg-black">
                <TerminalPane
                  leafId={workflowTerminalLeafId(data.workflowId, node.id)}
                  visible={data.visible}
                  focused={selected}
                />
              </div>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-muted-foreground text-xs">
                WebGL terminal mounts only when this node is opened.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RuntimeDetails({
  node,
  onApprove,
  onReject,
}: {
  node: WorkflowNode;
  onApprove: () => void;
  onReject: () => void;
}) {
  const stopFlowInteraction = (
    event:
      | ReactMouseEvent<HTMLButtonElement>
      | ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
  };
  const { artifactIds, message, progress, status } = node.runtimeState;
  if (status === "idle" && !message && !artifactIds?.length) return null;
  const progressPercent =
    typeof progress === "number" ? Math.round(progress * 100) : null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
      {message ? <div className="text-muted-foreground">{message}</div> : null}
      {progressPercent !== null ? (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform"
              style={{
                transform: `scaleX(${Math.min(Math.max(progressPercent, 0), 100) / 100})`,
              }}
            />
          </div>
        </div>
      ) : null}
      {artifactIds?.length ? (
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {artifactIds.join(", ")}
        </div>
      ) : null}
      {status === "waiting-approval" ? (
        <div className="mt-2 flex gap-1">
          <Button
            type="button"
            size="sm"
            className="nodrag nopan nowheel h-7 px-2 text-xs"
            data-testid={`workflow-approve-node-${node.id}`}
            onMouseDown={stopFlowInteraction}
            onPointerDown={stopFlowInteraction}
            onClick={(event) => {
              event.stopPropagation();
              onApprove();
            }}
          >
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="nodrag nopan nowheel h-7 px-2 text-xs"
            data-testid={`workflow-reject-node-${node.id}`}
            onMouseDown={stopFlowInteraction}
            onPointerDown={stopFlowInteraction}
            onClick={(event) => {
              event.stopPropagation();
              onReject();
            }}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function workflowHandleStyle(index: number) {
  return {
    top: 76 + index * 24,
    width: 22,
    height: 22,
    zIndex: 30,
    pointerEvents: "auto" as const,
    cursor: "crosshair",
  };
}

export function NodeHandles({
  node,
  pendingConnection,
  onHandleClick,
  onHandleMouseDown,
}: {
  node: WorkflowNode;
  pendingConnection: WorkflowConnectionHandle | null;
  onHandleClick: (handle: WorkflowConnectionHandle) => void;
  onHandleMouseDown: (
    handle: WorkflowConnectionHandle,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
}) {
  return (
    <>
      {node.inputs.map((input, index) => {
        const handle: WorkflowConnectionHandle = {
          nodeId: node.id,
          nodeTitle: node.title,
          portId: input.id,
          portLabel: input.label,
          portType: input.type,
          direction: "target",
        };
        return (
          <Handle
            key={`in-${input.id}`}
            id={input.id}
            type="target"
            position={Position.Left}
            isConnectable
            title={`${node.title} ${input.label} input`}
            aria-label={`${node.title} ${input.label} input handle`}
            data-testid={`workflow-handle-${node.id}-${input.id}-target`}
            data-workflow-handle-direction="target"
            data-workflow-handle-node-id={node.id}
            data-workflow-handle-port-id={input.id}
            style={workflowHandleStyle(index)}
            className={workflowHandleClassName(handle, pendingConnection)}
            onMouseDown={(event) => onHandleMouseDown(handle, event)}
            onClick={(event) => {
              event.stopPropagation();
              onHandleClick(handle);
            }}
          />
        );
      })}
      {node.outputs.map((output, index) => {
        const handle: WorkflowConnectionHandle = {
          nodeId: node.id,
          nodeTitle: node.title,
          portId: output.id,
          portLabel: output.label,
          portType: output.type,
          direction: "source",
        };
        return (
          <Handle
            key={`out-${output.id}`}
            id={output.id}
            type="source"
            position={Position.Right}
            isConnectable
            title={`${node.title} ${output.label} output`}
            aria-label={`${node.title} ${output.label} output handle`}
            data-testid={`workflow-handle-${node.id}-${output.id}-source`}
            data-workflow-handle-direction="source"
            data-workflow-handle-node-id={node.id}
            data-workflow-handle-port-id={output.id}
            style={workflowHandleStyle(index)}
            className={workflowHandleClassName(handle, pendingConnection)}
            onMouseDown={(event) => onHandleMouseDown(handle, event)}
            onClick={(event) => {
              event.stopPropagation();
              onHandleClick(handle);
            }}
          />
        );
      })}
    </>
  );
}

export function workflowHandleClassName(
  handle: WorkflowConnectionHandle,
  pendingConnection: WorkflowConnectionHandle | null,
): string {
  return cn(
    "border-2 border-background bg-primary shadow-md ring-2 ring-primary/25 transition-transform hover:scale-125",
    pendingConnection &&
      pendingConnection.nodeId === handle.nodeId &&
      pendingConnection.portId === handle.portId &&
      pendingConnection.direction === handle.direction &&
      "bg-ring ring-4 ring-ring/40",
  );
}

export function workflowHandleText(handle: WorkflowConnectionHandle): string {
  return `${handle.nodeTitle} ${handle.portLabel}`;
}

export function oppositeHandleLabel(
  direction: WorkflowConnectionHandle["direction"],
): string {
  return direction === "source"
    ? "target input handle"
    : "source output handle";
}

export function NodeBody({
  node,
  artifacts,
  discoveredProviderModels,
  reusableArtifacts,
  onActionError,
  onArtifactMaterialized,
  onConfigChange,
  onDeleteArtifact,
  onPreviewArtifact,
  workflowDocumentId,
  workflowFilePath,
}: {
  node: WorkflowNode;
  artifacts: WorkflowArtifact[];
  discoveredProviderModels: WorkflowDiscoveredProviderModels;
  reusableArtifacts: WorkflowArtifact[];
  onActionError: (error: unknown) => void;
  onArtifactMaterialized: (artifact: WorkflowArtifact) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
  onDeleteArtifact: (artifactId: string) => void;
  onPreviewArtifact: (artifact: WorkflowArtifact) => void;
  workflowDocumentId: string;
  workflowFilePath?: string;
}) {
  if (node.type === "textPrompt") {
    return (
      <ConfigField label="Prompt text">
        <Textarea
          name={`workflow-${node.id}-prompt`}
          autoComplete="off"
          aria-label="Prompt text"
          className={cn(workflowTextareaClassName, "min-h-20")}
          value={String(node.config.prompt ?? "")}
          placeholder="Prompt text"
          onChange={(event) => onConfigChange({ prompt: event.target.value })}
        />
      </ConfigField>
    );
  }
  if (node.type === "imageGeneration") {
    return (
      <ProviderConfigFields
        node={node}
        detail="Text to image"
        discoveredProviderModels={discoveredProviderModels}
        reusableArtifacts={reusableArtifacts}
        onConfigChange={onConfigChange}
      />
    );
  }
  if (node.type === "videoGeneration") {
    return (
      <ProviderConfigFields
        node={node}
        detail="Image or text to video"
        discoveredProviderModels={discoveredProviderModels}
        reusableArtifacts={reusableArtifacts}
        onConfigChange={onConfigChange}
      />
    );
  }
  if (node.type === "audioGeneration") {
    return (
      <ProviderConfigFields
        node={node}
        detail="Text to sound or speech"
        discoveredProviderModels={discoveredProviderModels}
        reusableArtifacts={reusableArtifacts}
        onConfigChange={onConfigChange}
      />
    );
  }
  if (node.type === "output") {
    if (artifacts.length > 0) {
      return (
        <ArtifactList
          artifacts={artifacts}
          onActionError={onActionError}
          onArtifactMaterialized={onArtifactMaterialized}
          onDeleteArtifact={onDeleteArtifact}
          onPreviewArtifact={onPreviewArtifact}
          workflowDocumentId={workflowDocumentId}
          workflowFilePath={workflowFilePath}
        />
      );
    }
    return (
      <MediaPlaceholder label="Output gallery" detail="Artifacts appear here" />
    );
  }
  if (node.type === "agent") {
    return (
      <ConfigField label="Agent prompt">
        <Textarea
          name={`workflow-${node.id}-agent-prompt`}
          autoComplete="off"
          aria-label="Agent prompt"
          className={cn(workflowTextareaClassName, "min-h-20")}
          value={String(node.config.prompt ?? "")}
          placeholder="Agent prompt"
          onChange={(event) => onConfigChange({ prompt: event.target.value })}
        />
      </ConfigField>
    );
  }
  if (node.type === "httpRequest") {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[80px_1fr] gap-1">
          <ConfigField label="Method">
            <select
              name={`workflow-${node.id}-http-method`}
              aria-label="HTTP method"
              className={workflowSelectClassName}
              value={String(node.config.method ?? "GET")}
              onChange={(event) =>
                onConfigChange({ method: event.target.value })
              }
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </ConfigField>
          <ConfigField label="Request URL">
            <Input
              type="url"
              name={`workflow-${node.id}-request-url`}
              inputMode="url"
              autoComplete="off"
              aria-label="Request URL"
              className={workflowInputClassName}
              value={String(node.config.url ?? "")}
              placeholder="https://api.example.com"
              onChange={(event) => onConfigChange({ url: event.target.value })}
            />
          </ConfigField>
        </div>
        <ConfigField label="Headers JSON">
          <Textarea
            name={`workflow-${node.id}-request-headers`}
            autoComplete="off"
            aria-label="Request headers JSON"
            className={cn(workflowMonoTextareaClassName, "min-h-14")}
            value={String(node.config.headers ?? "")}
            placeholder="Headers JSON, optional"
            onChange={(event) =>
              onConfigChange({ headers: event.target.value })
            }
          />
        </ConfigField>
      </div>
    );
  }
  if (node.type === "fileOperation") {
    return (
      <div className="flex flex-col gap-2">
        <ConfigField label="Operation">
          <select
            name={`workflow-${node.id}-file-operation`}
            aria-label="File operation"
            className={workflowSelectClassName}
            value={String(node.config.operation ?? "read")}
            onChange={(event) =>
              onConfigChange({ operation: event.target.value })
            }
          >
            <option value="read">Read file</option>
            <option value="write">Write file</option>
            <option value="append">Append file</option>
            <option value="delete">Delete file</option>
          </select>
        </ConfigField>
        <ConfigField label="File path">
          <Input
            name={`workflow-${node.id}-file-path`}
            autoComplete="off"
            aria-label="File path"
            className={workflowMonoInputClassName}
            value={String(node.config.path ?? "")}
            placeholder="workspace/path.txt"
            onChange={(event) => onConfigChange({ path: event.target.value })}
          />
        </ConfigField>
      </div>
    );
  }
  if (node.type === "browserAutomation") {
    return (
      <div className="flex flex-col gap-2">
        <ConfigField label="Browser URL">
          <Input
            type="url"
            name={`workflow-${node.id}-browser-url`}
            inputMode="url"
            autoComplete="off"
            aria-label="Browser URL"
            className={workflowInputClassName}
            value={String(node.config.url ?? "")}
            placeholder="https://example.com"
            onChange={(event) => onConfigChange({ url: event.target.value })}
          />
        </ConfigField>
        <ConfigField label="Instructions">
          <Textarea
            name={`workflow-${node.id}-browser-instructions`}
            autoComplete="off"
            aria-label="Automation instructions"
            className={cn(workflowTextareaClassName, "min-h-16")}
            value={String(node.config.instructions ?? "")}
            placeholder="Automation instructions"
            onChange={(event) =>
              onConfigChange({ instructions: event.target.value })
            }
          />
        </ConfigField>
      </div>
    );
  }
  if (node.type === "shellCommand") {
    return (
      <div className="flex flex-col gap-2">
        <ConfigField label="Command">
          <Textarea
            name={`workflow-${node.id}-shell-command`}
            autoComplete="off"
            aria-label="Shell command"
            className={cn(workflowMonoTextareaClassName, "min-h-16")}
            value={String(node.config.command ?? "")}
            placeholder="Command, requires approval"
            onChange={(event) =>
              onConfigChange({ command: event.target.value })
            }
          />
        </ConfigField>
        <ConfigField label="Working directory">
          <Input
            name={`workflow-${node.id}-working-directory`}
            autoComplete="off"
            aria-label="Working directory"
            className={workflowMonoInputClassName}
            value={String(node.config.cwd ?? "")}
            placeholder="cwd, optional"
            onChange={(event) => onConfigChange({ cwd: event.target.value })}
          />
        </ConfigField>
        <label className="block text-muted-foreground text-[10px] uppercase tracking-wide">
          Timeout seconds
          <Input
            className={cn(workflowMonoInputClassName, "mt-1 normal-case")}
            name={`workflow-${node.id}-timeout-seconds`}
            inputMode="numeric"
            autoComplete="off"
            min={1}
            type="number"
            value={String(node.config.timeoutSecs ?? "")}
            onChange={(event) =>
              onConfigChange({ timeoutSecs: positiveNumberInput(event) })
            }
          />
        </label>
      </div>
    );
  }
  return null;
}

export function ProviderConfigFields({
  detail,
  node,
  discoveredProviderModels,
  reusableArtifacts,
  onConfigChange,
}: {
  detail: string;
  node: WorkflowNode;
  discoveredProviderModels: WorkflowDiscoveredProviderModels;
  reusableArtifacts: WorkflowArtifact[];
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  const apiKeys = useChatStore((state) => state.apiKeys);
  const provider = String(node.config.provider ?? "")
    .trim()
    .toLowerCase();
  const providerOptions = workflowProviderOptionsForNode(
    node.type,
    discoveredProviderModels,
  );
  const providerKnown = providerOptions.some(
    (option) => option.id === provider,
  );
  const modelOptions = workflowProviderModelOptions(
    node,
    provider,
    discoveredProviderModels,
  );
  const providerSettings = workflowProviderSettingsForNode(node.type, provider);
  const credential = workflowProviderCredentialStatus(provider, apiKeys);
  const credentialVariant =
    credential.status === "missing" ? "destructive" : "secondary";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground text-xs">{detail}</div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={credentialVariant} className="text-[10px]">
            {credential.label}
          </Badge>
          {credential.status === "missing" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="nodrag nowheel h-6 px-2 text-[10px]"
              onClick={() => void openSettingsWindow("models")}
            >
              Open settings
            </Button>
          ) : null}
        </div>
      </div>
      <ConfigField label="Provider">
        <select
          name={`workflow-${node.id}-provider`}
          aria-label="Provider"
          className={workflowSelectClassName}
          value={String(node.config.provider ?? "")}
          onChange={(event) => onConfigChange({ provider: event.target.value })}
        >
          {!providerKnown && provider ? (
            <option value={provider}>{provider}</option>
          ) : null}
          {providerOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </ConfigField>
      <ConfigField label="Model">
        <Input
          name={`workflow-${node.id}-model`}
          autoComplete="off"
          aria-label="Model"
          className={workflowInputClassName}
          list={`${node.id}-models`}
          value={String(node.config.model ?? "")}
          placeholder="Model"
          onChange={(event) => onConfigChange({ model: event.target.value })}
        />
      </ConfigField>
      {modelOptions.length > 0 ? (
        <datalist id={`${node.id}-models`}>
          {modelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      ) : null}
      <ProviderAdvancedFields
        fields={providerSettings}
        node={node}
        onConfigChange={onConfigChange}
      />
      {reusableArtifacts.length > 0 ? (
        <div className="rounded border border-border/60 bg-background/60 p-2">
          <div className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wide">
            Reusable inputs
          </div>
          <div className="flex flex-wrap gap-1">
            {reusableArtifacts.slice(0, 4).map((artifact) => (
              <Badge
                key={artifact.id}
                variant="outline"
                className="max-w-28 truncate text-[10px]"
              >
                {artifact.label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProviderAdvancedFields({
  fields,
  node,
  onConfigChange,
}: {
  fields: WorkflowProviderSettingField[];
  node: WorkflowNode;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-1">
      {fields.map((field) => (
        <ProviderAdvancedField
          key={field.key}
          field={field}
          value={node.config[field.key]}
          onConfigChange={onConfigChange}
        />
      ))}
    </div>
  );
}

export function ProviderAdvancedField({
  field,
  value,
  onConfigChange,
}: {
  field: WorkflowProviderSettingField;
  value: unknown;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  const className = workflowSelectClassName;
  if (field.kind === "select") {
    return (
      <ConfigField label={field.label}>
        <select
          name={`workflow-provider-${field.key}`}
          className={className}
          value={String(value ?? "")}
          onChange={(event) =>
            onConfigChange({ [field.key]: event.target.value })
          }
          aria-label={field.label}
        >
          <option value="">{field.label}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </ConfigField>
    );
  }
  if (field.kind === "number") {
    return (
      <ConfigField label={field.label}>
        <Input
          name={`workflow-provider-${field.key}`}
          inputMode="numeric"
          autoComplete="off"
          aria-label={field.label}
          className={workflowInputClassName}
          min={1}
          placeholder={field.placeholder ?? field.label}
          type="number"
          value={String(value ?? "")}
          onChange={(event) =>
            onConfigChange({ [field.key]: positiveNumberInput(event) })
          }
        />
      </ConfigField>
    );
  }
  return (
    <ConfigField label={field.label}>
      <Input
        name={`workflow-provider-${field.key}`}
        autoComplete="off"
        aria-label={field.label}
        className={workflowInputClassName}
        value={String(value ?? "")}
        placeholder={field.placeholder ?? field.label}
        onChange={(event) =>
          onConfigChange({ [field.key]: event.target.value })
        }
      />
    </ConfigField>
  );
}

export function MediaPlaceholder({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="font-medium text-xs">{label}</div>
      <div className="mt-1 text-muted-foreground text-xs">{detail}</div>
    </div>
  );
}

export function positiveNumberInput(
  event: ChangeEvent<HTMLInputElement>,
): number | undefined {
  const value = Number(event.target.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
