import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  DiscoveryProvider,
  ModelDiscoveryError,
} from "@/modules/ai/lib/modelDiscovery";
import { useModelDiscovery } from "@/modules/ai/lib/useModelDiscovery";
import { Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type ModelIdBrowseFieldProps = {
  value: string;
  committedValue: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => Promise<void> | void;
  placeholder: string;
  baseURL: string;
  provider: DiscoveryProvider;
  endpointId?: string;
  apiKey?: string | null;
  inputClassName?: string;
};

export function ModelIdBrowseField({
  value,
  committedValue,
  onChange,
  onCommit,
  placeholder,
  baseURL,
  provider,
  endpointId,
  apiKey,
  inputClassName,
}: ModelIdBrowseFieldProps) {
  const [open, setOpen] = useState(false);
  const canBrowse = !!baseURL.trim();
  const { models, status, error, refresh } = useModelDiscovery({
    provider,
    endpointId,
    baseURL,
    apiKey,
    enabled: canBrowse,
  });

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== committedValue) void onCommit(trimmed);
  };

  const selectModel = (id: string) => {
    onChange(id);
    commit(id);
    setOpen(false);
  };

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next && canBrowse && status !== "loading") void refresh();
  };

  useEffect(() => {
    if (open && canBrowse && status === "idle") void refresh();
  }, [canBrowse, open, refresh, status]);

  return (
    <div className="flex flex-1 gap-1.5">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => commit(value)}
        placeholder={placeholder}
        spellCheck={false}
        className={cn("h-8 flex-1 font-mono text-[11.5px]", inputClassName)}
      />
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={!canBrowse}
            className="h-8 gap-1.5 px-2.5 text-[11px]"
            title="Browse models available on this endpoint"
          >
            <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={1.8} />
            Browse
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[22rem] gap-0 overflow-hidden rounded-3xl border border-border/60 p-0 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Endpoint models
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
                {endpointLabel(baseURL)}
              </span>
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => void refresh({ force: true })}
              disabled={status === "loading"}
              title="Refresh models"
              className="text-muted-foreground"
            >
              {status === "loading" ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={1.8} />
              )}
            </Button>
          </div>
          {renderDiscoveryContent({
            status,
            error,
            models,
            selectedId: value,
            onSelect: selectModel,
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function renderDiscoveryContent({
  status,
  error,
  models,
  selectedId,
  onSelect,
}: {
  status: ReturnType<typeof useModelDiscovery>["status"];
  error: ModelDiscoveryError | null;
  models: ReturnType<typeof useModelDiscovery>["models"];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
        <Spinner className="size-3" />
        Loading models…
      </div>
    );
  }

  if (status === "error") {
    return <Message text={discoveryErrorText(error)} tone="error" />;
  }

  if (status === "empty") {
    return (
      <Message text="No models returned. You can still type an ID." tone="muted" />
    );
  }

  if (models.length === 0) {
    return <Message text="Refresh to load models from this endpoint." tone="muted" />;
  }

  return (
    <Command className="rounded-none bg-transparent p-1">
      <CommandInput placeholder="Search endpoint models…" />
      <CommandList className="max-h-72">
        <CommandEmpty className="py-6 text-center text-[11px] text-muted-foreground">
          No matching models.
        </CommandEmpty>
        <CommandGroup heading={`${models.length} available`}>
          {models.map((model) => (
            <CommandItem
              key={model.id}
              value={model.id}
              data-checked={model.id === selectedId}
              onSelect={() => onSelect(model.id)}
              className="items-start font-mono text-[11.5px]"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">{model.id}</span>
                {model.ownedBy || model.contextLimit ? (
                  <span className="font-sans text-[10px] text-muted-foreground">
                    {modelMetaText(model)}
                  </span>
                ) : null}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function Message({ text, tone }: { text: string; tone: "muted" | "error" }) {
  return (
    <div
      className={cn(
        "m-2 rounded-2xl border px-3 py-3 text-[11px] leading-relaxed",
        tone === "error"
          ? "border-destructive/20 bg-destructive/5 text-destructive/80"
          : "border-border/50 bg-muted/30 text-muted-foreground",
      )}
    >
      {text}
    </div>
  );
}

function endpointLabel(baseURL: string): string {
  try {
    const url = new URL(baseURL);
    return url.host || baseURL;
  } catch {
    return baseURL.trim() || "Configure an endpoint first";
  }
}

function discoveryErrorText(error: ModelDiscoveryError | null): string {
  if (!error) return "Could not fetch models.";
  if (error.kind === "http-error") {
    if (error.status === 401 || error.status === 403) {
      return "Models request was rejected. Save an API key, then refresh.";
    }
    if (error.status === 404) {
      return "This endpoint does not expose a models route.";
    }
  }
  return error.message;
}

function modelMetaText(model: { ownedBy?: string; contextLimit?: number }) {
  const parts: string[] = [];
  if (model.ownedBy) parts.push(model.ownedBy);
  if (model.contextLimit) parts.push(`${model.contextLimit.toLocaleString()} tokens`);
  return parts.join(" · ");
}
