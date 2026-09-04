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
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href || !isExternalUrl(href)) return;

    event.preventDefault();
    event.stopPropagation();
    void openExternalUrl(href, onSettled);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      onAuxClick={handleClick}
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
