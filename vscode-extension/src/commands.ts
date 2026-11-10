/**
 * Ports of the remaining Terax commands the Reader calls: slash command and
 * skill discovery (src-tauri/src/modules/agent_commands.rs), file stat/read,
 * the Markdown export write, and the `@` file search.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_COMMANDS = 600;
const HEAD_BYTES = 8 * 1024;
const DESCRIPTION_CAP = 240;
const MAX_DEPTH = 4;

export type CommandInfo = { name: string; description: string; source: string };

async function head(file: string): Promise<string> {
  const fh = await fs.open(file, "r").catch(() => null);
  if (!fh) return "";
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

function capDescription(s: string): string {
  const chars = [...s];
  if (chars.length <= DESCRIPTION_CAP) return s;
  return `${chars.slice(0, DESCRIPTION_CAP).join("").trimEnd()}…`;
}

async function frontMatter(
  file: string,
): Promise<{ name?: string; description?: string; invocable: boolean }> {
  const text = await head(file);
  const lines = text.split(/\r?\n/u);
  let name: string | undefined;
  let description: string | undefined;
  let invocable = true;
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (line.trim() === "---") {
        bodyStart = i + 1;
        break;
      }
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line
        .slice(colon + 1)
        .trim()
        .replace(/^["']+|["']+$/gu, "");
      if (key === "name" && value) name = value;
      else if (key === "description" && value) description = value;
      else if (key === "user-invocable") invocable = value !== "false";
    }
  }
  if (description === undefined) {
    description = lines
      .slice(bodyStart)
      .map((l) => l.trim().replace(/^#+/u, "").trim())
      .find((l) => l && l !== "---");
  }
  return {
    name,
    description: description === undefined ? undefined : capDescription(description),
    invocable,
  };
}

async function sortedEntries(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function commandFiles(
  dir: string,
  prefix: string,
  depth: number,
  out: [string, string][],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_COMMANDS) return;
  for (const entry of await sortedEntries(dir)) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await commandFiles(p, prefix ? `${prefix}:${entry.name}` : entry.name, depth + 1, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stem = entry.name.slice(0, -3);
      out.push([prefix ? `${prefix}:${stem}` : stem, p]);
    }
  }
}

async function addCommands(
  dir: string,
  namespace: string | null,
  source: string,
  out: CommandInfo[],
): Promise<void> {
  const files: [string, string][] = [];
  await commandFiles(dir, "", 0, files);
  for (const [name, file] of files) {
    const { description } = await frontMatter(file);
    out.push({
      name: namespace ? `${namespace}:${name}` : name,
      description: description ?? "",
      source,
    });
  }
}

/** A directory, following a symlink (skills are often linked in from a repo). */
async function isDir(p: string): Promise<boolean> {
  return (await fs.stat(p).catch(() => null))?.isDirectory() ?? false;
}

async function addSkills(dir: string, namespace: string | null, out: CommandInfo[]) {
  for (const entry of await sortedEntries(dir)) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await isDir(path.join(dir, entry.name))))) {
      continue;
    }
    const skill = path.join(dir, entry.name, "SKILL.md");
    const st = await fs.stat(skill).catch(() => null);
    if (!st?.isFile()) continue;
    const fm = await frontMatter(skill);
    if (!fm.invocable) continue;
    const name = fm.name ?? entry.name;
    out.push({
      name: namespace ? `${namespace}:${name}` : name,
      description: fm.description ?? "",
      source: "skill",
    });
  }
}

async function installedPlugins(root: string, cwd: string): Promise<[string, string][]> {
  const raw = await fs.readFile(path.join(root, "installed_plugins.json"), "utf8").catch(() => null);
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const plugins = (value as { plugins?: Record<string, unknown> })?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const out: [string, string][] = [];
  for (const [key, installs] of Object.entries(plugins)) {
    const plugin = key.split("@")[0] || key;
    for (const install of Array.isArray(installs) ? installs : []) {
      const i = install as { scope?: string; projectPath?: string; installPath?: string };
      const scope = i.scope ?? "user";
      const applies =
        scope === "user" ||
        (typeof i.projectPath === "string" && cwd.startsWith(i.projectPath));
      if (typeof i.installPath === "string" && applies && i.installPath.startsWith(root)) {
        out.push([plugin, i.installPath]);
        break;
      }
    }
  }
  return out;
}

async function syncedPlugins(root: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const group of await sortedEntries(path.join(root, "synced"))) {
    if (!group.isDirectory()) continue;
    for (const plugin of await sortedEntries(path.join(root, "synced", group.name))) {
      if (plugin.isDirectory()) {
        out.push([plugin.name, path.join(root, "synced", group.name, plugin.name)]);
      }
    }
  }
  return out;
}

