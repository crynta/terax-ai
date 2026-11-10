"use client";

import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import { isValidElement, type ReactNode } from "react";

import { ChatCodeBlock } from "./chat-code";
import {
  classifyLinkTarget,
  routeLink,
  useMarkdownLinkRouter,
  wantsCopy,
} from "./markdown-link";

export function markdownCodeText(children?: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map((child) => markdownCodeText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return markdownCodeText(children.props.children);
  }
  return "";
}

/**
 * Streamdown `components.code` override. Handles both inline (`code`) and
 * fenced blocks. Streamdown marks a fenced block's `code` with `data-block`
 * (a fence without a language has no "language-X" class), and those delegate
 * to the Lezer-based renderer; inline stays a plain pill.
 */
export function MarkdownCode({
  className,
  children,
  node: _node,
  "data-block": dataBlock,
  ...rest
}: {
  className?: string;
  children?: ReactNode;
  node?: unknown;
  "data-block"?: string;
}) {
  const router = useMarkdownLinkRouter();
  const match = className?.match(/language-(\w+)/);
  const block =
    !!match ||
    dataBlock !== undefined ||
    markdownCodeText(children).includes("\n");
  if (!block) {
    // Inline code that is exactly a URL or a path opens on Cmd+click.
    const text = markdownCodeText(children).trim();
    const kind = classifyLinkTarget(text);
    const linkable =
      kind === "external" || (kind === "file" && !!router.openFile);
    return (
      <code
        className={cn(
          "rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.875em] text-foreground",
          linkable && "hover:underline hover:decoration-dotted",
        )}
        title={linkable ? `⌘-click to open ${text}` : undefined}
        onClick={
          linkable
            ? (event) => {
                if (!(event.metaKey || event.ctrlKey)) return;
                event.preventDefault();
                if (wantsCopy(event)) void copyToClipboard(text);
                else routeLink(text, router);
              }
            : undefined
        }
        {...rest}
      >
        {children}
      </code>
    );
  }

  const code = markdownCodeText(children).replace(/\n$/, "");
  return <ChatCodeBlock code={code} lang={match?.[1] ?? null} />;
}
