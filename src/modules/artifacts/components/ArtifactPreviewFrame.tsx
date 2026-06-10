import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildArtifactPreviewDocument } from "@/modules/artifacts/lib/preview";
import { artifactPreviewRuntimeError } from "@/modules/artifacts/lib/previewMessages";
import {
  loadReactPreviewDocument,
  type ReactPreviewLoadResult,
} from "@/modules/artifacts/lib/reactPreview";
import type {
  Artifact,
  ArtifactDiagnostic,
} from "@/modules/artifacts/lib/types";

type ArtifactPreviewFrameProps = {
  artifact: Artifact;
  className?: string;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
};

type ReactPreviewState =
  | {
      status: "compiling";
      diagnostics: ArtifactDiagnostic[];
    }
  | ReactPreviewLoadResult;

export function ArtifactPreviewFrame({
  artifact,
  className,
  iframeRef,
}: ArtifactPreviewFrameProps) {
  const token = useId();
  const isReactArtifact = artifact.summary.kind === "react";
  const document = useMemo(() => {
    if (isReactArtifact) return null;
    return buildArtifactPreviewDocument({
      kind: artifact.summary.kind,
      content: artifact.content,
      token,
    });
  }, [artifact.content, artifact.summary.kind, isReactArtifact, token]);
  const [reactPreview, setReactPreview] = useState<ReactPreviewState>({
    status: "compiling",
    diagnostics: [],
  });
  const internalIframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);

  useEffect(() => {
    setRuntimeErrors([]);
  }, [artifact.content, artifact.summary.slug, artifact.summary.version]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const error = artifactPreviewRuntimeError(event.data, token);
      if (!error) return;
      setRuntimeErrors((current) => [...current, error].slice(-5));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [token]);

  useEffect(() => {
    if (!isReactArtifact) return;
    let active = true;
    setReactPreview({ status: "compiling", diagnostics: [] });
    loadReactPreviewDocument(artifact.content, token).then((result) => {
      if (active) setReactPreview(result);
    });
    return () => {
      active = false;
    };
  }, [artifact.content, isReactArtifact]);

  if (isReactArtifact) {
    if (reactPreview.status === "compiling") {
      return (
        <div
          className={className}
          role="status"
          aria-label="Compiling React preview"
        >
          <div className="flex h-full min-h-[360px] items-center justify-center text-muted-foreground text-sm">
            Compiling React preview…
          </div>
        </div>
      );
    }

    if (reactPreview.status === "error") {
      return (
        <div className={className} role="alert">
          <div className="flex h-full min-h-[360px] flex-col justify-center gap-2 p-6 text-sm">
            <div className="font-medium text-destructive">
              React preview failed
            </div>
            <ul className="m-0 list-disc flex flex-col gap-1 pl-5 text-muted-foreground">
              {reactPreview.diagnostics.map((diagnostic, index) => (
                <li key={diagnosticKey(diagnostic, index)}>
                  {formatDiagnostic(diagnostic)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }

    return (
      <>
        {reactPreview.diagnostics.length > 0 ? (
          <div className="border-b bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
            {reactPreview.diagnostics.map(formatDiagnostic).join(" • ")}
          </div>
        ) : null}
        <PreviewRuntimeErrors errors={runtimeErrors} />
        <iframe
          className={className}
          title={`Preview of ${artifact.summary.title}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={reactPreview.document}
          ref={iframeRef ?? internalIframeRef}
        />
      </>
    );
  }

  return (
    <>
      <PreviewRuntimeErrors errors={runtimeErrors} />
      <iframe
        className={className}
        title={`Preview of ${artifact.summary.title}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={document ?? ""}
        ref={iframeRef ?? internalIframeRef}
      />
    </>
  );
}

function formatDiagnostic(diagnostic: ArtifactDiagnostic): string {
  const location = diagnostic.line
    ? `line ${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}`
    : null;
  const excerpt = diagnostic.excerpt?.trim();
  return [diagnostic.message, location, excerpt].filter(Boolean).join(" — ");
}

function diagnosticKey(diagnostic: ArtifactDiagnostic, index: number): string {
  return `${diagnostic.code}:${diagnostic.line ?? ""}:${diagnostic.column ?? ""}:${index}`;
}

function PreviewRuntimeErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div
      className="border-b bg-destructive/10 px-3 py-2 text-destructive text-xs"
      role="alert"
    >
      <div className="font-medium">Preview runtime error</div>
      <ul className="m-0 list-disc flex flex-col gap-1 pl-5">
        {errors.map((error, index) => (
          <li key={`${index}:${error}`}>{error}</li>
        ))}
      </ul>
    </div>
  );
}
