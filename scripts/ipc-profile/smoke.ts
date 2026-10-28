import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import {
  saveMessages,
  loadMessages,
  deleteSessionData,
  flushSessionWrites,
} from "@/modules/ai/lib/sessions";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
const original = fetch;
const nativeFetch = createProxyFetch({ allowPrivateNetwork: true });
declare const __TERAX_IPC_BASE_URL__: string;
declare const __TERAX_IPC_TREE__: string;
const base = __TERAX_IPC_BASE_URL__;
const tree = __TERAX_IPC_TREE__;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

async function checkMainThread(output: Record<string, unknown>) {
  const heavy = Promise.all([
    invoke("fs_grep", { pattern: "zzzz-no-match-\\d+", root: tree, maxResults: 10 }),
    invoke("fs_list_files", { root: tree, limit: 10000 }),
    invoke("fs_search", { root: tree, query: "f099", limit: 50 }),
  ]);
  let pending = true;
  void heavy.finally(() => {
    pending = false;
  });
  const latencies: number[] = [];
  while (pending) {
    const started = performance.now();
    await invoke("lsp_host_pid");
    latencies.push(performance.now() - started);
    await sleep(2);
  }
  await heavy;
  const worst = Math.max(...latencies);
  output.mainThreadWorstMs = Math.round(worst);
  output.mainThreadSamples = latencies.length;
  output.mainThreadResponsive = latencies.length >= 3 && worst < 250;
}

async function checkSearch(output: Record<string, unknown>) {
  const cold = performance.now();
  await invoke("fs_search", { root: tree, query: "d05", limit: 20, requestKey: "smoke" });
  const coldMs = performance.now() - cold;
  const warm = performance.now();
  const hit = await invoke<{ hits: unknown[] }>("fs_search", {
    root: tree,
    query: "f050",
    limit: 20,
    requestKey: "smoke",
  });
  const warmMs = performance.now() - warm;
  output.searchColdMs = Math.round(coldMs);
  output.searchWarmMs = Math.round(warmMs);
  output.searchCached = hit.hits.length > 0 && warmMs < Math.max(40, coldMs);
  await invoke("fs_create_file", { path: `${tree}/d05/brand-new-needle.txt` });
  const after = await invoke<{ hits: { rel: string }[] }>("fs_search", {
    root: tree,
    query: "brand-new-needle",
    limit: 5,
  });
  output.searchSeesNewFile = after.hits.some((h) => h.rel.endsWith("brand-new-needle.txt"));

  const first = invoke<{ cancelled: boolean }>("fs_grep_interactive", {
    pattern: "zzzz-never-matches",
    root: tree,
    maxResults: 50,
  });
  await sleep(10);
  const second = invoke<{ cancelled: boolean }>("fs_grep_interactive", {
    pattern: "zzzz-never-matches-either",
    root: tree,
    maxResults: 50,
  });
  const [a, b] = await Promise.all([first, second]);
  output.grepSuperseded = a.cancelled === true && b.cancelled === false;
}

async function checkWatch(output: Record<string, unknown>) {
  const dir = `${tree}/watched`;
  const quiet = `${tree}/quiet/sub`;
  await invoke("workspace_authorize", { path: tree });
  await invoke("fs_create_dir", { path: dir });
  await invoke("fs_create_dir", { path: quiet });
  const file = `${dir}/open.txt`;
  await invoke("fs_write_file", { path: file, content: "one" });
  const canonicalDir = await invoke<string>("fs_canonicalize", { path: dir });
  const canonicalFile = await invoke<string>("fs_canonicalize", { path: file });
  const seen: string[][] = [];
  const unlisten = await getCurrentWebviewWindow().listen<{ paths: string[] }>(
    "fs:changed",
    (e) => seen.push(e.payload.paths),
  );
  await invoke("fs_watch_add", { paths: [dir], files: [file] });
  await sleep(400);
  seen.length = 0;

  await invoke("fs_write_file", { path: `${dir}/other.txt`, content: "x" });
  await sleep(900);
  output.watchDirectory = seen.some((paths) => paths.includes(canonicalDir));
  output.watchFileNotSpurious = !seen.some((paths) => paths.includes(canonicalFile));
  seen.length = 0;

  await invoke("fs_write_file", { path: file, content: "two, much longer" });
  await sleep(900);
  output.watchFile =
    seen.some((paths) => paths.includes(canonicalFile)) &&
    output.watchFileNotSpurious === true;
  seen.length = 0;

  await invoke("fs_write_file", { path: `${quiet}/unwatched.txt`, content: "x" });
  await sleep(700);
  output.watchQuietOutside = seen.length === 0;
  await invoke("fs_watch_remove", { paths: [dir], files: [file] });
  unlisten();
}

