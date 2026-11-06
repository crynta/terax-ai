/**
 * Node port of Terax's Claude transcript commands
 * (src-tauri/src/modules/agent_transcript.rs). Same caps, paging and error
 * strings, so the Reader's logic behaves exactly as it does in Terax.
 */
import { randomBytes } from "node:crypto";
import { constants as fsc, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MiB = 1024 * 1024;
const TAIL_BYTES = 2 * MiB;
const PAGE_BYTES = MiB;
const TEXT_CAP = 64 * 1024;
const RESULT_CAP = 16 * 1024;
const INPUT_CAP = 16 * 1024;
const SYSTEM_CAP = 4 * 1024;
const IMAGE_LINE_CAP = 24 * MiB;
const IMAGE_DATA_CAP = 12 * MiB;
const PASTED_IMAGE_CAP = 12 * MiB;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const CONTEXT_CAP = 256 * 1024;
const SUMMARY_HEAD_BYTES = 512 * 1024;
const SUMMARY_TAIL_BYTES = 256 * 1024;
const SUMMARY_LINE_MAX = 256 * 1024;
const SUMMARY_PROMPT_CHARS = 200;
const LIST_MAX = 100;
const TURN_COUNT_MAX_BYTES = 128 * MiB;
const SEARCH_FILES_MAX = 60;
const SEARCH_BYTES_MAX = 768 * MiB;
const SNIPPET_CONTEXT_CHARS = 60;
const CHUNK = 64 * 1024;

const LEADING_TYPE = Buffer.from('{"type":"');
const KEEP_LEADING = [Buffer.from('ai-title"')];
const NL = 0x0a;

// ---------------------------------------------------------------- paths

export function isSessionId(id: string): boolean {
  if (id.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = id[i];
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== "-") return false;
    } else if (!/[0-9a-fA-F]/u.test(c)) return false;
  }
  return true;
}

/** `/Users/a.b/x_y` → `-Users-a-b-x-y`, Claude's project folder name. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/gu, "-");
}

let projectsRootOverride: string | null = null;
/** Tests point the module at a fixture folder. */
export function setProjectsRootForTests(dir: string | null): void {
  projectsRootOverride = dir;
  resolved.clear();
}

function projectsRoot(): string {
  return projectsRootOverride ?? path.join(os.homedir(), ".claude", "projects");
}

const resolved = new Map<string, string>();

async function isRegularFile(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isFile();
  } catch {
    return false;
  }
}

async function resolveSession(id: string): Promise<string> {
  if (!isSessionId(id)) throw new Error("invalid session id");
  const cached = resolved.get(id);
  if (cached && (await isRegularFile(cached))) return cached;
  let root: string;
  try {
    root = await fs.realpath(projectsRoot());
  } catch {
    throw new Error(`no transcript for session ${id}`);
  }
  const subs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const sub of subs) {
    if (!sub.isDirectory()) continue;
    const candidate = path.join(root, sub.name, `${id}.jsonl`);
    if (!(await isRegularFile(candidate))) continue;
    const real = await fs.realpath(candidate).catch(() => null);
    if (!real || !real.startsWith(root + path.sep)) continue;
    resolved.set(id, candidate);
    return candidate;
  }
  throw new Error(`no transcript for session ${id}`);
}

type SessionFile = { id: string; file: string; mtimeMs: number; size: number };

async function sessionFiles(cwd: string): Promise<SessionFile[]> {
  const dir = path.join(projectsRoot(), encodeProjectDir(cwd));
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: SessionFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -6);
    if (!isSessionId(id)) continue;
    const file = path.join(dir, name);
    const st = await fs.lstat(file).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ id, file, mtimeMs: Math.floor(st.mtimeMs), size: st.size });
  }
  return out;
}

// ---------------------------------------------------------------- entries

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolUse"; id: string; name: string; input: Json }
  | { type: "toolResult"; toolUseId: string; content: string; isError: boolean }
  | { type: "image"; index: number };

