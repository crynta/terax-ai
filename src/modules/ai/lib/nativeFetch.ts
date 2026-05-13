import { invoke } from "@tauri-apps/api/core";

export async function nativeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  const body = init?.body ? [...new TextEncoder().encode(init.body as string)] : undefined;

  const headers: Record<string, string> = {};
  if (init?.headers) {
    const h = init.headers as Record<string, string>;
    for (const key of Object.keys(h)) {
      headers[key] = h[key];
    }
  }

  const result = await invoke<{
    status: number;
    headers: Record<string, string>;
    body: number[];
  }>("ai_http_request", {
    url,
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body,
  });

  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers: result.headers,
  });
}
