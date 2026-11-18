import { isExternalUrl, openExternalUrl } from "@/lib/external-link";
import type { ComponentProps, MouseEventHandler } from "react";
import { resolveRelativeAsset } from "./lib/assetPath";

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  onSettled?: () => void;
  documentPath?: string;
  onOpenFile?: (path: string, pin?: boolean) => void;
  "data-doc-href"?: string;
  dataDocHref?: string;
};

export function resolveMarkdownDocPath(
  documentPath: string | undefined,
  href: string | undefined,
  dataDocHref?: string,
): string | null {
  const docHref = dataDocHref ?? href;
  if (!documentPath || !docHref) return null;
  return resolveRelativeAsset(documentPath, docHref);
}

export function MarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  onSettled,
  documentPath,
  onOpenFile,
  "data-doc-href": dataDocHrefAttr,
  dataDocHref,
  ...props
}: MarkdownLinkProps) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href) return;

    if (isExternalUrl(href)) {
      event.preventDefault();
      void openExternalUrl(href, onSettled);
      return;
    }

    const resolved = resolveMarkdownDocPath(
      documentPath,
      href,
      dataDocHrefAttr ?? dataDocHref,
    );
    if (resolved && onOpenFile) {
      event.preventDefault();
      onOpenFile(resolved, true);
      onSettled?.();
    }
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
