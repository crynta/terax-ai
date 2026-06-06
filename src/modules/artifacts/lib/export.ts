import type { Artifact, ArtifactKind } from "@/modules/artifacts/lib/types";

const EXPORT_EXTENSIONS: Record<ArtifactKind, string> = {
  html: "html",
  react: "html",
  markdown: "md",
  text: "txt",
  json: "json",
  svg: "svg",
};

export function artifactExportFilename(artifact: Artifact): string {
  return `${artifact.summary.slug}.${EXPORT_EXTENSIONS[artifact.summary.kind]}`;
}

export function artifactExportFilters(kind: ArtifactKind) {
  if (kind === "react") {
    return [{ name: "Compiled React HTML", extensions: ["html", "htm"] }];
  }
  const extension = EXPORT_EXTENSIONS[kind];
  return [
    { name: `${kind.toUpperCase()} artifact`, extensions: [extension] },
    { name: "All files", extensions: ["*"] },
  ];
}
