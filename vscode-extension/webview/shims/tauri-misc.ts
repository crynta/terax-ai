/**
 * Stand-ins for the small Tauri APIs the Reader touches: paths, events, log,
 * opener and the key-value store.
 */
import { hostReady, hostState, rpc } from "../bridge";

// ---- @tauri-apps/api/path
export async function homeDir(): Promise<string> {
  await hostReady;
  return hostState.env?.home ?? "";
}

export async function downloadDir(): Promise<string> {
  await hostReady;
  return hostState.env?.downloads ?? "";
}

export async function join(...parts: string[]): Promise<string> {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/gu, "/");
}

// ---- @tauri-apps/api/event
export type UnlistenFn = () => void;

/** No native events reach the webview; listeners simply never fire. */
export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(): Promise<void> {}

// ---- @tauri-apps/plugin-log
export async function info(message: string): Promise<void> {
  console.info(message);
}
export async function warn(message: string): Promise<void> {
  console.warn(message);
}
export async function error(message: string): Promise<void> {
  console.error(message);
}
export async function debug(message: string): Promise<void> {
  console.debug(message);
}
export async function trace(message: string): Promise<void> {
  console.debug(message);
}

// ---- @tauri-apps/plugin-opener
export async function openUrl(url: string): Promise<void> {
  await rpc("host_open_url", { url });
}

export async function openPath(path: string): Promise<void> {
  await rpc("host_open_file", { path });
}

export async function revealItemInDir(path: string): Promise<void> {
  await rpc("host_reveal", { path });
}

// ---- @tauri-apps/plugin-store
export class LazyStore {
  constructor(
    private readonly file: string,
    _options?: unknown,
  ) {}

  private key(k: string): string {
    return `${this.file}:${k}`;
  }

  async get<T>(k: string): Promise<T | undefined> {
    const v = await rpc<T | null>("host_store_get", { key: this.key(k) });
    return v ?? undefined;
  }

  async set(k: string, value: unknown): Promise<void> {
    await rpc("host_store_set", { key: this.key(k), value });
  }

  async save(): Promise<void> {}
}
