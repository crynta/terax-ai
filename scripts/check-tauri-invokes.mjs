#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const frontendRoot = "src";
const rustHandlerPath = "src-tauri/src/lib.rs";

export const DEFAULT_FEATURE_GATED_INVOKES = new Map(
  [
    [
      "openclicky",
      [
        "agent_delete",
        "agent_list",
        "agent_load",
        "agent_memory_append",
        "agent_memory_read",
        "agent_save",
        "agents_import_openclicky",
        "capture_screen",
        "generate_3d_model",
        "list_windows",
        "overlay_clear",
        "overlay_draw",
        "overlay_hide",
        "overlay_show",
        "ptt_register",
        "ptt_unregister",
        "skill_list",
        "transcribe_audio",
        "tts_speak",
        "tts_status",
        "tts_stop",
      ],
    ],
    [
      "workflow",
      [
        "schedule_add_job",
        "schedule_list_jobs",
        "schedule_remove_job",
        "schedule_start_daemon",
        "schedule_stop_daemon",
        "schedule_toggle_job",
        "webhook_list_routes",
        "webhook_register",
        "webhook_start_server",
        "webhook_stop_server",
        "webhook_unregister",
      ],
    ],
  ].flatMap(([feature, commands]) =>
    commands.map((command) => [command, feature]),
  ),
);

export const DEFAULT_DYNAMIC_INVOKE_COMMANDS = [
  "agent_claude_hooks_status",
  "agent_codex_hooks_status",
  "agent_enable_antigravity_hooks",
  "agent_enable_claude_hooks",
  "agent_enable_codex_hooks",
  "agent_enable_gemini_hooks",
  "agent_antigravity_hooks_status",
  "agent_gemini_hooks_status",
  "fs_create_dir",
  "fs_create_file",
];

async function collectFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target") continue;
      files.push(...(await collectFiles(root, path)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function extractFrontendInvokes(text, file) {
  const invokes = [];
  const regex = /\binvoke(?:\s*<[\s\S]*?>)?\s*\(\s*(["'])([A-Za-z0-9_:-]+)\1/g;
  for (const match of text.matchAll(regex)) {
    invokes.push({
      command: match[2],
      file,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }
  return invokes;
}

function extractRegisteredCommands(text) {
  const marker = ".invoke_handler(tauri::generate_handler![";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("Tauri generate_handler block was not found");
  const end = text.indexOf("\n        ])", start);
  if (end < 0) throw new Error("Tauri generate_handler block end was not found");

  const commands = new Map();
  let pendingFeature = null;
  const lines = text.slice(start, end).split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const cfg = rawLine.match(/#\[cfg\(feature = "([^"]+)"\)\]/);
    if (cfg) {
      pendingFeature = cfg[1];
      continue;
    }

    const line = rawLine.replace(/#\[cfg\([^\]]+\)\]/g, "").trim();
    const entry = line.match(/^([A-Za-z_][\w]*(?:::[A-Za-z_][\w]*)*)\s*,/);
    if (!entry) continue;

    const symbol = entry[1];
    const command = symbol.split("::").at(-1);
    commands.set(command, {
      feature: pendingFeature,
      line: index + 1,
      symbol,
    });
    pendingFeature = null;
  }
  return commands;
}

function isFrontendSource(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith(`${frontendRoot}/`)) return false;
  if (normalized.includes(".test.")) return false;
  if (normalized.includes(".spec.")) return false;
  return true;
}

async function scanFrontendInvokes(root) {
  const absoluteRoot = resolve(root, frontendRoot);
  const files = await collectFiles(resolve(root), absoluteRoot);
  const invokes = [];
  for (const absolutePath of files) {
    const file = relative(root, absolutePath).replaceAll("\\", "/");
    if (!isFrontendSource(file)) continue;
    const text = await readFile(absolutePath, "utf8");
    invokes.push(...extractFrontendInvokes(text, file));
  }
  return invokes;
}

export async function checkTauriInvokes(
  root = repoRoot,
  rules = {
    dynamicInvokeCommands: DEFAULT_DYNAMIC_INVOKE_COMMANDS,
    featureGatedInvokes: DEFAULT_FEATURE_GATED_INVOKES,
  },
) {
  const libText = await readFile(resolve(root, rustHandlerPath), "utf8");
  const registered = extractRegisteredCommands(libText);
  const invokes = await scanFrontendInvokes(root);
  const errors = [];
  const allowedFeatureGatedInvokes =
    rules.featureGatedInvokes ?? DEFAULT_FEATURE_GATED_INVOKES;
  const declaredDynamicInvokeCommands =
    rules.dynamicInvokeCommands ?? DEFAULT_DYNAMIC_INVOKE_COMMANDS;

  for (const invoke of invokes) {
    const handler = registered.get(invoke.command);
    if (!handler) {
      errors.push(
        `${invoke.file}:${invoke.line} invokes ${invoke.command}, but src-tauri/src/lib.rs does not register it`,
      );
      continue;
    }
    if (handler.feature) {
      const allowedFeature = allowedFeatureGatedInvokes.get(invoke.command);
      if (allowedFeature !== handler.feature) {
        errors.push(
          `${invoke.file}:${invoke.line} invokes feature gated command ${invoke.command} without an allowlist entry for ${handler.feature}`,
        );
      }
    }
  }

  for (const command of declaredDynamicInvokeCommands) {
    if (!registered.has(command)) {
      errors.push(`dynamic invoke allowlist references unregistered command ${command}`);
    }
  }

  for (const [command, feature] of allowedFeatureGatedInvokes) {
    const handler = registered.get(command);
    if (!handler) {
      errors.push(`feature gated invoke allowlist references unregistered command ${command}`);
      continue;
    }
    if (handler.feature !== feature) {
      errors.push(
        `feature gated invoke allowlist expects ${command} to use feature ${feature}, but Rust registers ${handler.feature ?? "default"}`,
      );
    }
  }

  const uniqueInvokedCommands = new Set(invokes.map((invoke) => invoke.command));
  const featureGatedInvokedCommands = [...uniqueInvokedCommands].filter((command) =>
    allowedFeatureGatedInvokes.has(command),
  );

  return {
    ok: errors.length === 0,
    errors,
    featureGatedInvokedCommands: featureGatedInvokedCommands.length,
    invokedCommands: uniqueInvokedCommands.size,
    invocations: invokes.length,
    registeredCommands: registered.size,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkTauriInvokes(repoRoot);
  if (!result.ok) {
    console.error("Tauri invoke check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `Tauri invoke check passed: ${result.invokedCommands} commands across ${result.invocations} literal invocations; ${result.featureGatedInvokedCommands} feature gated commands documented.`,
  );
}
