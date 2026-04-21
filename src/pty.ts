import { invoke, Channel } from "@tauri-apps/api/core";

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function openPty(
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
): Promise<PtySession> {
  const channel = new Channel<string>();
  channel.onmessage = (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    onData(arr);
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    onData: channel,
  });

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    close: () => invoke("pty_close", { id }),
  };
}
