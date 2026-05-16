import { LazyStore } from "@tauri-apps/plugin-store";
import type { SshConnection } from "./env";

const STORE_PATH = "terax-ssh-hosts.json";
const KEY = "savedHosts";

const store = new LazyStore(STORE_PATH, { autoSave: 200 });

export async function loadSshHosts(): Promise<SshConnection[]> {
  return (await store.get<SshConnection[]>(KEY)) ?? [];
}

export async function saveSshHost(host: SshConnection): Promise<void> {
  const list = await loadSshHosts();
  const idx = list.findIndex((h) => h.host === host.host && h.user === host.user);
  if (idx >= 0) {
    list[idx] = host;
  } else {
    list.push(host);
  }
  await store.set(KEY, list);
  await store.save();
}

export async function removeSshHost(host: string, user?: string): Promise<void> {
  const list = await loadSshHosts();
  const filtered = list.filter((h) => !(h.host === host && h.user === user));
  await store.set(KEY, filtered);
  await store.save();
}
