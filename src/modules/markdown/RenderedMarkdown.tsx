import { CodeRunActionProvider } from "@/components/ai-elements/chat-code";
import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Component, type ReactNode, useMemo } from "react";
import {
  defaultRehypePlugins,
  Streamdown,
  type StreamdownProps,
} from "streamdown";
import { splitFrontmatter } from "./frontmatter";
import { rehypeGithubAlerts } from "./githubAlerts";
import { rehypeHeadingAnchors, scrollToFragment } from "./headingAnchors";
import { rehypeLocalImages } from "./localImages";
import { rehypeTableDirectives } from "./tableDirectives";
import "./markdown-base.css";
import "./markdown-theme.css";

const OPENABLE_URL = /^(https?:|mailto:)/i;

type Components = NonNullable<StreamdownProps["components"]>;
type RehypePlugins = NonNullable<StreamdownProps["rehypePlugins"]>;

export function handleLinkClick(
  href: string | undefined,
  currentTarget: Element,
): void {
  if (!href) return;
  if (href.startsWith("#")) {
    scrollToFragment(currentTarget, href.slice(1));
  } else if (OPENABLE_URL.test(href)) {
    void openUrl(href).catch(console.error);
  }
}

export const components: Components = {
  // A plain anchor would navigate the privileged webview; the title shows
  // the real destination since link text can spoof it.
  a: ({ node: _node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        handleLinkClick(href, e.currentTarget);
      }}
    >
      {children}
    </a>
  ),
  // Strip the AST `node` so MarkdownCode's prop spread doesn't leak it
  // onto the DOM element.
  code: ({ node: _node, ...props }) => <MarkdownCode {...props} />,
  // Fenced blocks render ChatCodeBlock; plain fences keep <pre> for
  // whitespace.
  pre: ({ node, children, ...props }) => {
    const child = node?.children[0];
    const cls =
      child?.type === "element" ? child.properties.className : undefined;
    const fenced =
      Array.isArray(cls) && cls.some((c) => String(c).startsWith("language-"));
    return fenced ? children : <pre {...props}>{children}</pre>;
  },
  // Pin these tags to plain elements: Streamdown's defaults add chat
  // chrome that the vendored stylesheet replaces.
  table: "table",
  thead: "thead",
  tbody: "tbody",
  tr: "tr",
  th: "th",
  td: "td",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  strong: "strong",
  sub: "sub",
  sup: "sup",
  img: "img",
  p: "p",
};

// HTML from an arbitrary previewed file must never execute in the
// privileged webview; schema additions are enumerated, never a blanket
// className allowance.
const [rehypeSanitize, streamdownSchema] = defaultRehypePlugins.sanitize as [
  unknown,
  {
    tagNames?: string[];
    attributes?: Record<string, unknown[]>;
    protocols?: Record<string, unknown[]>;
  },
];
export const sanitizeSchema = {
  ...streamdownSchema,
  // convertFileSrc yields http://asset.localhost/... on Windows (http is
  // already allowed) and asset://localhost/... elsewhere.
  protocols: {
    ...streamdownSchema.protocols,
    src: [...(streamdownSchema.protocols?.src ?? []), "asset"],
  },
  tagNames: [...(streamdownSchema.tagNames ?? []), "colgroup", "col"],
  attributes: {
    ...streamdownSchema.attributes,
    div: [
      ...(streamdownSchema.attributes?.div ?? []),
      [
        "className",
        "markdown-alert",
        "markdown-alert-note",
        "markdown-alert-tip",
        "markdown-alert-important",
        "markdown-alert-warning",
        "markdown-alert-caution",
      ],
    ],
    p: [
      ...(streamdownSchema.attributes?.p ?? []),
      ["className", "markdown-alert-title"],
    ],
  },
};

// Blocked URLs degrade to plain text: bare relative links are routine in
// GitHub-authored files and the default "[blocked]" badge reads as content.
const [rehypeHarden, hardenOptions] = defaultRehypePlugins.harden as [
  unknown,
  Record<string, unknown>,
];

// Order is load-bearing: sanitize prunes after every feature plugin,
// harden vets URLs last. Rebuilt from Streamdown's exported defaults
// because passing rehypePlugins replaces its internal chain wholesale.
export const buildRehypePlugins = (imageBase?: string) =>
  [
    defaultRehypePlugins.raw,
    rehypeTableDirectives,
    rehypeGithubAlerts,
    rehypeHeadingAnchors,
    [rehypeLocalImages, imageBase],
    [rehypeSanitize, sanitizeSchema],
    [
      rehypeHarden,
      {
        ...hardenOptions,
        linkBlockPolicy: "text-only",
        imageBlockPolicy: "text-only",
      },
    ],
  ] as RehypePlugins;

export const rehypePlugins = buildRehypePlugins();

// Preview only; chat keeps Streamdown's link-safety popup.
const LINK_SAFETY_OFF = { enabled: false };

// Pathological nesting can overflow the pipeline's call stack and the app
// mounts no error boundary of its own; contain failures so Raw view survives.
export class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[markdown-preview] render failed", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="text-[12px] text-destructive">
          Failed to render this file as markdown. Use the Raw view to inspect
          it.
        </p>
      );
    }
    return this.props.children;
  }
}

// baseDir is the previewed file's directory; without it relative images
// degrade through harden's text-only policy.
type RenderedMarkdownProps = { content: string; baseDir?: string };

export function RenderedMarkdown({ content, baseDir }: RenderedMarkdownProps) {
  return (
    <PreviewErrorBoundary>
      <CodeRunActionProvider value={false}>
        <RenderedMarkdownInner content={content} baseDir={baseDir} />
      </CodeRunActionProvider>
    </PreviewErrorBoundary>
  );
}

// Frontmatter values render as plain text nodes, inert even though they
// bypass the rehype sanitizer.
function RenderedMarkdownInner({ content, baseDir }: RenderedMarkdownProps) {
  const { entries, body } = splitFrontmatter(content);
  // Stable per baseDir so Streamdown's processor cache keeps hitting.
  const plugins = useMemo(() => buildRehypePlugins(baseDir), [baseDir]);
  return (
    <>
      {entries.length > 0 && (
        <table>
          <thead>
            <tr>
              {entries.map(([key], i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: entries are immutable per mount; index disambiguates duplicate keys
                <th key={`${key}-${i}`}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {entries.map(([key, value], i) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are immutable per mount; index disambiguates duplicate keys
                  key={`${key}-${i}`}
                  className="whitespace-pre-wrap align-top"
                >
                  {value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {/* Static mode: one synchronous parse, no streaming repair. */}
      <Streamdown
        mode="static"
        parseIncompleteMarkdown={false}
        linkSafety={LINK_SAFETY_OFF}
        rehypePlugins={plugins}
        components={components}
      >
        {body}
      </Streamdown>
    </>
  );
}
