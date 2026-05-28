"use client";

import type { ReactNode } from "react";

import { ChatCodeBlock } from "./chat-code";
import { MermaidCode } from "./mermaid-code";

/**
 * Streamdown `components.code` override. Handles both inline (`code`) and
 * fenced blocks (className "language-X"). Fenced blocks delegate to the
 * Lezer-based renderer; inline stays a plain pill.
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

  const code = String(children ?? "").replace(/\n$/, "");
  if(match[1] === "mermaid"){
    return <MermaidCode code={code }/>
  }
  return <ChatCodeBlock code={code} lang={match[1] ?? null} />;
}
