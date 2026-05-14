"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CopyIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";

import { Shimmer } from "./shimmer";
import { highlight, isHighlightable, type HighlightedNode } from "./chat-code-lezer";

// True while the parent message is still streaming from the model. We hide
// fenced-code contents during this phase: parsing partial code is wasted
// work and a flashing skeleton is calmer UI than text that grows char-by-char.
const StreamingCtx = createContext(false);
export const ChatStreamingProvider = StreamingCtx.Provider;

const POSIX_SHELL = new Set([
  "bash",
  "sh",
  "zsh",
  "shell",
  "console",
  "shellscript",
]);
const WINDOWS_SHELL = new Set([
  "powershell",
  "pwsh",
  "ps1",
  "ps",
  "cmd",
  "bat",
  "batch",
]);
const SHELL_LANGS = new Set([...POSIX_SHELL, ...WINDOWS_SHELL]);

function shellPrompt(lang: string): string {
  if (WINDOWS_SHELL.has(lang)) return lang === "cmd" || lang === "bat" || lang === "batch" ? ">" : "PS>";
  return "$";
}

function normalizeLangLabel(raw: string): string {
  const lower = raw.toLowerCase();
  if (POSIX_SHELL.has(lower)) return "bash";
  if (lower === "pwsh" || lower === "ps1" || lower === "ps") return "powershell";
  if (lower === "bat" || lower === "batch") return "cmd";
  return lower || "text";
}

export type ChatCodeBlockProps = {
  code: string;
  lang: string | null;
};

export function ChatCodeBlock({ code, lang }: ChatCodeBlockProps) {
  const streaming = useContext(StreamingCtx);
  const label = normalizeLangLabel(lang ?? "");

  if (streaming) {
    return <GeneratingPlaceholder label={label} />;
  }

  if (SHELL_LANGS.has(label)) {
    return <CommandCard code={code} lang={label} />;
  }

  return <FinalizedCodeBlock code={code} lang={label} />;
}

function GeneratingPlaceholder({ label }: { label: string }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
      <Shimmer duration={1.2}>
        {label === "text" ? "Generating code…" : `Generating ${label}…`}
      </Shimmer>
    </div>
  );
}

function BlockChrome({
  label,
  code,
  children,
}: {
  label: string;
  code: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function FinalizedCodeBlock({ code, lang }: { code: string; lang: string }) {
  if (!isHighlightable(lang)) {
    return (
      <BlockChrome label={lang} code={code}>
        <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
          {code}
        </pre>
      </BlockChrome>
    );
  }
  return (
    <BlockChrome label={lang} code={code}>
      <HighlightedPre code={code} lang={lang} />
    </BlockChrome>
  );
}

const HighlightedPre = memo(function HighlightedPre({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const [nodes, setNodes] = useState<HighlightedNode[] | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    let cancelled = false;
    highlight(code, lang)
      .then((result) => {
        if (cancelled || cancelRef.current) return;
        setNodes(result);
      })
      .catch(() => {
        if (cancelled) return;
        setNodes(null);
      });
    return () => {
      cancelled = true;
      cancelRef.current = true;
    };
  }, [code, lang]);

  if (!nodes) {
    return (
      <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
        {code}
      </pre>
    );
  }

  return (
    <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
      {nodes.map((node, i) =>
        node.kind === "break" ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i}>{"\n"}</span>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className={node.cls || undefined}>
            {node.value}
          </span>
        ),
      )}
    </pre>
  );
});

function CommandCard({ code, lang }: { code: string; lang: string }) {
  const isMultiline = code.includes("\n");
  const prompt = shellPrompt(lang);
  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {normalizeLangLabel(lang)}
        </span>
        <div className="flex items-center gap-1">
          <RunInTerminalButton command={code} />
          <CopyButton text={code} />
        </div>
      </div>
      <div className="border-t border-border/40 bg-background/40">
        <pre
          className={cn(
            "m-0 overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground",
            isMultiline ? "whitespace-pre" : "whitespace-pre-wrap",
          )}
        >
          {code.split("\n").map((line, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} className="flex">
              <span className="mr-2 select-none text-muted-foreground/70">
                {prompt}
              </span>
              <span>{line}</span>
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}

function RunInTerminalButton({ command }: { command: string }) {
  const [sent, setSent] = useState(false);
  const tRef = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(tRef.current), []);
  const onRun = () => {
    const ok = useChatStore.getState().live.injectIntoActivePty(command);
    if (!ok) return;
    setSent(true);
    tRef.current = window.setTimeout(() => setSent(false), 1500);
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onRun}
      className="h-5 gap-1 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
      aria-label="Run in active terminal"
      title="Run in active terminal"
    >
      <HugeiconsIcon
        icon={sent ? TerminalIcon : ArrowRight01Icon}
        size={11}
        strokeWidth={1.75}
      />
      <span>{sent ? "Sent" : "Run"}</span>
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(tRef.current), []);

  const onCopy = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      tRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  };

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onCopy}
      className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Copy code"
    >
      <HugeiconsIcon
        icon={copied ? CheckmarkCircle01Icon : CopyIcon}
        size={11}
        strokeWidth={1.75}
      />
    </Button>
  );
}
