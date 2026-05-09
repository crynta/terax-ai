import { invoke, Channel } from "@tauri-apps/api/core";

export type PtyEvent =
  | { type: "data"; data: string }
  | { type: "cwd"; cwd: string }
  | { type: "exit"; code: number };

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onCwd?: (cwd: string) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
): Promise<PtySession> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = (event) => {
    switch (event.type) {
      case "data":
        handlers.onData(decodeBase64(event.data));
        break;
      case "cwd":
        handlers.onCwd?.(event.cwd);
        break;
      case "exit":
        handlers.onExit?.(event.code);
        break;
    }
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    onEvent: channel,
  });

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    close: () => invoke("pty_close", { id }),
  };
}