export type Entry = {
  kind: "user" | "assistant" | "system" | "title";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  isSidechain?: true;
  isMeta?: true;
  blocks?: Block[];
  toolUseResult?: Record<string, string | boolean>;
  thinkingDurationMs?: number;
  subtype?: string;
  text?: string;
  lineOffset?: number;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
};

/** `s` cut to at most `max` UTF-8 bytes on a char boundary, marked when cut. */
export function cap(s: string, max: number): string {
  if (Buffer.byteLength(s, "utf8") <= max) return s;
  const buf = Buffer.from(s, "utf8");
  let end = max;
  // Back up to a char boundary: continuation bytes are 10xxxxxx.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return `${buf.subarray(0, end).toString("utf8")}…`;
}

function capValue(value: Json, max: number): Json {
  if (typeof value === "string") return cap(value, max);
  if (Array.isArray(value)) return value.map((v) => capValue(v, max));
  if (value && typeof value === "object") {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) out[k] = capValue(v, max);
    return out;
  }
  return value;
}

const str = (o: Obj, key: string): string | undefined =>
  typeof o[key] === "string" ? (o[key] as string) : undefined;
const isObj = (v: Json | undefined): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);

function resultText(content: Json | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isObj)
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string")
      .join("\n");
  }
  return "";
}

function blocksOf(content: Json | undefined): Block[] {
  if (typeof content === "string") {
    return [{ type: "text", text: cap(content, TEXT_CAP) }];
  }
  if (!Array.isArray(content)) return [];
  let images = 0;
  const out: Block[] = [];
  for (const item of content) {
    if (!isObj(item)) continue;
    switch (item.type) {
      case "text":
        if (typeof item.text === "string") {
          out.push({ type: "text", text: cap(item.text, TEXT_CAP) });
        }
        break;
      case "thinking":
        out.push({
          type: "thinking",
          text: cap(typeof item.thinking === "string" ? item.thinking : "", TEXT_CAP),
        });
        break;
      case "tool_use":
        if (typeof item.id === "string" && typeof item.name === "string") {
          out.push({
            type: "toolUse",
            id: item.id,
            name: item.name,
            input: capValue(item.input ?? null, INPUT_CAP),
          });
        }
        break;
      case "tool_result":
        if (typeof item.tool_use_id === "string") {
          out.push({
            type: "toolResult",
            toolUseId: item.tool_use_id,
            content: cap(resultText(item.content), RESULT_CAP),
            isError: item.is_error === true,
          });
        }
        break;
      case "image":
        out.push({ type: "image", index: images++ });
        break;
    }
  }
  return out;
}

function toolUseResult(value: Json | undefined): Entry["toolUseResult"] {
  if (!isObj(value)) return undefined;
  const out: Record<string, string | boolean> = {};
  const put = (key: string, limit: number) => {
    const v = str(value, key);
    if (v !== undefined) out[key] = cap(v, limit);
  };
  put("filePath", SYSTEM_CAP);
  if (out.filePath === undefined && isObj(value.file)) {
    const fp = str(value.file, "filePath");
    if (fp !== undefined) out.filePath = fp;
  }
  put("oldString", TEXT_CAP);
  put("newString", TEXT_CAP);
  put("stdout", RESULT_CAP);
  put("stderr", RESULT_CAP);
  if (value.interrupted === true) out.interrupted = true;
  const meaningful = Object.entries(out).some(([, v]) => v !== "" && v !== false);
  return meaningful ? out : undefined;
}

function skippedByLeadingType(head: Buffer): boolean {
  if (head.length < LEADING_TYPE.length) return false;
  if (!head.subarray(0, LEADING_TYPE.length).equals(LEADING_TYPE)) return false;
  const rest = head.subarray(LEADING_TYPE.length);
  return !KEEP_LEADING.some(
    (k) => rest.length >= k.length && rest.subarray(0, k.length).equals(k),
  );
}

