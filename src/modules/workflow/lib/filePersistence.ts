import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  parseWorkflowDocumentJson,
  serializeWorkflowDocumentForPersistence,
  type WorkflowDocument,
} from "./schema";

export const WORKFLOW_FILE_EXTENSION = ".workflow.json";
export const WORKFLOW_RECENT_FILES_STORAGE_KEY = "terax.workflow.recentFiles";

export type WorkflowRecentFile = {
  path: string;
  title: string;
  updatedAt: number;
};

export type WorkflowFileDialogFilter = {
  name: string;
  extensions: string[];
};

export type WorkflowFileDialog = {
  save: (options: {
    title: string;
    defaultPath: string;
    filters: WorkflowFileDialogFilter[];
  }) => Promise<string | null>;
  open: (options: {
    title: string;
    multiple: boolean;
    directory: boolean;
    filters: WorkflowFileDialogFilter[];
  }) => Promise<string | string[] | null>;
};

type WorkflowFileReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type WorkflowFileSystem = {
  readFile: (path: string) => Promise<WorkflowFileReadResult>;
  writeFile: (path: string, content: string, source: string) => Promise<void>;
};

const tauriWorkflowFileDialog: WorkflowFileDialog = {
  save: (options) => save(options),
  open: (options) => open(options),
};

const tauriWorkflowFileSystem: WorkflowFileSystem = {
  readFile: (path) =>
    invoke<WorkflowFileReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  writeFile: (path, content, source) =>
    invoke<void>("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source,
    }),
};

type WorkflowRecentFileStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function isWorkflowFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(WORKFLOW_FILE_EXTENSION);
}

export function workflowDocumentFilename(document: WorkflowDocument): string {
  return `${safeFilename(document.title || document.id)}${WORKFLOW_FILE_EXTENSION}`;
}

export function workflowFileDialogFilters(): WorkflowFileDialogFilter[] {
  return [{ name: "Terax Workflow", extensions: ["json"] }];
}

export function ensureWorkflowFileExtension(path: string): string {
  if (isWorkflowFilePath(path)) return path;
  const withoutJson = path.toLowerCase().endsWith(".json")
    ? path.slice(0, -".json".length)
    : path;
  return `${withoutJson}${WORKFLOW_FILE_EXTENSION}`;
}

export function suggestWorkflowSaveAsPath(
  document: WorkflowDocument,
  options: { currentPath?: string | null } = {},
): string {
  const filename = workflowDocumentFilename(document);
  const directory = options.currentPath ? pathDirname(options.currentPath) : "";
  return directory ? `${directory}/${filename}` : filename;
}

export async function chooseWorkflowSavePath(
  document: WorkflowDocument,
  options: {
    currentPath?: string | null;
    dialog?: WorkflowFileDialog;
  } = {},
): Promise<string | null> {
  const selected = await (options.dialog ?? tauriWorkflowFileDialog).save({
    title: "Save workflow as",
    defaultPath: suggestWorkflowSaveAsPath(document, {
      currentPath: options.currentPath,
    }),
    filters: workflowFileDialogFilters(),
  });
  return selected ? ensureWorkflowFileExtension(selected) : null;
}

export async function chooseWorkflowOpenPath(
  options: { dialog?: WorkflowFileDialog } = {},
): Promise<string | null> {
  const selected = await (options.dialog ?? tauriWorkflowFileDialog).open({
    title: "Open workflow",
    multiple: false,
    directory: false,
    filters: workflowFileDialogFilters(),
  });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

export function rememberRecentWorkflowFile(
  recent: WorkflowRecentFile[],
  entry: WorkflowRecentFile,
  options: { limit?: number } = {},
): WorkflowRecentFile[] {
  const limit = Math.max(1, options.limit ?? 10);
  return [entry, ...recent.filter((item) => item.path !== entry.path)].slice(
    0,
    limit,
  );
}

export function readWorkflowRecentFiles(
  storage: WorkflowRecentFileStorage | null = defaultRecentStorage(),
): WorkflowRecentFile[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(WORKFLOW_RECENT_FILES_STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isWorkflowRecentFile);
  } catch {
    return [];
  }
}

export function writeWorkflowRecentFiles(
  recent: WorkflowRecentFile[],
  storage: WorkflowRecentFileStorage | null = defaultRecentStorage(),
): void {
  if (!storage) return;
  storage.setItem(
    WORKFLOW_RECENT_FILES_STORAGE_KEY,
    JSON.stringify(recent.filter(isWorkflowRecentFile)),
  );
}

export async function readWorkflowDocumentFile(
  path: string,
  fileSystem: WorkflowFileSystem = tauriWorkflowFileSystem,
): Promise<WorkflowDocument> {
  const result = await fileSystem.readFile(path);
  if (result.kind === "binary") {
    throw new Error("Workflow file is not a text file");
  }
  if (result.kind === "toolarge") {
    throw new Error(
      `Workflow file is too large (${result.size} bytes, limit ${result.limit} bytes)`,
    );
  }

  const parsed = parseWorkflowDocumentJson(result.content);
  if (!parsed.ok) {
    throw new Error(parsed.errors[0] ?? "Workflow file is invalid");
  }
  return parsed.document;
}

export async function writeWorkflowDocumentFile(
  path: string,
  document: WorkflowDocument,
  fileSystem: WorkflowFileSystem = tauriWorkflowFileSystem,
): Promise<void> {
  await fileSystem.writeFile(
    path,
    serializeWorkflowDocumentForPersistence(document),
    "workflow",
  );
}

function defaultRecentStorage(): WorkflowRecentFileStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isWorkflowRecentFile(value: unknown): value is WorkflowRecentFile {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.title === "string" &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

function pathDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  const index = Math.max(slash, backslash);
  if (index < 0) return "";
  return path.slice(0, index);
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "workflow"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
