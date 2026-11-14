import { createElement, useEffect, useState, type ReactNode } from "react";
import {
  MAX_OFFICE_PREVIEW_BYTES,
  validateOfficeArchive,
} from "./lib/officeArchive";

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "caption",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

type Props = { src: string; size: number };
type State = { src: string; content?: string; error?: string };

export function DocxPreview({ src, size }: Props) {
  const [state, setState] = useState<State>({ src });

  useEffect(() => {
    let cancelled = false;
    setState({ src });
    if (size > MAX_OFFICE_PREVIEW_BYTES) {
      setState({ src, error: "DOCX preview is limited to 20 MB." });
      return;
    }

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok)
          throw new Error(`Could not read document (${response.status}).`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > MAX_OFFICE_PREVIEW_BYTES) {
          throw new Error("DOCX preview is limited to 20 MB.");
        }
        validateOfficeArchive(bytes, "DOCX");
        const mammoth = await import("mammoth");
        const converter = mammoth.default;
        const result = await converter.convertToHtml(
          { arrayBuffer: bytes },
          { externalFileAccess: false },
        );
        if (!cancelled) setState({ src, content: result.value });
      } catch (error) {
        if (!cancelled) {
          setState({
            src,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, size]);

  if (state.src !== src || (!state.content && !state.error)) {
    return <PreviewMessage>Loading Word document…</PreviewMessage>;
  }
  if (state.error) return <PreviewMessage>{state.error}</PreviewMessage>;

  return (
    <div className="h-full overflow-auto bg-background px-8 py-6">
      <article className="mx-auto max-w-4xl space-y-3 text-sm leading-7 text-foreground [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_li]:ml-6 [&_ol]:list-decimal [&_p]:whitespace-pre-wrap [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_ul]:list-disc">
        {state.content ? renderSafeHtml(state.content) : null}
      </article>
    </div>
  );
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function renderSafeHtml(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.body.childNodes).map((node, index) =>
    renderNode(node, `docx-${index}`),
  );
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;

  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    return Array.from(node.childNodes).map((child, index) =>
      renderNode(child, `${key}-${index}`),
    );
  }
  if (tag === "img") {
    const src = node.getAttribute("src") ?? "";
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return null;
    return (
      <img
        key={key}
        src={src}
        alt={node.getAttribute("alt") ?? ""}
        className="max-h-[70vh] max-w-full object-contain"
      />
    );
  }

  const children = Array.from(node.childNodes).map((child, index) =>
    renderNode(child, `${key}-${index}`),
  );
  if (tag === "a") {
    const href = safeLink(node.getAttribute("href"));
    return href ? (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      children
    );
  }

  return createAllowedElement(tag, key, children, node);
}

function safeLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function createAllowedElement(
  tag: string,
  key: string,
  children: ReactNode[],
  node: Element,
): ReactNode {
  const props: Record<string, unknown> = { key, children };
  if (tag === "td" || tag === "th") {
    for (const name of ["colspan", "rowspan"]) {
      const value = node.getAttribute(name);
      if (value && /^\d{1,3}$/.test(value)) {
        props[name === "colspan" ? "colSpan" : "rowSpan"] = Number(value);
      }
    }
  }
  return createElement(tag, props, children);
}