export function parseLine(line: Buffer): Entry | null {
  if (line.length === 0) return null;
  if (skippedByLeadingType(line)) return null;
  let value: Json;
  try {
    value = JSON.parse(line.toString("utf8")) as Json;
  } catch {
    return null;
  }
  if (!isObj(value) || typeof value.type !== "string") return null;
  if (value.type === "ai-title") {
    const title = str(value, "aiTitle");
    return title === undefined ? null : { kind: "title", text: cap(title, SYSTEM_CAP) };
  }
  if (value.type !== "user" && value.type !== "assistant" && value.type !== "system") {
    return null;
  }
  const entry: Entry = { kind: value.type };
  const uuid = str(value, "uuid");
  if (uuid !== undefined) entry.uuid = uuid;
  const parent = str(value, "parentUuid");
  if (parent !== undefined) entry.parentUuid = parent;
  const ts = str(value, "timestamp");
  if (ts !== undefined) entry.timestamp = ts;
  if (value.isSidechain === true) entry.isSidechain = true;
  if (value.isMeta === true) entry.isMeta = true;
  if (value.type === "system") {
    const subtype = str(value, "subtype");
    if (subtype !== undefined) entry.subtype = subtype;
    const content = str(value, "content");
    if (content !== undefined) entry.text = cap(content, SYSTEM_CAP);
    return entry;
  }
  const message = isObj(value.message) ? value.message : undefined;
  const blocks = blocksOf(message?.content);
  if (blocks.length) entry.blocks = blocks;
  if (typeof value.thinkingDurationMs === "number" && value.thinkingDurationMs >= 0) {
    entry.thinkingDurationMs = Math.floor(value.thinkingDurationMs);
  }
  const tur = toolUseResult(value.toolUseResult);
  if (tur) entry.toolUseResult = tur;
  if (value.type === "assistant" && message) {
    const model = str(message, "model");
    if (model !== undefined && model.length <= 80 && model !== "<synthetic>") {
      entry.model = model;
    }
    if (isObj(message.usage)) {
      const u = message.usage;
      const n = (k: string) =>
        typeof u[k] === "number" && (u[k] as number) >= 0 ? Math.floor(u[k] as number) : 0;
      entry.usage = {
        inputTokens: n("input_tokens"),
        outputTokens: n("output_tokens"),
        cacheReadInputTokens: n("cache_read_input_tokens"),
        cacheCreationInputTokens: n("cache_creation_input_tokens"),
      };
    }
  }
  return entry;
}

const hasImage = (e: Entry) => e.blocks?.some((b) => b.type === "image") ?? false;

// ---------------------------------------------------------------- paging

export type TranscriptPage = {
  entries: Entry[];
  startOffset: number;
  nextOffset: number;
  size: number;
  reset: boolean;
};

type Handle = fs.FileHandle;

