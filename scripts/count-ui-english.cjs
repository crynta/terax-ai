const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const srcRoot = path.join(root, "src");
const i18nFile = path.join(srcRoot, "modules", "i18n", "index.tsx");
const baselineFile = path.join(root, ".omx", "i18n-baseline.json");
const args = process.argv.slice(2);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (/\.(tsx|ts)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readBaseline() {
  if (!fs.existsSync(baselineFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    return typeof data.gitHead === "string" && data.gitHead ? data : null;
  } catch {
    return null;
  }
}

function writeBaseline() {
  const gitHead = git(["rev-parse", "HEAD"]);
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  fs.writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        gitHead,
        recordedAt: new Date().toISOString(),
        note: "Last known Simplified Chinese localization baseline. Run pnpm check:zh before updating this.",
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Recorded Chinese localization baseline at ${gitHead}.`);
}

function changedFilesSince(ref) {
  const tracked = git(["diff", "--name-only", "--diff-filter=ACMR", ref, "--", "src"])
    .split(/\r?\n/)
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "src"])
    .split(/\r?\n/)
    .filter(Boolean);
  return Array.from(new Set([...tracked, ...untracked]))
    .filter((file) => /\.(tsx|ts)$/.test(file))
    .map((file) => path.join(root, file));
}

function targetFiles() {
  if (args.includes("--help")) {
    console.log([
      "Usage:",
      "  node scripts/count-ui-english.cjs              Check files changed since .omx/i18n-baseline.json, or HEAD if no baseline exists",
      "  node scripts/count-ui-english.cjs --all        Check all src/**/*.ts(x) files",
      "  node scripts/count-ui-english.cjs --since REF  Check files changed since REF",
      "  node scripts/count-ui-english.cjs --record-baseline",
    ].join("\n"));
    process.exit(0);
  }
  if (args.includes("--record-baseline")) {
    writeBaseline();
    process.exit(0);
  }
  if (args.includes("--all")) return walk(srcRoot);
  const sinceIndex = args.indexOf("--since");
  if (sinceIndex >= 0 && args[sinceIndex + 1]) {
    return changedFilesSince(args[sinceIndex + 1]);
  }
  const baseline = readBaseline();
  return changedFilesSince(baseline?.gitHead ?? "HEAD");
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readTranslations() {
  const source = fs.readFileSync(i18nFile, "utf8");
  const keys = new Set();
  const entryRe = /^\s*"((?:\\"|[^"])*)"\s*:/gm;
  let match;
  while ((match = entryRe.exec(source))) {
    keys.add(match[1].replace(/\\"/g, '"'));
  }
  return keys;
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function isTechnicalLiteral(text) {
  const value = normalize(text);
  if (!value) return true;
  if (!/[A-Za-z]/.test(value)) return true;
  if (/^https?:\/\//.test(value)) return true;
  if (/^\/[A-Za-z0-9/_-]+$/.test(value)) return true;
  if (/^#?[A-Za-z0-9._@:/-]+$/.test(value)) return true;
  if (/^(&|,|\(|\[)/.test(value)) return true;
  if (/\b(Record|Promise|PromiseLike|VariantProps)\b/.test(value)) return true;
  if (/^[A-Za-z0-9._-]+,\s*[A-Za-z0-9._ -]+\.{3}$/.test(value)) return true;
  if (/^(Apache 2\.0|app\.crynta\.terax|LM Studio|OpenAI|Terax)$/.test(value)) {
    return true;
  }
  return false;
}

const files = targetFiles();
const translations = readTranslations();
const missingTranslations = [];
const hardcodedEnglish = [];

if (files.length === 0) {
  console.log("Chinese localization check passed. No changed src files to scan.");
  process.exit(0);
}

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  const relative = rel(file);

  const tRe = /\bt\(\s*"((?:\\"|[^"])*)"/g;
  let match;
  while ((match = tRe.exec(source))) {
    const key = match[1].replace(/\\"/g, '"');
    if (!translations.has(key)) {
      missingTranslations.push({
        file: relative,
        line: lineOf(source, match.index),
        text: key,
      });
    }
  }

  if (relative === "src/modules/i18n/index.tsx" || !relative.endsWith(".tsx")) continue;

  const attrRe = /\b(title|placeholder|aria-label|label|description)="([^"]*[A-Za-z][^"]*)"/g;
  while ((match = attrRe.exec(source))) {
    const text = normalize(match[2]);
    if (!isTechnicalLiteral(text)) {
      hardcodedEnglish.push({
        file: relative,
        line: lineOf(source, match.index),
        text: `${match[1]}="${text}"`,
      });
    }
  }

  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/<[A-Za-z]/.test(line)) return;
    if (
      /^\s*\/.*\/[gimsuy]*;?\s*$/.test(line) ||
      /^\s*const\s+\w+_RE\s*=.*\/[gimsuy]*;?\s*$/.test(line)
    ) {
      return;
    }
    const jsxTextRe = />\s*([^<>{}`;=]*[A-Za-z][^<>{}`;=]*)\s*</g;
    while ((match = jsxTextRe.exec(line))) {
      const text = normalize(match[1]);
      if (!isTechnicalLiteral(text)) {
        hardcodedEnglish.push({
          file: relative,
          line: index + 1,
          text,
        });
      }
    }
  });
}

if (missingTranslations.length === 0 && hardcodedEnglish.length === 0) {
  console.log("Chinese localization check passed.");
  process.exit(0);
}

if (missingTranslations.length > 0) {
  console.error("Missing zh-CN translations for t(...) keys:");
  for (const item of missingTranslations) {
    console.error(`  ${item.file}:${item.line}  ${item.text}`);
  }
}

if (hardcodedEnglish.length > 0) {
  console.error("Hardcoded English UI strings detected:");
  for (const item of hardcodedEnglish) {
    console.error(`  ${item.file}:${item.line}  ${item.text}`);
  }
}

process.exit(1);
