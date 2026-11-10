import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { checkReadable } from "@/modules/ai/lib/security";
import { cn } from "@/lib/utils";
import { useAssetGrant } from "@/lib/useAssetGrant";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { previewBoundary, rehypeLocalImages } from "./lib/assetPath";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { useMarkdownDocument } from "./useMarkdownDocument";

type Props = {
  path: string;
  /** Images load only from beneath this folder (the document's own folder if it lies outside). */
  workspaceRoot?: string | null;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const components = { a: MarkdownLink, code: MarkdownCode };

export function MarkdownPreviewPane({
  path,
  workspaceRoot = null,
  visible,
  onSetView,
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
            />
          )}
        </div>
      </div>
    </div>
  );
}

const MarkdownBody = memo(function MarkdownBody({
  path,
  boundary,
  content,
}: {
  path: string;
  boundary: string;
  content: string;
}) {
  const { urlFor: assetUrlFor, error: assetError, retry } = useAssetGrant(boundary);
  const rehypePlugins = useMemo(() => {
    const d = defaultRehypePlugins;
    return [
      d.raw,
      d.sanitize,
      rehypeLocalImages(path, (abs) => assetUrlFor(abs) ?? "data:,", {
        boundary,
        isReadable: (abs) => checkReadable(abs).ok,
      }),
      d.harden,
    ];
  }, [path, boundary, assetUrlFor]);

  return (
    <>
    {assetError && <div className="mb-3 text-xs text-muted-foreground"><p role="alert">Local images unavailable: {assetError}</p><button type="button" className="underline" onClick={retry}>Retry images</button></div>}
    <Streamdown
      className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={components}
      rehypePlugins={rehypePlugins}
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {content}
    </Streamdown>
    </>
  );
});
