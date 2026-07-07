#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

export const DEFAULT_LEGACY_SURFACE_RULES = [
  {
    moduleName: "AiChat",
    allowedFiles: ["src/modules/ai/components/AiMiniWindow.tsx"],
  },
  {
    moduleName: "AiChatMessage",
    allowedFiles: ["src/modules/ai/components/AiChat.tsx"],
  },
  {
    moduleName: "PlanDiffReview",
    allowedFiles: ["src/modules/ai/components/AiMiniWindow.tsx"],
  },
  {
    moduleName: "TodoStrip",
    allowedFiles: ["src/modules/ai/components/AiMiniWindow.tsx"],
  },
];

async function trackedFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "src"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return walkFiles(resolve(root, "src"), root);
  }
}

async function walkFiles(dir, root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path, root)));
    } else if (entry.isFile()) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files;
}

function isTestFile(path) {
  return /\.(test|spec)\.[tj]sx?$/.test(path);
}

function moduleNameFromSpecifier(specifier) {
  const match = specifier.match(/(?:^|\/)(AiChat|AiChatMessage|PlanDiffReview|TodoStrip)$/);
  return match?.[1] ?? null;
}

function importSpecifiers(text) {
  const specifiers = [];
  const staticImport = /\bimport\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(staticImport)) {
    specifiers.push(match[1]);
  }
  const sideEffectImport = /\bimport\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(sideEffectImport)) {
    specifiers.push(match[1]);
  }
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(dynamicImport)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

export async function checkPiSurfaceIsolation(
  root = repoRoot,
  rules = DEFAULT_LEGACY_SURFACE_RULES,
) {
  const errors = [];
  const files = (await trackedFiles(root)).filter(
    (file) => file.startsWith("src/") && sourceExtensions.has(extname(file)) && !isTestFile(file),
  );
  const allowedByModule = new Map(
    rules.map((rule) => [rule.moduleName, new Set(rule.allowedFiles)]),
  );

  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const specifier of importSpecifiers(text)) {
      const moduleName = moduleNameFromSpecifier(specifier);
      if (!moduleName) continue;
      const allowedFiles = allowedByModule.get(moduleName) ?? new Set();
      if (!allowedFiles.has(file)) {
        errors.push(
          `${file} imports legacy AI surface ${moduleName}; allowed only in ${[...allowedFiles].join(", ")}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, scannedFiles: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkPiSurfaceIsolation(repoRoot);
  if (!result.ok) {
    console.error("Pi surface isolation check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Pi surface isolation check passed: scanned ${result.scannedFiles} source files.`);
}
