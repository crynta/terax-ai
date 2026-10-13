import { isExternalUrl, openExternalUrl } from "@/lib/external-link";
import type { ComponentProps, MouseEventHandler } from "react";

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  onSettled?: () => void;
};

export function MarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  onSettled,
  ...props
}: MarkdownLinkProps) {
  const openExternal: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (event.defaultPrevented || !href || !isExternalUrl(href)) return;

    event.preventDefault();
    event.stopPropagation();
    void openExternalUrl(href, onSettled);
  };

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    openExternal(event);
  };

  // auxclick fires for non-primary buttons; only middle-click (button 1)
  // should open. Right-click and others must not navigate (#1104 / CodeRabbit).
  const handleAuxClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (event.button !== 1) return;
    openExternal(event);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
