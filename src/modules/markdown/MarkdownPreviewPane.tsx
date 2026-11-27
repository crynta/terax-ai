import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { useAssetGrant } from "@/lib/useAssetGrant";
import { cn } from "@/lib/utils";
import { checkReadable } from "@/modules/ai/lib/security";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  defaultRehypePlugins,
  Streamdown,
  type StreamdownProps,
} from "streamdown";
import {
  previewBoundary,
  rehypeAllowBareRelativeLinks,
  rehypeLocalImages,
  rehypeRestoreDocHrefs,
} from "./lib/assetPath";
import {
  findMarkdownFragment,
  rehypeHeadingAnchors,
} from "./lib/headingAnchors";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { useMarkdownDocument } from "./useMarkdownDocument";

type Props = {
  path: string;
  /** Images load only from beneath this folder (the document's own folder if it lies outside). */
  workspaceRoot?: string | null;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
  onOpenFile?: (path: string, pin?: boolean, fragment?: string) => void;
  scrollToFragment?: string | null;
  onFragmentConsumed?: () => void;
};

export function MarkdownPreviewPane({
  path,
  workspaceRoot = null,
  visible,
  onSetView,
  onOpenFile,
  scrollToFragment,
  onFragmentConsumed,
}: Props) {
  const status = useMarkdownDocument(path, visible);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const content = status.kind === "ready" ? status.content : null;

  // A retargeted preview starts at the top, not at the old document's offset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger.
  useLayoutEffect(() => {
    scrollTopRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [path]);

  const onScroll = useCallback(() => {
    scrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
  }, []);

  // New text replaces blocks in place; put the view back where the reader was
  // in case the swap collapsed the document for a frame.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && content !== null && el.scrollTop !== scrollTopRef.current) {
      el.scrollTop = scrollTopRef.current;
    }
  }, [content]);

  useLayoutEffect(() => {
    if (!visible || !scrollToFragment || content === null) return;
    const root = scrollRef.current;
    if (!root) return;
    findMarkdownFragment(root, scrollToFragment)?.scrollIntoView({
      block: "start",
    });
    onFragmentConsumed?.();
  }, [visible, scrollToFragment, content, onFragmentConsumed]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto">
        <div className="px-8 py-6">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to read file: {status.message}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              Binary file — cannot render as markdown.
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              File is {status.size} bytes; limit {status.limit}.
            </p>
          )}
          {content !== null && (
            <MarkdownBody
              path={path}
              boundary={previewBoundary(path, workspaceRoot)}
              content={content}
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function buildPreviewRehypePlugins({
  path,
  boundary,
  assetUrlFor,
}: {
  path: string;
  boundary: string;
  assetUrlFor: (abs: string) => string | undefined;
}) {
  const d = defaultRehypePlugins;
  const sanitize = d.sanitize;
  const sanitizeForPreview = Array.isArray(sanitize)
    ? ([
        sanitize[0],
        {
          ...sanitize[1],
          protocols: {
            ...sanitize[1]?.protocols,
            src: [
              ...(sanitize[1]?.protocols?.src ?? ["http", "https"]),
              "data",
            ],
          },
        },
      ] satisfies typeof sanitize)
    : sanitize;
  return [
    d.raw,
    sanitizeForPreview,
    rehypeHeadingAnchors,
    rehypeLocalImages(path, (abs) => assetUrlFor(abs) ?? "data:,", {
      boundary,
      isReadable: (abs) => checkReadable(abs).ok,
    }),
    rehypeAllowBareRelativeLinks(path),
    d.harden,
    rehypeRestoreDocHrefs(),
  ] satisfies NonNullable<StreamdownProps["rehypePlugins"]>;
}

const MarkdownBody = memo(function MarkdownBody({
  path,
  boundary,
  content,
  onOpenFile,
}: {
  path: string;
  boundary: string;
  content: string;
  onOpenFile?: (path: string, pin?: boolean, fragment?: string) => void;
}) {
  const {
    urlFor: assetUrlFor,
    error: assetError,
    retry,
  } = useAssetGrant(boundary);
  // Streamdown's comparator uses plugins identity but skips rehypePlugins.
  const { rehypePlugins, plugins } = useMemo(
    () => ({
      rehypePlugins: buildPreviewRehypePlugins({ path, boundary, assetUrlFor }),
      plugins: {},
    }),
    [path, boundary, assetUrlFor],
  );
  const components = useMemo(
    () => ({
      a: (props: Parameters<typeof MarkdownLink>[0]) => (
        <MarkdownLink {...props} documentPath={path} onOpenFile={onOpenFile} />
      ),
      code: MarkdownCode,
    }),
    [path, onOpenFile],
  );

  return (
    <>
      {assetError && (
        <div className="mb-3 text-xs text-muted-foreground">
          <p role="alert">Local images unavailable: {assetError}</p>
          <button type="button" className="underline" onClick={retry}>
            Retry images
          </button>
        </div>
      )}
      <Streamdown
        key={`${path}\0${boundary}`}
        className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        components={components}
        rehypePlugins={rehypePlugins}
        plugins={plugins}
        mode="static"
        parseIncompleteMarkdown={false}
      >
        {content}
      </Streamdown>
    </>
  );
});
