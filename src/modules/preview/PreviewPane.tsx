import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { Button } from "@/components/ui/button";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  File01Icon,
  Globe02Icon,
  LinkSquare02Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import { basename, filePreviewKind, type FilePreviewKind } from "./filePreview";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  url: string;
  filePath?: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
  onOpenFile?: (path: string, pin?: boolean) => void;
};

// Tear the iframe down after this much invisibility. A background dev server
// page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ url, filePath, visible, onUrlChange, onOpenFile }, ref) {
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload.
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const addressRef = useRef<PreviewAddressBarHandle>(null);

    useEffect(() => {
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      return () => clearTimeout(t);
    }, [visible]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          setLoaded(true);
          setNonce((n) => n + 1);
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => filePath ?? url,
      }),
      [filePath, url],
    );

    const showXfoHint = !filePath && url ? !isLocalUrl(url) : false;

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        {filePath ? null : (
          <PreviewAddressBar
            ref={addressRef}
            url={url}
            onSubmit={onUrlChange}
            onReload={() => {
              setLoaded(true);
              setNonce((n) => n + 1);
            }}
          />
        )}
        {showXfoHint ? (
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">
              Many public sites refuse to embed (X-Frame-Options). If the page
              is blank, open it externally.
            </span>
          </div>
        ) : null}
        <div
          className={
            filePath || url
              ? "relative min-h-0 flex-1 bg-white dark:bg-background"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {filePath ? (
            <FilePreviewBody
              path={filePath}
              nonce={nonce}
              onReload={() => setNonce((n) => n + 1)}
              onOpenFile={onOpenFile}
            />
          ) : url ? (
            loaded ? (
              <iframe
                key={`${url}#${nonce}`}
                src={url}
                title="Preview"
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type PreparedPreview = {
  token: string;
  kind: Exclude<FilePreviewKind, "markdown">;
  media_type: string;
  size: number;
};

type FilePreviewState =
  | { status: "loading" }
  | {
      status: "asset";
      kind: Exclude<FilePreviewKind, "markdown">;
      src: string;
      mediaType: string;
      size: number;
      width?: number;
      height?: number;
    }
  | { status: "markdown"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "unsupported" }
  | { status: "error"; message: string };

const streamdownComponents = { code: MarkdownCode };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FilePreviewBody({
  path,
  nonce,
  onReload,
  onOpenFile,
}: {
  path: string;
  nonce: number;
  onReload: () => void;
  onOpenFile?: (path: string, pin?: boolean) => void;
}) {
  const [state, setState] = useState<FilePreviewState>({ status: "loading" });
  const kind = filePreviewKind(path);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const load = async () => {
      try {
        if (!kind) {
          setState({ status: "unsupported" });
          return;
        }

        if (kind === "markdown") {
          const res = await invoke<ReadResult>("fs_read_file", {
            path,
            workspace: currentWorkspaceEnv(),
          });
          if (cancelled) return;
          if (res.kind === "text") {
            setState({
              status: "markdown",
              content: res.content,
              size: res.size,
            });
          } else if (res.kind === "toolarge") {
            setState({ status: "toolarge", size: res.size, limit: res.limit });
          } else {
            setState({ status: "binary", size: res.size });
          }
          return;
        }

        const res = await invoke<PreparedPreview>("preview_prepare_file", {
          path,
          workspace: currentWorkspaceEnv(),
        });
        if (cancelled) return;
        setState({
          status: "asset",
          kind: res.kind,
          src: convertFileSrc(res.token, "terax-preview"),
          mediaType: res.media_type,
          size: res.size,
        });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: String(e) });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [kind, nonce, path]);

  if (state.status === "loading") {
    return <FilePreviewMessage title="Loading preview..." path={path} />;
  }
  if (state.status === "error") {
    return (
      <FilePreviewMessage
        title="Preview failed"
        path={path}
        detail={state.message}
        action
      />
    );
  }
  if (state.status === "unsupported") {
    return (
      <FilePreviewMessage
        title="Preview not supported"
        path={path}
        detail="Open this file externally or use a file type Terax can render."
        action
      />
    );
  }
  if (state.status === "toolarge") {
    return (
      <FilePreviewMessage
        title="File too large to preview"
        path={path}
        detail={`${formatBytes(state.size)} exceeds the ${formatBytes(
          state.limit,
        )} preview limit.`}
        action
      />
    );
  }
  if (state.status === "binary") {
    return (
      <FilePreviewMessage
        title="Binary file"
        path={path}
        detail={`${formatBytes(state.size)} - preview not supported.`}
        action
      />
    );
  }

  const metadata =
    state.status === "asset"
      ? {
          size: state.size,
          mediaType: state.mediaType,
          dimensions:
            state.width && state.height ? `${state.width} x ${state.height}` : null,
        }
      : {
          size: state.size,
          mediaType: "text/markdown",
          dimensions: null,
        };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <FilePreviewToolbar
        path={path}
        kind={kind}
        onReload={onReload}
        onEdit={
          kind === "markdown" && onOpenFile
            ? () => onOpenFile(path, true)
            : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.status === "asset" ? (
          <AssetPreview
            state={state}
            path={path}
            onImageSize={(width, height) =>
              setState((current) =>
                current.status === "asset" ? { ...current, width, height } : current,
              )
            }
          />
        ) : (
          <MarkdownPreview content={state.content} />
        )}
      </div>
      <FileMetadataBar {...metadata} />
    </div>
  );
}

function FilePreviewToolbar({
  path,
  kind,
  onReload,
  onEdit,
}: {
  path: string;
  kind: FilePreviewKind | null;
  onReload: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 bg-card/40 px-2">
      <HugeiconsIcon
        icon={File01Icon}
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={path}>
        {basename(path)}
      </span>
      {kind === "markdown" && onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          title="Edit file"
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onReload}
        title="Reload preview"
        className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon
          icon={ArrowReloadHorizontalIcon}
          size={14}
          strokeWidth={1.75}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => void openPath(path).catch(console.error)}
        title="Open externally"
        className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.75} />
      </Button>
    </div>
  );
}

