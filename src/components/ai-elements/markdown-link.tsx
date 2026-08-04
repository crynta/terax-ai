import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentProps, MouseEventHandler } from "react";

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  /** Called after the external-open attempt settles. */
  onSettled?: () => void;
};

function isExternalMarkdownUrl(href: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(href);
}

export function openMarkdownLink(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  return openUrl(href)
    .catch((error) => {
      console.error("[terax] failed to open Markdown link:", error);
    })
    .finally(() => onSettled?.());
}

/**
 * Open rendered Markdown links through the native opener instead of letting
 * the Tauri webview navigate to an external origin.
 */
export function MarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  onSettled,
  ...props
}: MarkdownLinkProps) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href || !isExternalMarkdownUrl(href)) return;

    event.preventDefault();
    void openMarkdownLink(href, onSettled);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
