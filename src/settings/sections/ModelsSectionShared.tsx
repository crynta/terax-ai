import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useId } from "react";
import { Field, FieldContent, FieldTitle } from "@/components/ui/field";
import { type ProviderId, providerNeedsKey } from "@/modules/ai/config";

export type KeysMap = Record<ProviderId, string | null>;

export const isLocalProvider = (id: ProviderId): boolean =>
  !providerNeedsKey(id);

export type LocalMeta = {
  urlPlaceholder: string;
  modelPlaceholder: string;
  description: string;
  modelHint: ReactNode;
};

export const LOCAL_META: Partial<Record<ProviderId, LocalMeta>> = {
  lmstudio: {
    urlPlaceholder: "http://localhost:1234/v1",
    modelPlaceholder: "qwen2.5-coder-7b-instruct",
    description:
      "Run GGUF models via LM Studio's HTTP server (Developer tab → enable).",
    modelHint: (
      <>
        The model id loaded in LM Studio, see the server's{" "}
        <span className="font-mono">/v1/models</span> page.
      </>
    ),
  },
  mlx: {
    urlPlaceholder: "http://127.0.0.1:8080/v1",
    modelPlaceholder: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
    description:
      "Apple-silicon inference via mlx_lm.server (pip install mlx-lm).",
    modelHint: <>The Hugging Face repo path you launched mlx_lm.server with.</>,
  },
  ollama: {
    urlPlaceholder: "http://localhost:11434/v1",
    modelPlaceholder: "qwen2.5-coder:7b",
    description: "Local models via Ollama's built-in OpenAI-compatible API.",
    modelHint: <>The model name from `ollama list` / `ollama pull`.</>,
  },
  "openai-compatible": {
    urlPlaceholder: "https://api.example.com/v1",
    modelPlaceholder: "gpt-4o, qwen3-max, glm-4.6, …",
    description: "Any OpenAI-compatible endpoint: vLLM, Z.AI, Fireworks, etc.",
    modelHint: null,
  },
  openrouter: {
    urlPlaceholder: "",
    modelPlaceholder: "anthropic/claude-sonnet-4-6, openai/gpt-5.5, …",
    description: "Any model on OpenRouter. Type its full provider/model id.",
    modelHint: (
      <>
        Browse ids at <span className="font-mono">openrouter.ai/models</span>.
      </>
    ),
  },
};

export type LocalConfig = {
  baseURL: string;
  modelId: string;
  setBaseURL: (v: string) => Promise<void>;
  setModelId: (v: string) => Promise<void>;
  contextLimit?: number;
  setContextLimit?: (v: number) => Promise<void>;
  noBaseURL?: boolean;
};

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children:
    | ReactNode
    | ((ids: { descriptionId?: string; labelId: string }) => ReactNode);
}) {
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const control =
    typeof children === "function" ? children({ labelId }) : children;

  return (
    <Field orientation="horizontal" className="items-center gap-3">
      <FieldTitle
        id={labelId}
        className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground"
      >
        {label}
      </FieldTitle>
      <FieldContent className="flex-row items-center gap-0">
        {control}
      </FieldContent>
    </Field>
  );
}

export function StatusLine({
  status,
}: {
  status: "idle" | "testing" | "ok" | "fail";
}) {
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <span className="text-[10.5px] text-muted-foreground">Testing…</span>
    );
  }
  if (status === "ok") {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        Reachable, server responded.
      </span>
    );
  }
  return (
    <span className="text-[10.5px] text-destructive/80">
      Could not reach the server.
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
