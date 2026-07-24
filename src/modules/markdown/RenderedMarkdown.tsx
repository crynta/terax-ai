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
import { rehypeHeadingAnchors, resolveFragment } from "./headingAnchors";
import { rehypeLocalImages } from "./localImages";
import { rehypeTableDirectives } from "./tableDirectives";
import "./markdown-base.css";
import "./markdown-theme.css";

const OPENABLE_URL = /^(https?:|mailto:)/i;

type Components = NonNullable<StreamdownProps["components"]>;
type RehypePlugins = NonNullable<StreamdownProps["rehypePlugins"]>;

// Click policy for preview links, after the anchor's preventDefault: an
// in-page fragment scrolls within the clicking link's own pane (never an
// external destination, so it never reaches openUrl and never navigates the
// webview); http(s)/mailto open in the OS browser; anything else (file:,
// bare relative paths) does nothing.
export function handleLinkClick(
  href: string | undefined,
  currentTarget: Element,
): void {
  if (!href) return;
  if (href.startsWith("#")) {
    resolveFragment(currentTarget, href.slice(1))?.scrollIntoView();
  } else if (OPENABLE_URL.test(href)) {
    void openUrl(href).catch(console.error);
  }
}

export const components: Components = {
  // Links open in the OS browser like every other Terax surface (terminal,
  // editor, git history); a plain anchor would navigate the privileged
  // webview to the external page instead. The title reveals the true
  // destination on hover, since rendered link text can spoof it. Replaces
  // Streamdown's link-safety button/popup (disabled below).
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
  // Shared fenced/inline renderer (keeps the #887 MarkdownCode behavior)
  // instead of Streamdown's shiki code block with copy/download controls.
  // Strip the AST `node` so it doesn't leak onto the DOM element through
  // MarkdownCode's prop spread.
  code: ({ node: _node, ...props }) => <MarkdownCode {...props} />,
  // Streamdown's default pre drops the <pre> wrapper entirely. Language
  // fences render ChatCodeBlock, which owns its chrome; plain fences keep
  // <pre> for whitespace and GitHub block styling.
  pre: ({ node, children, ...props }) => {
    const child = node?.children[0];
    const cls =
      child?.type === "element" ? child.properties.className : undefined;
    const fenced =
      Array.isArray(cls) && cls.some((c) => String(c).startsWith("language-"));
    return fenced ? children : <pre {...props}>{children}</pre>;
  },
  // The rest removes Streamdown's chat chrome by pinning each tag back to
  // the plain element; the GitHub look then comes from the vendored
  // stylesheet, not these components. What each Streamdown default would
  // otherwise add: table wraps itself in a bordered card with copy/download/
  // fullscreen controls; thead/tbody/tr/th/td repaint header background,
  // row dividers, cell padding and a 14px cell font; ul/ol/li use inside
  // markers, li padding and inlined paragraphs; blockquote italicizes and
  // recolors; strong renders a <span> GitHub's element selectors miss;
  // sub/sup override the font-size the browser already sizes relatively;
  // img wraps itself in a rounded card with a hover download button; p
  // unwraps images from paragraphs, changing GitHub spacing. Untouched
  // defaults (headings, hr, section footnote cleanup) only carry utility
  // classes that the unlayered GitHub stylesheet already outranks.
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

// Sanitizing is non-negotiable: the preview runs in the privileged Tauri
// webview, so HTML from an arbitrary file must never execute. Streamdown's
// schema follows GitHub's sanitization allowlist; colgroup/col are added for
// the table layout directives (purely presentational, no script or URL
// surface; width= and span= are already in the global attribute allowlist).
// The GFM alert classes emitted by rehypeGithubAlerts are allowlisted as
// enumerated className values on the exact elements that carry them; never
// a blanket className allowance (the MPE CVE-2025-65716 lesson).
// These destructurings rely on Streamdown's internal [plugin, options]
// tuple shape as of 2.5.0 (caret range; a minor reshaping these internals
// is caught by the tuple-shape guard test).
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
  // rehypeLocalImages rewrites relative srcs through convertFileSrc, which
  // yields http://asset.localhost/... on Windows (http is already allowed)
  // and asset://localhost/... elsewhere; asset is the one extra scheme.
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

// Streamdown's own harden options (allow-all URL prefixes; the sanitizer
// above is the real gate), except blocked URLs degrade to plain text: bare
// relative links ("docs/x.md") are routine in GitHub-authored files and the
// default gray "[blocked]" badge would read as document content. Navigation
// is owned by the `a` component either way.
const [rehypeHarden, hardenOptions] = defaultRehypePlugins.harden as [
  unknown,
  Record<string, unknown>,
];

// Order is load-bearing: rehype-raw materializes raw HTML and comments, the
// directive plugin rewrites tables, the alerts plugin rewrites marker
// blockquotes, the anchors plugin assigns heading slug ids, the local-images
// plugin rewrites relative srcs to asset URLs (harden would otherwise block
// them), sanitize prunes next so nothing bypasses it (clobbering ids to
// user-content-<slug>, same as GitHub), harden vets link/image URLs last.
// Built from the plugins Streamdown itself exports
// because passing any rehypePlugins replaces its internal chain wholesale
// (and its allowedTags prop only extends the untouched default chain);
// reusing the exported raw pass also keeps Streamdown's raw-HTML detection
// keyed to it.
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

// Chat keeps Streamdown's link-safety popup; the preview replaces it with
// the `a` component's OS-browser policy above.
const LINK_SAFETY_OFF = { enabled: false };

// The unified pipeline can overflow the call stack on pathological nesting
// (thousands of nested blockquotes or divs) and the app mounts no error
// boundary of its own; contain failures to the pane so the Raw toggle
// survives.
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

// baseDir is the previewed file's directory; without it (callers that only
// have text) relative images keep degrading through harden's text-only
// policy, everything else renders the same.
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

// Like GitHub: a leading YAML frontmatter block renders as a table with the
// keys as the header row, followed by the rest of the document. Values stay
// plain text nodes, so this path is inert even though it bypasses the
// rehype sanitizer.
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
      {/* mode="static" + parseIncompleteMarkdown={false} keep the #913
          invariant: one synchronous parse, no block splitting, streaming
          repair or animation. Remark plugins stay Streamdown's defaults
          (GFM + fence metadata). */}
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
