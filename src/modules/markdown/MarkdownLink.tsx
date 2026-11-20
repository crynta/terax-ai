import { isExternalUrl, openExternalUrl } from "@/lib/external-link";
import type { ComponentProps, MouseEventHandler } from "react";
import { resolveRelativeAsset } from "./lib/assetPath";

export type MarkdownDocTarget = { path: string; fragment?: string };

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  onSettled?: () => void;
  documentPath?: string;
  onOpenFile?: (path: string, pin?: boolean, fragment?: string) => void;
  "data-doc-href"?: string;
  dataDocHref?: string;
};

export function resolveMarkdownDocTarget(
  documentPath: string | undefined,
  href: string | undefined,
  dataDocHref?: string,
): MarkdownDocTarget | null {
  const docHref = dataDocHref ?? href;
  if (!documentPath || !docHref) return null;
  const hashIndex = docHref.indexOf("#");
  if (hashIndex === 0) {
    const rawFragment = docHref.slice(1);
    const fragment = rawFragment ? rawFragment : undefined;
    return fragment ? { path: documentPath, fragment } : null;
  }
  const withoutHash = hashIndex === -1 ? docHref : docHref.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? undefined : docHref.slice(hashIndex + 1);
  const fragment = rawFragment ? rawFragment : undefined;
  const path = resolveRelativeAsset(documentPath, withoutHash);
  if (!path) return null;
  return fragment ? { path, fragment } : { path };
}

export function resolveMarkdownDocPath(
  documentPath: string | undefined,
  href: string | undefined,
  dataDocHref?: string,
): string | null {
  return resolveMarkdownDocTarget(documentPath, href, dataDocHref)?.path ?? null;
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

    const resolved = resolveMarkdownDocTarget(
      documentPath,
      href,
      dataDocHrefAttr ?? dataDocHref,
    );
    if (resolved && onOpenFile) {
      event.preventDefault();
      onOpenFile(resolved.path, true, resolved.fragment);
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
