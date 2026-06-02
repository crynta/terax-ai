import { Channel, invoke } from "@tauri-apps/api/core";

type CodexStreamEvent =
  | { kind: "headers"; status: number; headers: Record<string, string> }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "end" }
  | { kind: "error"; message: string };

type RequestHeaders = Record<string, string>;

const FRONTEND_STRIPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "content-length",
]);

function headerInitToRecord(
  init: HeadersInit | undefined,
): RequestHeaders | undefined {
  if (!init) return undefined;
  const out: RequestHeaders = {};
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(init)) out[k] = String(v);
  }
  return out;
}

function stripSensitiveHeaders(
  headers: RequestHeaders | undefined,
): RequestHeaders | undefined {
  if (!headers) return undefined;
  const out: RequestHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (FRONTEND_STRIPPED_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

async function bodyToBytes(
  body: BodyInit | null | undefined,
): Promise<number[] | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") {
    return Array.from(new TextEncoder().encode(body));
  }
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return Array.from(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  if (body instanceof Blob)
    return Array.from(new Uint8Array(await body.arrayBuffer()));
  const text = await new Response(body as BodyInit).text();
  return Array.from(new TextEncoder().encode(text));
}

export async function prepareCodexProxyRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const url = input instanceof URL ? input.toString() : String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = stripSensitiveHeaders(headerInitToRecord(init?.headers));
  const body = await bodyToBytes(init?.body);
  return { url, method, headers, body };
}

export function createCodexProxyFetch(): typeof fetch {
  return async (input, init) => {
    const { url, method, headers, body } = await prepareCodexProxyRequest(
      input,
      init,
    );
    const signal = init?.signal;
    if (signal?.aborted) {
      throw makeAbortError();
    }

    return new Promise<Response>((resolve, reject) => {
      let resolved = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;
      let cancelled = false;

      const onAbort = () => {
        cancelled = true;
        if (!resolved) {
          reject(makeAbortError());
        } else if (streamController) {
          try {
            streamController.error(makeAbortError());
          } catch {
            /* already closed */
          }
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const channel = new Channel<CodexStreamEvent>();
      channel.onmessage = (event) => {
        if (cancelled) return;
        switch (event.kind) {
          case "headers": {
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
              },
              cancel() {
                cancelled = true;
              },
            });
            resolved = true;
            resolve(
              new Response(stream, {
                status: event.status,
                headers: new Headers(event.headers),
              }),
            );
            break;
          }
          case "chunk": {
            streamController?.enqueue(Uint8Array.from(event.bytes));
            break;
          }
          case "end": {
            streamController?.close();
            break;
          }
          case "error": {
            if (!resolved) {
              reject(new Error(event.message));
            } else {
              streamController?.error(new Error(event.message));
            }
            break;
          }
        }
      };

      invoke("openai_codex_responses_stream", {
        url,
        method,
        headers,
        body,
        onEvent: channel,
      }).catch((error) => {
        if (resolved) return;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  };
}

function makeAbortError(): DOMException {
  return new DOMException("Request aborted", "AbortError");
}
