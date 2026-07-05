import { invoke, Channel } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

const textEncoder = new TextEncoder();

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
): Promise<PtySession> {
  // Raw bytes — no base64/JSON round-trip; messages arrive as ArrayBuffer.
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    workspace: currentWorkspaceEnv(),
    blocks: blocks ?? false,
    shell: shell ?? null,
    onData,
    onExit,
  });

  let closed = false;
  const headers = { "x-pty-id": String(id) };

  return {
    id,
    // Raw bytes + id header: no JSON round-trip on the per-keystroke path.
    write: (data) => invoke("pty_write", textEncoder.encode(data), { headers }),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}
