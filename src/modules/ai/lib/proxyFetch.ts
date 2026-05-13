import { Channel, invoke } from "@tauri-apps/api/core";

/** Streaming events emitted by the Rust `ai_http_stream` command. */
type AiStreamEvent =
  | { kind: "headers"; status: number; headers: Record<string, string> }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "end" }
  | { kind: "error"; message: string };

type RequestHeaders = Record<string, string>;

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
  if (body instanceof Blob) return Array.from(new Uint8Array(await body.arrayBuffer()));
  // FormData / URLSearchParams / ReadableStream — uncommon for AI SDK calls.
  const text = await new Response(body as BodyInit).text();
  return Array.from(new TextEncoder().encode(text));
}

/** Fetch API replacement that routes through Tauri so requests bypass the
 *  webview's CORS / Mixed-Content / Private-Network-Access restrictions.
 *  Intended for local model servers (LM Studio, Ollama, vLLM, …). */
export const proxyFetch: typeof fetch = async (input, init) => {
  const url = input instanceof URL ? input.toString() : String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = headerInitToRecord(init?.headers);
  const body = await bodyToBytes(init?.body);

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

    const channel = new Channel<AiStreamEvent>();
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

    invoke("ai_http_stream", {
      url,
      method,
      headers,
      body,
      onEvent: channel,
    }).catch((e) => {
      if (resolved) return; // headers already arrived; chunk-side error wins
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
};

function makeAbortError(): DOMException {
  return new DOMException("Request aborted", "AbortError");
}
