import type { ArtifactKind } from "@/modules/artifacts/lib/types";

const STRICT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

type BuildArtifactPreviewDocumentInput = {
  kind: ArtifactKind;
  content: string;
  token: string;
};

type UrlLike = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (href: string) => void;
};

export function isPreviewableArtifactKind(kind: ArtifactKind): boolean {
  return (
    kind === "html" || kind === "react" || kind === "markdown" || kind === "svg"
  );
}

export function buildArtifactPreviewDocument({
  kind,
  content,
  token,
}: BuildArtifactPreviewDocumentInput): string {
  const body = previewBody(kind, content);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}"><style>${previewCss()}</style><script>${errorBridgeScript(token)}</script></head><body>${body}</body></html>`;
}

export function createArtifactBlobUrl(
  document: string,
  urlImpl: UrlLike = URL,
): { href: string; revoke: () => void } {
  const href = urlImpl.createObjectURL(
    new Blob([document], { type: "text/html;charset=utf-8" }),
  );
  return {
    href,
    revoke: () => urlImpl.revokeObjectURL(href),
  };
}

function previewBody(kind: ArtifactKind, content: string): string {
  if (kind === "html") return content;
  if (kind === "svg") return stripSvgScripts(content);
  if (kind === "markdown") return renderSafeMarkdown(content);
  return `<pre>${escapeHtml(content)}</pre>`;
}

function renderSafeMarkdown(markdown: string): string {
  const blocks = markdown
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0);
  if (blocks.length === 0) return "<main></main>";
  return `<main class="markdown">${blocks.map(markdownBlock).join("")}</main>`;
}

function markdownBlock(block: string): string {
  const trimmed = block.trim();
  const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
  }
  return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>`;
}

function stripSvgScripts(svg: string): string {
  return svg.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorBridgeScript(token: string): string {
  const safeToken = JSON.stringify(token);
  return `const token=${safeToken};function send(type,message){parent.postMessage({source:"terax-artifact-preview",token,type,message:String(message||"")},"*")}addEventListener("error",event=>send("error",event.message));addEventListener("unhandledrejection",event=>send("error",event.reason&&event.reason.message?event.reason.message:event.reason));`;
}

function previewCss(): string {
  return "html,body{margin:0;min-height:100%;background:#fff;color:#111;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}body{padding:24px}pre{white-space:pre-wrap;word-break:break-word}.markdown{max-width:72ch;margin:0 auto}.markdown h1,.markdown h2,.markdown h3{line-height:1.1}.markdown p{margin:0 0 1rem}";
}
