import type { ComponentProps, MouseEventHandler } from "react";
import { isExternalUrl, openExternalUrl } from "@/lib/external-link";

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  /** Called after the external-open attempt settles. */
  onSettled?: () => void;
};

export function openMarkdownLink(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  return openExternalUrl(href, onSettled);
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
    if (event.defaultPrevented || !href || !isExternalUrl(href)) return;

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