export async function listCommands(cwd: string): Promise<CommandInfo[]> {
  const claudeHome = path.join(os.homedir(), ".claude");
  const out: CommandInfo[] = [];
  if (path.isAbsolute(cwd)) {
    await addCommands(path.join(cwd, ".claude", "commands"), null, "project", out);
  }
  await addCommands(path.join(claudeHome, "commands"), null, "user", out);
  await addSkills(path.join(claudeHome, "skills"), null, out);
  // Skills synced from claude.ai: ~/.claude/skills/synced/<source>/<skill>/SKILL.md
  for (const source of await sortedEntries(path.join(claudeHome, "skills", "synced"))) {
    if (source.isDirectory()) {
      await addSkills(path.join(claudeHome, "skills", "synced", source.name), null, out);
    }
  }
  const pluginsRoot = path.join(claudeHome, "plugins");
  const plugins = [
    ...(await installedPlugins(pluginsRoot, cwd)),
    ...(await syncedPlugins(pluginsRoot)),
  ];
  for (const [plugin, dir] of plugins) {
    await addCommands(path.join(dir, "commands"), plugin, "plugin", out);
    await addSkills(path.join(dir, "skills"), plugin, out);
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.name) && !!seen.add(c.name)).slice(0, MAX_COMMANDS);
}

// ---------------------------------------------------------------- files

export async function fsStat(p: string) {
  const st = await fs.lstat(p);
  return {
    size: st.size,
    mtime: Math.floor(st.mtimeMs),
    kind: st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file",
  };
}

const READ_LIMIT = 10 * 1024 * 1024;
const READ_LIMIT_FORCED = 50 * 1024 * 1024;

export async function fsReadFile(p: string, force = false) {
  const st = await fs.stat(p);
  const limit = force ? READ_LIMIT_FORCED : READ_LIMIT;
  if (st.size > limit) return { kind: "toolarge", size: st.size, limit };
  const buf = await fs.readFile(p);
  if (buf.subarray(0, 8192).includes(0)) return { kind: "binary", size: st.size };
  return { kind: "text", content: buf.toString("utf8"), size: st.size, mtime: Math.floor(st.mtimeMs) };
}

/** Only the Reader's Markdown export writes files, and only into Downloads. */
export async function fsWriteExport(p: string, content: string, downloads: string) {
  const dir = await fs.realpath(path.dirname(p));
  const allowed = await fs.realpath(downloads);
  if (dir !== allowed || !p.toLowerCase().endsWith(".md")) {
    throw new Error("exports can only be written to Downloads");
  }
  await fs.writeFile(p, content, "utf8");
  return Math.floor((await fs.stat(p)).mtimeMs);
}

/**
 * Saves a file edited in the Reader's review dialog: only an existing file
 * inside `roots` (workspace folders, Claude session folders), written to a
 * temp file and renamed over it so a crash never leaves it half-written.
 */
export async function fsWriteReviewed(p: string, content: string, roots: readonly string[]) {
  if (!path.isAbsolute(p)) throw new Error("the path must be absolute");
  const real = await fs.realpath(p);
  const inside = await Promise.all(
    roots.map(async (r) => {
      const root = await fs.realpath(r).catch(() => null);
      return root !== null && real.startsWith(root + path.sep);
    }),
  );
  if (!inside.some(Boolean)) throw new Error("the file is outside the workspace");
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error("not a file");
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.terax-${process.pid}.tmp`);
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: st.mode & 0o7777 });
  try {
    await fs.rename(tmp, real);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  return Math.floor((await fs.stat(real)).mtimeMs);
}

// ---------------------------------------------------------------- @ search

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  ".idea",
]);
const INDEX_MAX = 40_000;
const INDEX_TTL_MS = 15_000;

type Indexed = { rel: string; name: string; isDir: boolean };
const indexCache = new Map<string, { at: number; items: Indexed[]; truncated: boolean }>();

async function indexOf(root: string): Promise<{ items: Indexed[]; truncated: boolean }> {
  const hit = indexCache.get(root);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit;
  const items: Indexed[] = [];
  let truncated = false;
  const queue: string[] = [""];
  while (queue.length) {
    const rel = queue.shift() as string;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        items.push({ rel: childRel, name: e.name, isDir: true });
        queue.push(childRel);
      } else if (e.isFile()) {
        items.push({ rel: childRel, name: e.name, isDir: false });
      }
      if (items.length >= INDEX_MAX) {
        truncated = true;
        queue.length = 0;
        break;
      }
    }
  }
  const entry = { at: Date.now(), items, truncated };
  indexCache.set(root, entry);
  return entry;
}

/** Subsequence score: higher for matches in the file name and at word starts. */
function score(item: Indexed, q: string): number {
  const hay = item.rel.toLowerCase();
  if (!q) return 1;
  const nameAt = hay.lastIndexOf(item.name.toLowerCase());
  let s = 0;
  let at = 0;
  let prev = -2;
  for (const ch of q) {
    const i = hay.indexOf(ch, at);
    if (i < 0) return 0;
    s += i === prev + 1 ? 3 : 1;
    if (i >= nameAt) s += 2;
    if (i === 0 || "/-_. ".includes(hay[i - 1])) s += 2;
    prev = i;
    at = i + 1;
  }
  if (item.name.toLowerCase().startsWith(q)) s += 10;
  return s - item.rel.length / 100;
}

export async function fsSearch(root: string, query: string, limit = 40) {
  const { items, truncated } = await indexOf(root);
  const q = query.trim().toLowerCase();
  const ranked = items
    .map((item) => ({ item, s: score(item, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, Math.min(200, limit)));
  return {
    hits: ranked.map(({ item }) => ({
      path: path.join(root, item.rel),
      rel: item.rel,
      name: item.name,
      is_dir: item.isDir,
    })),
    truncated,
    cancelled: false,
  };
}