async function checkBackdrop(output: Record<string, unknown>) {
  // Drives the real NSWindow/WKWebView opacity path (and a bad colour).
  try {
    await invoke("window_set_backdrop", { enabled: true, dark: true });
    await invoke("window_set_backdrop", {
      enabled: false,
      dark: true,
      background: "#282a36",
    });
    await invoke("window_set_backdrop", {
      enabled: false,
      dark: false,
      background: "not a colour",
    });
    output.backdropToggle = true;
  } catch (error) {
    output.backdropToggle = String(error);
  }
}

async function run() {
  const output: Record<string, unknown> = {};
  const payload = "raw body λ 日本語\n".repeat(10000);
  const response = await nativeFetch(base + "/echo", {
    method: "POST",
    body: payload,
  });
  output.rawBody = (await response.text()) === payload;
  const bulk = await nativeFetch(base + "/bulk");
  await sleep(300);
  const content = await bulk.text();
  output.boundedConsumer =
    content.length === 1024 * 1024 &&
    content.startsWith("ABCD") &&
    content.endsWith("ABCD");
  const sse = await (await nativeFetch(base + "/sse")).text();
  output.smallChunks =
    sse === Array.from({ length: 400 }, (_, i) => `data: ${i}\n\n`).join("");
  const controller = new AbortController();
  const slow = await nativeFetch(base + "/slow", { signal: controller.signal });
  if (!slow.body) throw new Error("Missing streaming response");
  const reader = slow.body.getReader();
  await reader.read();
  controller.abort();
  try {
    await reader.read();
    output.abort = false;
  } catch (e) {
    output.abort = e instanceof DOMException && e.name === "AbortError";
  }
  await saveMessages("ipc-smoke", [
    {
      id: "one",
      role: "user",
      parts: [{ type: "text", text: "isolated storage check" }],
    },
  ]);
  output.stored = (await loadMessages("ipc-smoke"))?.[0]?.id === "one";
  const big = [
    {
      id: "big",
      role: "assistant",
      parts: [{ type: "text", text: "λ日本語 ".repeat(400_000) }],
    },
  ] as Parameters<typeof saveMessages>[1];
  await saveMessages("ipc-big", big, { durable: true });
  const back = await loadMessages("ipc-big");
  output.bigSession =
    (back?.[0].parts[0] as { text: string }).text.length === 2_000_000;
  await deleteSessionData("ipc-big");
  await deleteSessionData("ipc-smoke");
  const flush = await flushSessionWrites();
  output.deleted = (await loadMessages("ipc-smoke")) === null && flush.ok;
  await checkMainThread(output);
  await checkSearch(output);
  await checkWatch(output);
  await checkBackdrop(output);
  document.querySelector("#result")!.textContent = JSON.stringify(
    output,
    null,
    2,
  );
  await sleep(200);
  await original(base + "/report", {
    method: "POST",
    body: JSON.stringify(output as Json),
  });
  await getCurrentWindow().close();
}
run().catch(async (error) => {
  document.querySelector("#result")!.textContent = String(error);
  await original(base + "/report", {
    method: "POST",
    body: JSON.stringify({ error: String(error), stack: error.stack }),
  });
});
