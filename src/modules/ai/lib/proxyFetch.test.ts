import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => {
  const channels: {
    onmessage: ((event: unknown) => void) | null;
  }[] = [];
  const invoke = vi.fn(() => Promise.resolve());
  class Channel {
    onmessage: ((event: unknown) => void) | null = null;
    constructor() {
      channels.push(this);
    }
  }
  return { channels, invoke, Channel };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: core.Channel,
  invoke: core.invoke,
}));

import { createProxyFetch, proxyFetch } from "./proxyFetch";

type FakeChannel = { onmessage: ((event: unknown) => void) | null };

async function startFetch(
  fn: typeof fetch,
  input: string,
  init?: RequestInit,
): Promise<{ pending: Promise<Response>; channel: FakeChannel }> {
  const pending = fn(input, init);
  await Promise.resolve();
  return {
    pending,
    channel: core.channels[core.channels.length - 1],
  };
}

function invokeArgs(): Record<string, unknown> {
  const calls = core.invoke.mock.calls as unknown as [string, Record<string, unknown>][];
  return calls[calls.length - 1][1];
}

describe("AI HTTP stream proxy", () => {
  beforeEach(() => {
    core.channels.length = 0;
    core.invoke.mockClear();
  });

  it("forwards url, method, headers, body bytes, and the private flag", async () => {
    const fetchImpl = createProxyFetch({ allowPrivateNetwork: true });
    const { channel } = await startFetch(
      fetchImpl,
      "http://127.0.0.1:1234/v1",
      {
        method: "post",
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
        signal: new AbortController().signal,
      },
    );
    channel.onmessage?.({ kind: "headers", status: 200, headers: {} });

    expect(invokeArgs()).toMatchObject({
      url: "http://127.0.0.1:1234/v1",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: [123, 34, 97, 34, 58, 49, 125],
      allowPrivateNetwork: true,
    });
  });

  it("defaults to GET without body and refuses private networks by default", async () => {
    const { channel, pending } = await startFetch(
      proxyFetch,
      "https://api.example.com/v1/models",
    );
    channel.onmessage?.({ kind: "headers", status: 200, headers: {} });
    await pending;

    expect(invokeArgs()).toMatchObject({
      method: "GET",
      body: undefined,
      allowPrivateNetwork: false,
    });
  });

  it("normalizes Headers and entry-array header inits", async () => {
    const first = await startFetch(proxyFetch, "https://api.example.com", {
      headers: new Headers({ authorization: "Bearer t" }),
    });
    first.channel.onmessage?.({ kind: "headers", status: 200, headers: {} });
    await first.pending;
    expect(invokeArgs().headers).toEqual({ authorization: "Bearer t" });

    const second = await startFetch(proxyFetch, "https://api.example.com", {
      headers: [["x-a", "1"]],
    });
    second.channel.onmessage?.({ kind: "headers", status: 200, headers: {} });
    await second.pending;
    expect(invokeArgs().headers).toEqual({ "x-a": "1" });
  });

  it("resolves a streaming response assembled from chunk events", async () => {
    const { channel, pending } = await startFetch(
      proxyFetch,
      "https://api.example.com/stream",
    );
    channel.onmessage?.({
      kind: "headers",
      status: 200,
      headers: { "x-test": "1" },
    });

    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("1");

    channel.onmessage?.({ kind: "chunk", bytes: [104, 105] });
    channel.onmessage?.({ kind: "chunk", bytes: [33] });
    channel.onmessage?.({ kind: "end" });

    await expect(response.text()).resolves.toBe("hi!");
  });

  it("rejects with the backend message when an error precedes headers", async () => {
    const { channel, pending } = await startFetch(
      proxyFetch,
      "https://api.example.com",
    );

    channel.onmessage?.({ kind: "error", message: "SSRF refused" });

    await expect(pending).rejects.toThrow("SSRF refused");
  });

  it("errors the open stream when an error follows headers", async () => {
    const { channel, pending } = await startFetch(
      proxyFetch,
      "https://api.example.com",
    );
    channel.onmessage?.({ kind: "headers", status: 200, headers: {} });
    const response = await pending;

    channel.onmessage?.({ kind: "error", message: "mid-stream boom" });

    await expect(response.text()).rejects.toThrow("mid-stream boom");
  });

  it("propagates an invoke rejection while nothing resolved yet", async () => {
    core.invoke.mockImplementationOnce(() =>
      Promise.reject(new Error("ipc down")),
    );

    const { pending } = await startFetch(proxyFetch, "https://api.example.com");

    await expect(pending).rejects.toThrow("ipc down");
  });

  it("throws immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      proxyFetch("https://api.example.com", { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);

    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("aborts mid-stream so further events are ignored", async () => {
    const controller = new AbortController();
    const { channel, pending } = await startFetch(
      proxyFetch,
      "https://api.example.com",
      { signal: controller.signal },
    );
    channel.onmessage?.({ kind: "headers", status: 200, headers: {} });
    const response = await pending;

    controller.abort();
    channel.onmessage?.({ kind: "chunk", bytes: [120] });

    await expect(response.text()).rejects.toThrow(/abort/i);
  });
});
