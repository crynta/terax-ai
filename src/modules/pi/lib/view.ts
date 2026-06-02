import type { PiPromptContext } from "@/modules/pi/lib/sessions";

export type PiContextPreviewItem = {
  key: "workspace" | "terminal" | "file" | "mode";
  label: string;
  value: string;
  detail: string | null;
  missing: boolean;
  tone: "default" | "muted" | "private";
};

function stripTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function normalizePath(path: string): string {
  return stripTrailingSeparators(path).replace(/\\/g, "/");
}

export function pathBasename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = stripTrailingSeparators(path);
  if (!cleaned) return path;
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

function pathLabel(
  path: string | null | undefined,
  root: string | null,
): string | null {
  if (!path) return null;
  if (!root) return pathBasename(path) ?? path;

  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (normalizedPath === normalizedRoot) {
    return pathBasename(root) ?? root;
  }

  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  return pathBasename(path) ?? path;
}

function pathItem(
  key: PiContextPreviewItem["key"],
  label: string,
  path: string | null | undefined,
  missingValue: string,
  root: string | null,
): PiContextPreviewItem {
  const value = pathLabel(path, root);
  return {
    key,
    label,
    value: value ?? missingValue,
    detail: path ?? null,
    missing: value === null,
    tone: value === null ? "muted" : "default",
  };
}

export function buildPiContextPreview(
  context: PiPromptContext,
  sessionCwd: string | null | undefined,
): PiContextPreviewItem[] {
  const workspaceRoot = context.workspaceRoot ?? sessionCwd ?? null;
  return [
    pathItem(
      "workspace",
      "Workspace",
      workspaceRoot,
      "No workspace",
      workspaceRoot,
    ),
    pathItem(
      "terminal",
      "Terminal",
      context.activeTerminalCwd,
      "No terminal",
      workspaceRoot,
    ),
    pathItem("file", "File", context.activeFile, "No file", workspaceRoot),
    {
      key: "mode",
      label: "Mode",
      value: context.activeTerminalPrivate ? "Private" : "Standard",
      detail: context.activeTerminalPrivate
        ? "Terminal context is marked private"
        : "Terminal context is available when present",
      missing: false,
      tone: context.activeTerminalPrivate ? "private" : "muted",
    },
  ];
}
