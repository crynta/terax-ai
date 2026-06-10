/**
 * Pi SDK Webview Bridge — HTTP proxy with SSE streaming
 *
 * The webview can't call LLM APIs directly due to CORS.
 * Routes HTTP requests through Tauri, using the streaming ai_http_stream
 * command for SSE responses (LLM APIs) and ai_http_request for everything else.
 *
 * This replaces the Node.js sidecar's fetch calls.
 */
import { Channel, invoke } from "@tauri-apps/api/core";

// ─── Types ───

type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

type AiStreamEvent =
  | { kind: "headers"; status: number; headers: Record<string, string> }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "end" }
  | { kind: "error"; message: string };

// ─── Ref-counted global fetch proxy ───

let proxyDepth = 0;
let originalFetch: typeof fetch | null = null;

/**
 * Install the Tauri-proxied fetch as the global fetch.
 * Uses reference counting so nested/concurrent streams don't clobber each other.
 */
export function installProxiedFetch(): void {
  if (proxyDepth === 0) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = tauriProxiedFetch;
  }
  proxyDepth++;
}

/**
 * Uninstall the proxied fetch when the last consumer is done.
 * Safe to call multiple times — only restores when depth hits 0.
 */
export function uninstallProxiedFetch(): void {
  proxyDepth = Math.max(0, proxyDepth - 1);
  if (proxyDepth === 0 && originalFetch !== null) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}

// ─── Header extraction ───

function extractHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key] = value;
    }
  } else {
    Object.assign(result, headers);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ─── Body serialization ───

/**
 * Whether the proxy can faithfully serialize this request body. Bodies it
 * can't represent (FormData, ReadableStream) must pass through to the real
 * fetch so unrelated concurrent requests aren't silently corrupted while the
 * global fetch is swapped for a Pi stream.
 */
export function isProxyableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true;
  if (typeof body === "string") return true;
  if (body instanceof Uint8Array) return true;
  if (body instanceof ArrayBuffer) return true;
  if (body instanceof Blob) return true;
  if (body instanceof URLSearchParams) return true;
  return false;
}

async function serializeBody(
  body: BodyInit | null | undefined,
): Promise<number[] | undefined> {
  if (!body) return undefined;
  if (body instanceof Uint8Array) return Array.from(body);
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }
  if (typeof body === "string")
    return Array.from(new TextEncoder().encode(body));
  if (body instanceof URLSearchParams)
    return Array.from(new TextEncoder().encode(body.toString()));
  if (body instanceof FormData) {
    console.warn(
      "FormData body not fully supported in proxy — sending as text",
    );
    return undefined;
  }
  console.warn("Unsupported body type in HTTP proxy:", typeof body);
  return undefined;
}

// ─── Proxied fetch ───

/**
 * The actual proxied fetch implementation.
 *
 * For POST requests to LLM APIs (which use SSE streaming), uses ai_http_stream
 * to get real-time chunk delivery via Tauri Channel.
 *
 * For all other requests, falls back to ai_http_request (full response at once).
 */
function tauriProxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  // Skip proxying for non-http URLs (data:, blob:, etc.)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    const fetch = originalFetch ?? globalThis.fetch;
    return fetch(input, init);
  }

  const method = init?.method ?? "GET";
  const headers = extractHeaders(init?.headers);
  const body = init?.body as BodyInit | null | undefined;
  const signal = init?.signal;

  // Pass through requests whose body the proxy can't represent (FormData,
  // streams). The global fetch is swapped for the duration of a Pi stream, so a
  // concurrent unrelated request (e.g. Whisper's multipart upload) must not be
  // mangled by routing it through the proxy.
  if (!isProxyableBody(body)) {
    const passthrough = originalFetch ?? globalThis.fetch;
    return passthrough(input, init);
  }

  // If already aborted, skip the request entirely
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  }

  // Use streaming for POST requests to LLM APIs (SSE responses)
  const isStreamingPost = method.toUpperCase() === "POST";
  if (isStreamingPost) {
    return piFetchStreamed(url, { method, headers, body, signal });
  }

  return piFetchRaw(url, { method, headers, body, signal });
}