async function readAt(fh: Handle, start: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  let done = 0;
  while (done < len) {
    const { bytesRead } = await fh.read(buf, done, len - done, start + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done === len ? buf : buf.subarray(0, done);
}

async function findLineEnd(fh: Handle, from: number, size: number): Promise<number | null> {
  let pos = from;
  while (pos < size) {
    const chunk = await readAt(fh, pos, Math.min(CHUNK, size - pos));
    if (chunk.length === 0) break;
    const i = chunk.indexOf(NL);
    if (i >= 0) return pos + i + 1;
    pos += chunk.length;
  }
  return null;
}

async function lineStartBefore(fh: Handle, lineEnd: number): Promise<number> {
  let pos = Math.max(0, lineEnd - 1);
  while (pos > 0) {
    const from = Math.max(0, pos - CHUNK);
    const chunk = await readAt(fh, from, pos - from);
    const i = chunk.lastIndexOf(NL);
    if (i >= 0) return from + i + 1;
    pos = from;
  }
  return 0;
}

async function readLongLine(fh: Handle, start: number, end: number): Promise<Entry | null> {
  const len = end - start;
  if (len <= 0 || len > IMAGE_LINE_CAP) return null;
  const head = await readAt(fh, start, Math.min(64, len));
  if (skippedByLeadingType(head)) return null;
  const line = await readAt(fh, start, len);
  let trimmed = line.length;
  while (trimmed > 0 && /\s/u.test(String.fromCharCode(line[trimmed - 1]))) trimmed -= 1;
  const entry = parseLine(line.subarray(0, trimmed));
  if (entry && hasImage(entry)) entry.lineOffset = start;
  return entry;
}

export async function readPage(
  file: string,
  offset: number | null,
  before: number | null,
): Promise<TranscriptPage> {
  const fh = await fs.open(file, "r");
  try {
    const size = (await fh.stat()).size;
    let reset = false;
    let start: number;
    let end: number;
    let aligned: boolean;
    if (before !== null) {
      end = Math.min(before, size);
      start = Math.max(0, end - PAGE_BYTES);
      aligned = end <= PAGE_BYTES;
    } else if (offset !== null && offset <= size) {
      start = offset;
      end = Math.min(offset + PAGE_BYTES, size);
      aligned = true;
    } else {
      if (offset !== null) reset = true;
      start = Math.max(0, size - TAIL_BYTES);
      end = size;
      aligned = size <= TAIL_BYTES;
    }
    const buf = await readAt(fh, start, end - start);
    const first = aligned ? 0 : (() => {
      const i = buf.indexOf(NL);
      return i < 0 ? buf.length : i + 1;
    })();
    const lastNl = buf.lastIndexOf(NL);
    const last = lastNl >= 0 && lastNl + 1 >= first ? lastNl + 1 : first;

    const entries: Entry[] = [];
    let lineStart = start + first;
    let cursor = first;
    while (cursor < last) {
      let nl = buf.indexOf(NL, cursor);
      if (nl < 0 || nl >= last) nl = last;
      const line = buf.subarray(cursor, nl);
      const entry = parseLine(line);
      if (entry) {
        if (hasImage(entry)) entry.lineOffset = lineStart;
        entries.push(entry);
      }
      lineStart += line.length + 1;
      cursor = nl + 1;
    }
    let startOffset = start + first;
    let nextOffset = start + last;
    if (last === first && buf.length > 0) {
      if (before !== null && start > 0) {
        const ls = await lineStartBefore(fh, before);
        const e = await readLongLine(fh, ls, before);
        if (e) entries.push(e);
        startOffset = ls;
      } else if (before === null && offset !== null && !reset) {
        const lineEnd = await findLineEnd(fh, start, size);
        if (lineEnd !== null) {
          const e = await readLongLine(fh, start, lineEnd);
          if (e) entries.push(e);
          nextOffset = lineEnd;
        }
      } else if (before === null && start > 0) {
        if (lastNl >= 0) {
          const lineEnd = start + lastNl + 1;
          const ls = await lineStartBefore(fh, lineEnd);
          const e = await readLongLine(fh, ls, lineEnd);
          if (e) entries.push(e);
          startOffset = ls;
          nextOffset = lineEnd;
        } else {
          const ls = await lineStartBefore(fh, start + 1);
          startOffset = ls;
          nextOffset = ls;
        }
      }
    }
    return {
      entries,
      startOffset,
      nextOffset: before !== null ? end : nextOffset,
      size,
      reset,
    };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- commands

export async function transcriptOpen(sessionId: string): Promise<number> {
  const file = await resolveSession(sessionId);
  return (await fs.stat(file)).size;
}

export async function transcriptRead(
  sessionId: string,
  offset: number | null,
  before: number | null,
): Promise<TranscriptPage> {
  return readPage(await resolveSession(sessionId), offset, before);
}

export async function transcriptFind(
  cwd: string,
  sinceMs: number,
  exclude: readonly string[] = [],
): Promise<string | null> {
  let best: SessionFile | null = null;
  for (const f of await sessionFiles(cwd)) {
    if (f.mtimeMs < sinceMs || exclude.includes(f.id)) continue;
    if (!best || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best?.id ?? null;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function transcriptImage(
  sessionId: string,
  offset: number,
  index: number,
): Promise<{ mediaType: string; data: string }> {
  const file = await resolveSession(sessionId);
  const fh = await fs.open(file, "r");
  let line: Buffer;
  try {
    const size = (await fh.stat()).size;
    if (offset >= size) throw new Error("image line is past the end of the transcript");
    const end = (await findLineEnd(fh, offset, size)) ?? size;
    if (end - offset > IMAGE_LINE_CAP) throw new Error("image line is too large");
    line = await readAt(fh, offset, end - offset);
  } finally {
    await fh.close();
  }
  let value: Json;
  try {
    value = JSON.parse(line.toString("utf8").trim()) as Json;
  } catch {
    throw new Error("not a transcript line");
  }
  const content = isObj(value) && isObj(value.message) ? value.message.content : null;
  const images = Array.isArray(content)
    ? content.filter((c): c is Obj => isObj(c) && c.type === "image")
    : [];
  const image = images[index];
  if (!image) throw new Error("no such image");
  const source = isObj(image.source) ? image.source : null;
  if (!source || source.type !== "base64") throw new Error("image is not embedded");
  const mediaType = str(source, "media_type") ?? "";
  if (!IMAGE_TYPES.has(mediaType)) throw new Error("unsupported image type");
  const data = str(source, "data");
  if (!data) throw new Error("image has no data");
  if (data.length > IMAGE_DATA_CAP) throw new Error("image is too large");
  if (!/^[A-Za-z0-9+/=]+$/u.test(data)) throw new Error("image data is not base64");
  return { mediaType, data };
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const EDIT_SCAN_CAP = 256 * MiB;

/**
 * Whether Claude edited `filePath` in session `sessionId`: an Edit / Write
 * tool call on exactly that path. Read from the transcript itself, so the
 * Reader can't vouch for a file Claude never touched.
 */
export async function editedInSession(sessionId: string, filePath: string): Promise<boolean> {
  const file = await resolveSession(sessionId).catch(() => null);
  if (!file) return false;
  const st = await fs.stat(file);
  if (st.size > EDIT_SCAN_CAP) return false;
  const text = await fs.readFile(file, "utf8");
  const needle = JSON.stringify(filePath);
  if (!text.includes(needle)) return false;
  for (const line of text.split("\n")) {
    if (!line.includes(needle) || !line.includes('"tool_use"')) continue;
    const value = parseJson(line);
    const content = isObj(value) && isObj(value.message) ? value.message.content : null;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!isObj(item) || item.type !== "tool_use" || typeof item.name !== "string") continue;
      if (!EDIT_TOOLS.has(item.name) || !isObj(item.input)) continue;
      if (item.input.file_path === filePath || item.input.notebook_path === filePath) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- caches

function cacheRoot(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "terax");
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "terax");
}

export function pastedImageDir(): string {
  return path.join(cacheRoot(), "pasted-images");
}

async function prepareCacheDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
  const now = Date.now();
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, name);
    const st = await fs.lstat(p).catch(() => null);
    if (st && now - st.mtimeMs > CACHE_TTL_MS) await fs.rm(p, { force: true }).catch(() => {});
  }
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function matchesMagic(type: string, b: Buffer): boolean {
  const starts = (sig: number[] | string, at = 0) => {
    const bytes = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
    return b.length >= at + bytes.length && b.subarray(at, at + bytes.length).equals(bytes);
  };
  switch (type) {
    case "image/png":
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return starts([0xff, 0xd8, 0xff]);
    case "image/gif":
      return starts("GIF87a") || starts("GIF89a");
    case "image/webp":
      return starts("RIFF") && starts("WEBP", 8);
    default:
      return false;
  }
}

export async function savePastedImage(type: string, bytes: Buffer): Promise<string> {
  const ext = IMAGE_EXT[type];
  if (!ext) throw new Error("unsupported image type");
  if (bytes.length === 0) throw new Error("the image is empty");
  if (bytes.length > PASTED_IMAGE_CAP) throw new Error("the image is too large (max 12 MB)");
  if (!matchesMagic(type, bytes)) throw new Error("the data is not a valid image of that type");
  const dir = pastedImageDir();
  await prepareCacheDir(dir);
  const out = path.join(dir, `${randomBytes(16).toString("hex")}.${ext}`);
  await fs.writeFile(out, bytes);
  return out;
}

const EXT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function savePastedImageFromPath(file: string): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error("the path must be absolute");
  const type = EXT_TYPE[path.extname(file).slice(1).toLowerCase()];
  if (!type) throw new Error("not a supported image file");
  const st = await fs.stat(file);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size === 0 || st.size > PASTED_IMAGE_CAP) {
    throw new Error("the image is empty or too large (max 12 MB)");
  }
  return savePastedImage(type, await fs.readFile(file));
}

export async function saveContext(text: string): Promise<string> {
  const size = Buffer.byteLength(text, "utf8");
  if (size === 0) throw new Error("nothing to attach");
  if (size > CONTEXT_CAP) throw new Error("the context is too large (max 256 KB)");
  const dir = path.join(cacheRoot(), "context");
  await prepareCacheDir(dir);
  const out = path.join(dir, `${randomBytes(16).toString("hex")}.md`);
  await fs.writeFile(out, text, { mode: 0o600, flag: fsc.O_CREAT | fsc.O_WRONLY | fsc.O_EXCL });
  return out;
}

// ---------------------------------------------------------------- history

function promptText(value: Json, max: number | null): string | null {
  if (!isObj(value) || value.type !== "user" || value.isMeta === true) return null;
  const content = isObj(value.message) ? value.message.content : undefined;
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter((c): c is Obj => isObj(c) && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join(" ");
  } else return null;
  text = text.trim();
  if (!text || text.startsWith("<") || text.startsWith("Caveat:")) return null;
  const collapsed = text.replace(/\s+/gu, " ");
  return max === null ? collapsed : [...collapsed].slice(0, max).join("");
}

function parseJson(line: Buffer | string): Json | null {
  try {
    return JSON.parse(typeof line === "string" ? line : line.toString("utf8")) as Json;
  } catch {
    return null;
  }
}

function splitLines(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let at = 0;
  while (at < buf.length) {
    let nl = buf.indexOf(NL, at);
    if (nl < 0) nl = buf.length;
    out.push(buf.subarray(at, nl));
    at = nl + 1;
  }
  return out;
}

const turnCache = new Map<string, { size: number; mtime: number; turns: number }>();

async function countTurns(f: SessionFile): Promise<number | null> {
  if (f.size > TURN_COUNT_MAX_BYTES) return null;
  const hit = turnCache.get(f.file);
  if (hit && hit.size === f.size && hit.mtime === f.mtimeMs) return hit.turns;
  const buf = await fs.readFile(f.file);
  let turns = 0;
  for (const line of splitLines(buf)) {
    if (line.indexOf('"type":"user"') < 0) continue;
    if (line.length > SUMMARY_LINE_MAX) {
      if (line.indexOf('"tool_result"') < 0 && line.indexOf('"isMeta":true') < 0) turns += 1;
      continue;
    }
    const v = parseJson(line);
    if (v && promptText(v, SUMMARY_PROMPT_CHARS) !== null) turns += 1;
  }
  turnCache.set(f.file, { size: f.size, mtime: f.mtimeMs, turns });
  return turns;
}

export type TranscriptSummary = {
  sessionId: string;
  modifiedMs: number;
  size: number;
  title: string | null;
  customTitle: string | null;
  firstPrompt: string | null;
  turns: number | null;
};

async function summarize(f: SessionFile): Promise<TranscriptSummary> {
  const fh = await fs.open(f.file, "r");
  let firstPrompt: string | null = null;
  let title: string | null = null;
  let customTitle: string | null = null;
  try {
    const head = await readAt(fh, 0, Math.min(SUMMARY_HEAD_BYTES, f.size));
    for (const line of splitLines(head)) {
      if (line.length > SUMMARY_LINE_MAX) continue;
      const v = parseJson(line);
      const p = v ? promptText(v, SUMMARY_PROMPT_CHARS) : null;
      if (p) {
        firstPrompt = p;
        break;
      }
    }
    const tailStart = Math.max(0, f.size - SUMMARY_TAIL_BYTES);
    const tail = await readAt(fh, tailStart, f.size - tailStart);
    const lines = splitLines(tail).reverse();
    const clip = (s: string) => [...s].slice(0, SUMMARY_PROMPT_CHARS).join("");
    for (const line of lines) {
      if (title !== null && customTitle !== null) break;
      if (line.length > SUMMARY_LINE_MAX) continue;
      const hasAi = line.indexOf('"ai-title"') >= 0;
      const hasCustom = line.indexOf('"custom-title"') >= 0;
      if (!hasAi && !hasCustom) continue;
      const v = parseJson(line);
      if (!isObj(v)) continue;
      if (title === null && v.type === "ai-title" && typeof v.aiTitle === "string") {
        title = clip(v.aiTitle);
      }
      if (customTitle === null && v.type === "custom-title" && typeof v.customTitle === "string") {
        customTitle = clip(v.customTitle);
      }
    }
  } finally {
    await fh.close();
  }
  return {
    sessionId: f.id,
    modifiedMs: f.mtimeMs,
    size: f.size,
    title,
    customTitle,
    firstPrompt,
    turns: await countTurns(f).catch(() => null),
  };
}

function newestFirst(files: SessionFile[]): SessionFile[] {
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
}

const clampLimit = (n: number | undefined, d: number) =>
  Math.min(LIST_MAX, Math.max(1, Math.floor(n ?? d)));

export async function transcriptList(
  cwd: string,
  limit?: number,
): Promise<TranscriptSummary[]> {
  const files = newestFirst(await sessionFiles(cwd)).slice(0, clampLimit(limit, 30));
  return Promise.all(files.map(summarize));
}

function snippet(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text.slice(0, SNIPPET_CONTEXT_CHARS * 2);
  const from = Math.max(0, at - SNIPPET_CONTEXT_CHARS);
  const to = Math.min(text.length, at + needle.length + SNIPPET_CONTEXT_CHARS);
  let s = text.slice(from, to);
  if (from > 0) s = `…${s.trimStart()}`;
  if (to < text.length) s = `${s.trimEnd()}…`;
  return s;
}

export async function transcriptSearch(
  cwd: string,
  query: string,
  limit?: number,
): Promise<{ sessionId: string; snippet: string }[]> {
  const needle = query.trim().toLowerCase();
  if ([...needle].length < 2) return [];
  const max = clampLimit(limit, 20);
  const out: { sessionId: string; snippet: string }[] = [];
  let budget = SEARCH_BYTES_MAX;
  const needleBytes = Buffer.from(needle, "utf8");
  for (const f of newestFirst(await sessionFiles(cwd)).slice(0, SEARCH_FILES_MAX)) {
    if (out.length >= max || f.size > budget) break;
    budget -= f.size;
    const buf = await fs.readFile(f.file);
    for (const line of splitLines(buf)) {
      if (line.length + 1 > SUMMARY_LINE_MAX) continue;
      if (line.indexOf('"type":"user"') < 0) continue;
      const lower = Buffer.from(line.toString("latin1").toLowerCase(), "latin1");
      if (lower.indexOf(needleBytes) < 0 && line.toString("utf8").toLowerCase().indexOf(needle) < 0) {
        continue;
      }
      const v = parseJson(line);
      const text = v ? promptText(v, null) : null;
      if (!text || !text.toLowerCase().includes(needle)) continue;
      out.push({ sessionId: f.id, snippet: snippet(text, needle) });
      break;
    }
  }
  return out;
}