function AssetPreview({
  state,
  path,
  onImageSize,
}: {
  state: Extract<FilePreviewState, { status: "asset" }>;
  path: string;
  onImageSize: (width: number, height: number) => void;
}) {
  if (state.kind === "image") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-background p-3">
        <img
          src={state.src}
          alt={basename(path)}
          className="max-h-full max-w-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            onImageSize(img.naturalWidth, img.naturalHeight);
          }}
        />
      </div>
    );
  }

  if (state.kind === "pdf") {
    return (
      <iframe
        src={state.src}
        title={basename(path)}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (state.kind === "audio") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6">
        <audio src={state.src} controls className="w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <video
        src={state.src}
        controls
        className="max-h-full max-w-full"
        preload="metadata"
      />
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto bg-background px-8 py-6">
      <div className="mx-auto max-w-4xl text-sm leading-6 text-foreground">
        <Streamdown
          className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          components={streamdownComponents}
        >
          {content}
        </Streamdown>
      </div>
    </div>
  );
}

function FileMetadataBar({
  size,
  mediaType,
  dimensions,
}: {
  size: number;
  mediaType: string;
  dimensions: string | null;
}) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border/60 bg-card/40 px-2 text-[11px] text-muted-foreground">
      <span>{formatBytes(size)}</span>
      <span className="truncate">{mediaType}</span>
      {dimensions ? <span className="shrink-0">{dimensions}</span> : null}
    </div>
  );
}

function FilePreviewMessage({
  title,
  path,
  detail,
  action,
}: {
  title: string;
  path: string;
  detail?: string;
  action?: boolean;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={File01Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {detail ?? basename(path)}
        </p>
      </div>
      {action ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openPath(path).catch(console.error)}
        >
          Open externally
        </Button>
      ) : null}
    </div>
  );
}

function SuspendedState({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground">
          Preview suspended
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          Released to free memory after sitting in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Reload
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server. Public sites
          often block embedding - open them in your browser via the link icon if
          you see a blank page.
        </p>
      </div>
    </div>
  );
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
