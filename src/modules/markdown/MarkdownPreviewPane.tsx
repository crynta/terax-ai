import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { cn } from "@/lib/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { rehypeLocalImages } from "./lib/assetPath";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { useMarkdownDocument } from "./useMarkdownDocument";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const components = { a: MarkdownLink, code: MarkdownCode };

export function MarkdownPreviewPane({ path, visible, onSetView }: Props) {
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
          {content !== null && <MarkdownBody path={path} content={content} />}
        </div>
      </div>
    </div>
  );
}

const MarkdownBody = memo(function MarkdownBody({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const rehypePlugins = useMemo(() => {
    const d = defaultRehypePlugins;
    return [
      d.raw,
      d.sanitize,
      rehypeLocalImages(path, (abs) => convertFileSrc(abs)),
      d.harden,
    ];
  }, [path]);

  return (
    <Streamdown
      className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={components}
      rehypePlugins={rehypePlugins}
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {content}
    </Streamdown>
  );
});
