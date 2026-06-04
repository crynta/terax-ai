export const RUST_MEDIATED_TOOL_NAMES = [
  "read",
  "ls",
  "grep",
  "find",
  "bash",
  "edit",
  "write",
];

function stringSchema(description) {
  return { type: "string", description };
}

function numberSchema(description) {
  return { type: "number", description };
}

function booleanSchema(description) {
  return { type: "boolean", description };
}

function objectSchema(properties, required = [], extra = {}) {
  return {
    type: "object",
    properties,
    required,
    ...extra,
  };
}

const READ_SCHEMA = objectSchema(
  {
    path: stringSchema("Path to the file to read (relative or absolute)"),
    offset: numberSchema("Line number to start reading from (1-indexed)"),
    limit: numberSchema("Maximum number of lines to read"),
  },
  ["path"],
);

const LS_SCHEMA = objectSchema({
  path: stringSchema("Directory to list (default: current directory)"),
  limit: numberSchema("Maximum number of entries to return (default: 500)"),
});

const GREP_SCHEMA = objectSchema(
  {
    pattern: stringSchema("Search pattern (regex or literal string)"),
    path: stringSchema("Directory or file to search (default: current directory)"),
    glob: stringSchema("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
    ignoreCase: booleanSchema("Case-insensitive search (default: false)"),
    literal: booleanSchema("Treat pattern as literal string instead of regex (default: false)"),
    context: numberSchema("Number of lines to show before and after each match (default: 0)"),
    limit: numberSchema("Maximum number of matches to return (default: 100)"),
  },
  ["pattern"],
);

const FIND_SCHEMA = objectSchema(
  {
    pattern: stringSchema("Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"),
    path: stringSchema("Directory to search in (default: current directory)"),
    limit: numberSchema("Maximum number of results (default: 1000)"),
  },
  ["pattern"],
);

const BASH_SCHEMA = objectSchema(
  {
    command: stringSchema("Bash command to execute"),
    timeout: numberSchema("Timeout in seconds (optional, no default timeout)"),
  },
  ["command"],
);

const REPLACE_EDIT_SCHEMA = objectSchema(
  {
    oldText: stringSchema(
      "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    ),
    newText: stringSchema("Replacement text for this targeted edit."),
  },
  ["oldText", "newText"],
  { additionalProperties: false },
);

const EDIT_SCHEMA = objectSchema(
  {
    path: stringSchema("Path to the file to edit (relative or absolute)"),
    edits: {
      type: "array",
      items: REPLACE_EDIT_SCHEMA,
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    },
  },
  ["path", "edits"],
  { additionalProperties: false },
);

const WRITE_SCHEMA = objectSchema(
  {
    path: stringSchema("Path to the file to write (relative or absolute)"),
    content: stringSchema("Content to write to the file"),
  },
  ["path", "content"],
);

const TOOL_DEFINITIONS = {
  read: {
    label: "read",
    description:
      "Read the contents of a workspace file. Supports offset/limit for large text files. Terax validates and executes the read in Rust.",
    promptSnippet: "Read file contents through Terax Rust",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
    parameters: READ_SCHEMA,
  },
  ls: {
    label: "ls",
    description:
      "List workspace directory contents. Terax validates and executes the listing in Rust.",
    promptSnippet: "List directory contents through Terax Rust",
    parameters: LS_SCHEMA,
  },
  grep: {
    label: "grep",
    description:
      "Search workspace file contents for a pattern. Terax validates and executes the search in Rust.",
    promptSnippet: "Search file contents through Terax Rust",
    parameters: GREP_SCHEMA,
  },
  find: {
    label: "find",
    description:
      "Search for workspace files by glob pattern. Terax validates and executes the search in Rust.",
    promptSnippet: "Find files through Terax Rust",
    parameters: FIND_SCHEMA,
  },
  bash: {
    label: "bash",
    description:
      "Request a shell command. Terax approval policy and Rust execute the command rather than Pi's built-in shell backend.",
    promptSnippet: "Run shell commands through Terax Rust after approval",
    promptGuidelines: ["Use bash for file operations like ls, rg, find only when dedicated tools are insufficient."],
    parameters: BASH_SCHEMA,
  },
  edit: {
    label: "edit",
    description:
      "Apply exact text replacements to a workspace file. Terax approval policy and Rust execute the edit rather than Pi's built-in editor.",
    promptSnippet: "Edit files through Terax Rust after approval",
    promptGuidelines: ["Use edit for precise changes with exact text replacement."],
    parameters: EDIT_SCHEMA,
  },
  write: {
    label: "write",
    description:
      "Create or overwrite a workspace file. Terax approval policy and Rust execute the write rather than Pi's built-in writer.",
    promptSnippet: "Write files through Terax Rust after approval",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: WRITE_SCHEMA,
  },
};

let nativeToolExecutor = async () => {
  throw new Error("Terax native tool bridge is not connected");
};

export function setNativeToolExecutor(executor) {
  if (typeof executor !== "function") {
    throw new TypeError("native tool executor must be a function");
  }
  nativeToolExecutor = executor;
}

export function setNativeToolExecutorForTests(executor) {
  setNativeToolExecutor(executor);
}

export function resetNativeToolExecutorForTests() {
  nativeToolExecutor = async () => {
    throw new Error("Terax native tool bridge is not connected");
  };
}

function withAbortSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new Error("Operation aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Operation aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeTextPart(part) {
  if (part && typeof part === "object" && part.type === "text") {
    return { type: "text", text: String(part.text ?? "") };
  }
  return { type: "text", text: String(part ?? "") };
}

function normalizeToolResult(result) {
  if (!result || typeof result !== "object") {
    return {
      content: [{ type: "text", text: String(result ?? "") }],
      details: null,
    };
  }
  return {
    content: Array.isArray(result.content)
      ? result.content.map(normalizeTextPart)
      : [{ type: "text", text: String(result.content ?? "") }],
    details: result.details ?? null,
  };
}

export function executeNativeTool(request, signal) {
  const toolCall = nativeToolExecutor(request, signal);
  return withAbortSignal(Promise.resolve(toolCall).then(normalizeToolResult), signal);
}

export function createTeraxNativeToolDefinitions(_pi, session) {
  return RUST_MEDIATED_TOOL_NAMES.map((toolName) => {
    const definition = TOOL_DEFINITIONS[toolName];
    return {
      name: toolName,
      ...definition,
      async execute(toolCallId, input, signal, onUpdate) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Routing ${toolName} through Terax Rust…`,
            },
          ],
        });
        return executeNativeTool(
          {
            sessionId: session.id,
            toolCallId,
            toolName,
            cwd: session.cwd,
            workspaceEnv: session.workspaceEnv ?? { kind: "local" },
            input,
          },
          signal,
        );
      },
    };
  });
}
