export type HoverBlock = {
  kind: "markdown" | "plaintext";
  text: string;
};

const MAX_TOTAL_CHARS = 3200;
const MAX_BLOCK_CHARS = 1800;

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf("\n\n");
  const trimmed =
    boundary > max * 0.5 ? cut.slice(0, boundary) : cut.replace(/\s+\S*$/, "");
  return `${trimmed.trimEnd()}\n\n…`;
}

function normalizeBlock(
  kind: "markdown" | "plaintext",
  text: string,
): HoverBlock | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const effectiveKind =
    kind === "plaintext" && /```[\w-]*\r?\n/.test(trimmed)
      ? "markdown"
      : kind;
  return { kind: effectiveKind, text: truncateText(trimmed, MAX_BLOCK_CHARS) };
}

function parseMarkedString(value: unknown): HoverBlock | null {
  if (typeof value === "string") {
    return normalizeBlock("plaintext", value);
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.value === "string") {
      if (obj.kind === "markdown") {
        return normalizeBlock("markdown", obj.value);
      }
      if (typeof obj.language === "string" && obj.language !== "markdown") {
        return normalizeBlock(
          "markdown",
          `\`\`\`${obj.language}\n${obj.value}\n\`\`\``,
        );
      }
      return normalizeBlock("plaintext", obj.value);
    }
  }
  return null;
}

/** Parse LSP `Hover.contents` into display blocks. */
export function parseHoverContents(contents: unknown): HoverBlock[] {
  if (contents == null) return [];
  const raw: HoverBlock[] = [];
  if (Array.isArray(contents)) {
    for (const item of contents) {
      const block = parseMarkedString(item);
      if (block) raw.push(block);
    }
  } else {
    const block = parseMarkedString(contents);
    if (block) raw.push(block);
  }

  const blocks: HoverBlock[] = [];
  let total = 0;
  for (const block of raw) {
    if (total >= MAX_TOTAL_CHARS) break;
    const room = MAX_TOTAL_CHARS - total;
    const text =
      block.text.length > room ? truncateText(block.text, room) : block.text;
    blocks.push({ ...block, text });
    total += text.length;
  }
  return blocks;
}

function appendInlineMarkdown(el: HTMLElement, text: string) {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) {
      el.appendChild(document.createTextNode(text.slice(last, index)));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.className =
        "rounded bg-muted/70 px-1 py-px font-mono text-[10px] text-foreground";
      code.textContent = token.slice(1, -1);
      el.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.className = "font-semibold text-foreground";
      strong.textContent = token.slice(2, -2);
      el.appendChild(strong);
    } else {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const a = document.createElement("a");
        a.href = linkMatch[2];
        a.textContent = linkMatch[1];
        a.className = "text-primary underline underline-offset-2 hover:opacity-80";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        el.appendChild(a);
      }
    }
    last = index + token.length;
  }
  if (last < text.length) {
    el.appendChild(document.createTextNode(text.slice(last)));
  }
}

function appendProse(parent: HTMLElement, text: string) {
  for (const para of text.split(/\n{2,}/)) {
    const line = para.trim();
    if (!line || /^-{3,}$/.test(line)) continue;

    if (line.startsWith("#")) {
      const heading = document.createElement("p");
      heading.className = "my-1.5 font-semibold text-foreground first:mt-0";
      heading.textContent = line.replace(/^#+\s*/, "");
      parent.appendChild(heading);
      continue;
    }

    const p = document.createElement("p");
    p.className = "my-1 text-popover-foreground first:mt-0";
    for (const row of line.split("\n")) {
      if (p.childNodes.length > 0) p.appendChild(document.createElement("br"));
      appendInlineMarkdown(p, row);
    }
    parent.appendChild(p);
  }
}

function appendMarkdown(parent: HTMLElement, text: string) {
  const segments = text.split(/(```[\w-]*\r?\n[\s\S]*?```)/g);
  for (const seg of segments) {
    const fence = seg.match(/^```([\w-]*)\r?\n([\s\S]*)```$/);
    if (fence) {
      const pre = document.createElement("pre");
      pre.className =
        "cm-lsp-hover-code my-1.5 overflow-x-auto rounded-md border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground";
      const code = document.createElement("code");
      if (fence[1]) code.dataset.lang = fence[1];
      code.textContent = fence[2].replace(/\n$/, "");
      pre.appendChild(code);
      parent.appendChild(pre);
      continue;
    }
    if (seg.trim()) appendProse(parent, seg);
  }
}

function appendPlaintext(parent: HTMLElement, text: string, signature: boolean) {
  const el = document.createElement("div");
  el.className = signature
    ? "whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-foreground"
    : "whitespace-pre-wrap text-[11px] leading-relaxed text-popover-foreground";
  el.textContent = text;
  parent.appendChild(el);
}

function looksLikeSignature(text: string): boolean {
  const first = text.split("\n")[0] ?? "";
  return (
    text.length < 600 &&
    /\b(fn|struct|enum|trait|type|const|mod|impl|async)\b/.test(first)
  );
}

/** Build DOM for a CodeMirror hover tooltip. */
export function renderHoverDom(blocks: HoverBlock[]): HTMLElement {
  const root = document.createElement("div");
  root.className =
    "cm-lsp-hover max-w-lg max-h-80 overflow-y-auto overflow-x-hidden px-2.5 py-2";

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const section = document.createElement("div");
    const signature = i === 0 && looksLikeSignature(block.text);
    if (signature) {
      section.className =
        "border-b border-border/60 pb-2 mb-2 last:mb-0 last:border-0 last:pb-0";
    }

    if (block.kind === "markdown") {
      appendMarkdown(section, block.text);
    } else {
      appendPlaintext(section, block.text, signature);
    }

    if (section.childNodes.length > 0) root.appendChild(section);
  }

  return root;
}
