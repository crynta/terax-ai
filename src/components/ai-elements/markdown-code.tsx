"use client";

import { Button } from "@/components/ui/button";
import { CheckmarkCircle01Icon, CopyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BundledLanguage } from "shiki";

import { CodeBlockContent } from "./code-block";

const SUPPORTED = new Set<string>([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "markdown",
  "sh",
  "bash",
  "zsh",
  "shell",
  "rs",
  "rust",
  "py",
  "python",
  "css",
  "html",
  "yaml",
  "yml",
  "toml",
  "go",
  "java",
  "c",
  "cpp",
  "ruby",
  "swift",
  "kotlin",
  "sql",
  "diff",
  "text",
  "txt",
  "plaintext",
]);

const ALIASES: Record<string, BundledLanguage> = {
  shell: "bash" as BundledLanguage,
  zsh: "bash" as BundledLanguage,
  markdown: "md" as BundledLanguage,
  python: "py" as BundledLanguage,
  rust: "rs" as BundledLanguage,
  txt: "text" as BundledLanguage,
  plaintext: "text" as BundledLanguage,
};

function resolveLanguage(raw: string | null): BundledLanguage {
  if (!raw) return "text" as BundledLanguage;
  const norm = raw.toLowerCase();
  if (!SUPPORTED.has(norm)) return "text" as BundledLanguage;
  return (ALIASES[norm] ?? norm) as BundledLanguage;
}

/**
 * Streamdown `components.code` override: handles BOTH inline and fenced.
 * Detection: fenced blocks come with a `language-*` className.
 */
export function MarkdownCode({
  className,
  children,
  ...rest
}: {
  className?: string;
  children?: ReactNode;
}) {
  const match = className?.match(/language-(\w+)/);
  if (!match) {
    return (
      <code
        className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        {...rest}
      >
        {children}
      </code>
    );
  }

  const lang = resolveLanguage(match[1]);
  const code = String(children ?? "").replace(/\n$/, "");

  return <MarkdownCodeBlock code={code} language={lang} rawLang={match[1]} />;
}

export function MarkdownCodeBlock({
  code,
  language,
  rawLang,
}: {
  code: string;
  language: BundledLanguage;
  rawLang: string;
}) {
  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {rawLang || "text"}
        </span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto [&_pre]:!bg-transparent [&_pre]:!p-3 [&_pre]:text-[11.5px] [&_pre]:leading-relaxed">
        <CodeBlockContent code={code} language={language} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number>(0);

  const onCopy = useCallback(async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      tRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  }, [text]);

  useEffect(() => () => window.clearTimeout(tRef.current), []);

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
