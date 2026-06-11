import LayoutTwoColumnIcon from "@hugeicons/core-free-icons/LayoutTwoColumnIcon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArtifactPreviewFrame } from "@/modules/artifacts/components/ArtifactPreviewFrame";
import { artifactsNative } from "@/modules/artifacts/lib/native";
import type { Artifact } from "@/modules/artifacts/lib/types";
import {
  captureIframeScreenshot,
  formatMismatchPercent,
  pixelDiff,
  type CaptureResult,
  type PixelDiffResult,
} from "@/modules/artifacts/lib/visualDiff";
import { PreviewPane } from "@/modules/preview/PreviewPane";

export type ArtifactComparePanelProps = {
  className?: string;
  conversationId: string;
  slug: string;
  url: string;
  onOpenArtifact?: (conversationId: string, slug: string) => void;
  onUrlChange?: (url: string) => void;
};

type DiffMode = "side-by-side" | "overlay";

type ScreenshotState =
  | { status: "idle" }
  | { status: "capturing" }
  | {
      status: "done";
      artifact: CaptureResult;
      browser: CaptureResult;
      diff?: PixelDiffResult;
    }
  | { status: "error"; message: string };

export function ArtifactComparePanel({
  className,
  conversationId,
  slug,
  url,
  onOpenArtifact,
  onUrlChange,
}: ArtifactComparePanelProps) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenshotState, setScreenshotState] = useState<ScreenshotState>({
    status: "idle",
  });
  const [diffMode, setDiffMode] = useState<DiffMode>("side-by-side");

  const artifactIframeRef = useRef<HTMLIFrameElement>(null);
  const browserIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScreenshotState({ status: "idle" });
    artifactsNative
      .get(conversationId, slug)
      .then((nextArtifact) => {
        if (!cancelled) setArtifact(nextArtifact);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setArtifact(null);
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, slug]);

  const handleCaptureDiff = useCallback(async () => {
    const artifactEl = artifactIframeRef.current;
    const browserEl = browserIframeRef.current;
    if (!artifactEl || !browserEl) {
      setScreenshotState({
        status: "error",
        message: "Preview iframes not mounted.",
      });
      return;
    }

    setScreenshotState({ status: "capturing" });

    try {
      const artifactCapture = captureIframeScreenshot(artifactEl);
      const browserCapture = captureIframeScreenshot(browserEl);

      if (artifactCapture.status === "error") {
        setScreenshotState({
          status: "error",
          message: `Artifact: ${artifactCapture.message}`,
        });
        return;
      }
      if (browserCapture.status === "error") {
        setScreenshotState({
          status: "error",
          message: `Browser: ${browserCapture.message}`,
        });
        return;
      }

      let diff: PixelDiffResult | undefined;
      try {
        diff = await pixelDiff(artifactCapture.dataUrl, browserCapture.dataUrl);
      } catch {
        // Diff is best-effort; still show screenshots without it
      }

      setScreenshotState({
        status: "done",
        artifact: artifactCapture,
        browser: browserCapture,
        diff,
      });
    } catch (err) {
      setScreenshotState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const dismissDiff = useCallback(() => {
    setScreenshotState({ status: "idle" });
  }, []);

  const showDiff = screenshotState.status === "done";

  return (
    <section
      aria-label="Artifact browser comparison"
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-sm font-medium">
            Compare artifact to browser route
          </h2>
          <p className="truncate text-muted-foreground text-xs">
            {conversationId}/{slug} ↔ {url || "No route selected"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showDiff ? (
            <>
              <DiffModeToggle mode={diffMode} onChange={setDiffMode} />
              <Button size="xs" variant="ghost" onClick={dismissDiff}>
                Close diff
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={
                screenshotState.status === "capturing" || !artifact || !url
              }
              onClick={handleCaptureDiff}
            >
              {screenshotState.status === "capturing" ? (
                "Capturing…"
              ) : (
                <>
                  <HugeiconsIcon
                    icon={ViewIcon}
                    size={14}
                    strokeWidth={1.75}
                    className="mr-1"
                  />
                  Visual diff
                </>
              )}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onOpenArtifact?.(conversationId, slug)}
          >
            Open artifact
          </Button>
        </div>
      </header>

      {showDiff ? (
        <DiffView
          state={screenshotState}
          mode={diffMode}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2">
          <ComparePane title="Artifact preview">
            {loading ? (
              <StatusMessage>Loading artifact…</StatusMessage>
            ) : error ? (
              <StatusMessage tone="error">
                Artifact failed to load: {error}
              </StatusMessage>
            ) : artifact ? (
              <ArtifactPreviewFrame
                artifact={artifact}
                className="h-full min-h-0 w-full border-0 bg-background"
                iframeRef={artifactIframeRef}
              />
            ) : (
              <StatusMessage>No artifact selected.</StatusMessage>
            )}
          </ComparePane>
          <ComparePane title="Browser route">
            <PreviewPaneWithRef
              url={url}
              iframeRef={browserIframeRef}
              onUrlChange={onUrlChange}
            />
          </ComparePane>
        </div>
      )}

      {screenshotState.status === "error" && (
        <div className="border-t bg-destructive/10 px-3 py-2 text-destructive text-xs">
          Visual diff failed: {screenshotState.message}
        </div>
      )}
    </section>
  );
}

/* ─── Diff View ─────────────────────────────────────────────── */

function DiffView({
  state,
  mode,
  className,
}: {
  state: Extract<ScreenshotState, { status: "done" }>;
  mode: DiffMode;
  className?: string;
}) {
  if (mode === "overlay" && state.diff) {
    return (
      <div className={cn("flex flex-col gap-2 p-2", className)}>
        <DiffSummary diff={state.diff} />
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card">
          <img
            src={state.diff.diffDataUrl}
            alt="Visual difference overlay"
            className="h-auto max-w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2 p-2", className)}>
      {state.diff && <DiffSummary diff={state.diff} />}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <ScreenshotCard label="Artifact" capture={state.artifact} />
        <ScreenshotCard label="Browser route" capture={state.browser} />
      </div>
    </div>
  );
}

function ScreenshotCard({
  label,
  capture,
}: {
  label: string;
  capture: CaptureResult;
}) {
  if (capture.status === "error") {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">
        {capture.message}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-1.5 text-xs font-medium">{label}</div>
      <div className="overflow-auto p-2">
        <img
          src={capture.dataUrl}
          alt={`${label} screenshot`}
          className="h-auto max-w-full rounded"
        />
      </div>
    </div>
  );
}

function DiffSummary({ diff }: { diff: PixelDiffResult }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs">
      <HugeiconsIcon
        icon={LayoutTwoColumnIcon}
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-muted-foreground"
      />
      <span className="text-muted-foreground">
        {formatMismatchPercent(diff.mismatchPercent)} pixels differ
        <span className="ml-2 text-muted-foreground/60">
          ({diff.mismatchedPixels.toLocaleString()} of{" "}
          {diff.totalPixels.toLocaleString()})
        </span>
      </span>
    </div>
  );
}

function DiffModeToggle({
  mode,
  onChange,
}: {
  mode: DiffMode;
  onChange: (m: DiffMode) => void;
}) {
  return (
    <div className="flex rounded-md border text-xs">
      <button
        type="button"
        className={cn(
          "px-2 py-1",
          mode === "side-by-side"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/30",
        )}
        onClick={() => onChange("side-by-side")}
      >
        Side by side
      </button>
      <button
        type="button"
        className={cn(
          "px-2 py-1 border-l",
          mode === "overlay"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/30",
        )}
        onClick={() => onChange("overlay")}
      >
        Overlay
      </button>
    </div>
  );
}

/* ─── Preview Pane With Ref ─────────────────────────────────── */

function PreviewPaneWithRef({
  url,
  iframeRef,
  onUrlChange,
}: {
  url: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onUrlChange?: (url: string) => void;
}) {
  return (
    <div className="h-full w-full">
      <PreviewPane
        url={url}
        visible
        onUrlChange={(nextUrl) => onUrlChange?.(nextUrl)}
        iframeRef={iframeRef}
      />
    </div>
  );
}

/* ─── Shared Primitives ─────────────────────────────────────── */

function ComparePane({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-2 text-xs font-medium">{title}</div>
      <div className="min-h-0 flex-1 bg-background">{children}</div>
    </div>
  );
}

function StatusMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[360px] items-center justify-center p-6 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}
