import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import { isExternalUrl, openExternalUrl } from "@/lib/external-link";
import { detectTerminalLinks } from "@/modules/terminal/ghostty/core/terminalLinks";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
} from "react";

/**
 * Where a link in rendered Markdown goes. Web links open in the browser
 * everywhere; local files only where a surface supplies `openFile` (the
 * Session Reader, which knows the session's folder).
 */
export type MarkdownLinkRouter = {
  openFile?: (target: string) => void;
};

const MarkdownLinkContext = createContext<MarkdownLinkRouter>({});

export function MarkdownLinkProvider({
  value,
  children,
}: {
  value: MarkdownLinkRouter;
  children: ReactNode;
}) {
  return (
    <MarkdownLinkContext.Provider value={value}>
      {children}
    </MarkdownLinkContext.Provider>
  );
}

export function useMarkdownLinkRouter(): MarkdownLinkRouter {
  return useContext(MarkdownLinkContext);
}

export type LinkKind = "external" | "file" | "none";

const FILE_PATH =
  /^(?:\/|~\/|\.{1,2}\/)\S+$|^[\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?$|^[\w.@-]+\.[A-Za-z0-9]{1,8}:\d+(?::\d+)?$/u;

/**
 * Classifies a link target: web/mail links, local files (`file://`, absolute,
 * `~/`, `./`, repo-relative paths with an extension, `path:line[:col]`), or
 * nothing clickable (anchors, bare words).
 */
export function classifyLinkTarget(target: string): LinkKind {
  const text = target.trim();
  if (!text || text.startsWith("#")) return "none";
  if (isExternalUrl(text)) return "external";
  if (/^file:/iu.test(text)) return "file";
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) return "none";
  if (/\s/u.test(text)) return "none";
  return FILE_PATH.test(text) ? "file" : "none";
}

/** Opens `target` by kind; returns whether something was routed. */
export function routeLink(
  target: string,
  router: MarkdownLinkRouter,
): boolean {
  switch (classifyLinkTarget(target)) {
    case "external":
      void openExternalUrl(target.trim());
      return true;
    case "file":
      if (!router.openFile) return false;
      router.openFile(target.trim());
      return true;
    default:
      return false;
  }
}

/** Cmd+Shift+click or a middle click copies the link instead of opening it. */
export function wantsCopy(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.button === 1 || ((event.metaKey || event.ctrlKey) && event.shiftKey)
  );
}

/**
 * Markdown `<a>`: opens immediately (no confirmation modal; `window.open` does
 * nothing in the webview), web links in the browser and files in the editor.
 */
export function MarkdownLink({
  href,
  children,
  className: _className,
  node: _node,
  ...rest
}: {
  href?: string;
  children?: ReactNode;
  className?: string;
  node?: unknown;
}) {
  const router = useMarkdownLinkRouter();
  const target = href ?? "";
  const kind = classifyLinkTarget(target);
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    if (wantsCopy(event)) {
      void copyToClipboard(target);
      return;
    }
    routeLink(target, router);
  };
  return (
    <a
      {...rest}
      href={target || undefined}
      title={target || undefined}
      onClick={handle}
      onAuxClick={handle}
      className={
        kind === "none"
          ? "text-primary"
          : "cursor-pointer text-primary underline-offset-2 hover:underline"
      }
    >
      {children}
    </a>
  );
}

/**
 * Plain text with its URLs and file paths made clickable (prompt cards, shell
 * output). File paths only become links where a surface can open them.
 */
export function LinkifiedText({ text }: { text: string }) {
  const router = useMarkdownLinkRouter();
  const links = detectTerminalLinks(text).filter((link) => {
    const kind = classifyLinkTarget(link.uri);
    return kind === "external" || (kind === "file" && !!router.openFile);
  });
  if (links.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const link of links) {
    if (link.start > at) parts.push(text.slice(at, link.start));
    parts.push(
      <MarkdownLink key={`${link.start}-${link.uri}`} href={link.uri}>
        {text.slice(link.start, link.end)}
      </MarkdownLink>,
    );
    at = link.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