// ─── Streaming fetch via ai_http_stream ───

/**
 * Streaming fetch through Tauri's ai_http_stream command.
 *
 * Uses Tauri Channel to receive SSE chunks in real-time,
 * then reconstructs a proper Response with a ReadableStream.
 * Supports AbortSignal — closing the ReadableStream and dropping
 * the Channel when the agent aborts.
 */
async function piFetchStreamed(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  } = {},
): Promise<Response> {
  const bodyBytes = await serializeBody(options.body);
  const signal = options.signal;

  // Set up a ReadableStream that receives chunks from the Tauri Channel
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  // Tauri Channel receives streaming events from Rust
  const onEvent = new Channel<AiStreamEvent>();

  let resolveHeaders!: (value: {
    status: number;
    headers: Record<string, string>;
  }) => void;
  let rejectHeaders!: (reason: unknown) => void;
  const headersPromise = new Promise<{
    status: number;
    headers: Record<string, string>;
  }>((resolve, reject) => {
    resolveHeaders = resolve;
    rejectHeaders = reject;
  });

  let streamError: string | undefined;
  let headersReceived = false;

  onEvent.onmessage = (event: AiStreamEvent) => {
    switch (event.kind) {
      case "headers":
        headersReceived = true;
        resolveHeaders({ status: event.status, headers: event.headers });
        break;
      case "chunk":
        try {
          controller!.enqueue(new Uint8Array(event.bytes));
        } catch {
          // Stream already closed (abort)
        }
        break;
      case "end":
        try {
          controller!.close();
        } catch {
          // Already closed
        }
        break;
      case "error":
        streamError = event.message;
        if (!headersReceived) {
          rejectHeaders(new Error(event.message));
        }
        try {
          controller!.error(new Error(event.message));
        } catch {
          // Already closed
        }
        break;
    }
  };

  // Forward abort signal — close the stream when the agent aborts.
  // This causes the Pi SDK's SSE parser to stop, which propagates
  // up through the agent loop.
  const onAbort = () => {
    streamError = "Aborted";
    try {
      controller!.error(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    } catch {
      // Already closed
    }
    if (!headersReceived) {
      rejectHeaders(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  // Fire the streaming request (don't await — we process events as they arrive)
  invoke("ai_http_stream", {
    url,
    method: options.method ?? "POST",
    headers: options.headers ?? null,
    body: bodyBytes ?? null,
    allowPrivateNetwork: true,
    maxBodyBytes: 16 * 1024 * 1024,
    onEvent,
  })
    .catch((err) => {
      if (streamError === undefined) {
        streamError = String(err);
        if (!headersReceived) {
          rejectHeaders(new Error(streamError));
        }
        try {
          controller!.error(new Error(streamError));
        } catch {
          // Already closed
        }
      }
    })
    .finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });

  // Wait for headers to arrive before constructing the Response
  const { status, headers } = await headersPromise;

  return new Response(readable, {
    status,
    headers: new Headers(headers),
  });
}

// ─── Non-streaming fetch ───

/**
 * Full-response fetch through Tauri IPC.
 * Used for non-streaming requests (GET, PUT, DELETE, etc.)
 * Supports AbortSignal.
 */
async function piFetchRaw(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  } = {},
): Promise<Response> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  }

  const bodyBytes = await serializeBody(options.body);

  const result = await invoke<HttpResponse>("ai_http_request", {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? null,
    body: bodyBytes ?? null,
    allowPrivateNetwork: true,
    timeoutMs: 300_000,
  });

  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers: new Headers(result.headers),
  });
}

// ─── Public API ───

/**
 * Public streaming fetch — use for LLM API calls.
 */
export async function piFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
  } = {},
): Promise<Response> {
  return piFetchStreamed(url, options);
}
