import { invoke } from "@tauri-apps/api/core";
import {
  buildDiscoveryHeaders,
  buildModelsUrl,
  decodeModelDiscoveryResponse,
  type ModelDiscoveryResult,
} from "./modelDiscovery";

export const MODEL_DISCOVERY_TIMEOUT_MS = 8000;
export const MODEL_DISCOVERY_MAX_BODY_BYTES = 1_048_576;

export type ModelDiscoveryRequestArgs = {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  allowPrivateNetwork: true;
  timeoutMs: number;
  maxBodyBytes: number;
};

export type ModelDiscoveryHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

export type ModelDiscoveryRequest = (
  args: ModelDiscoveryRequestArgs,
) => Promise<ModelDiscoveryHttpResponse>;

export type DiscoverModelsInput = {
  baseURL: string;
  apiKey?: string | null;
};

export const tauriModelDiscoveryRequest: ModelDiscoveryRequest = (args) =>
  invoke<ModelDiscoveryHttpResponse>("ai_http_request", args);

export async function discoverModels(
  input: DiscoverModelsInput,
  request: ModelDiscoveryRequest = tauriModelDiscoveryRequest,
): Promise<ModelDiscoveryResult> {
  let url: string;
  try {
    url = buildModelsUrl(input.baseURL);
  } catch {
    return {
      ok: false,
      error: {
        kind: "missing-base-url",
        message: "Enter a Base URL first.",
      },
    };
  }

  try {
    const response = await request({
      url,
      method: "GET",
      headers: buildDiscoveryHeaders(input.apiKey),
      allowPrivateNetwork: true,
      timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS,
      maxBodyBytes: MODEL_DISCOVERY_MAX_BODY_BYTES,
    });
    return decodeModelDiscoveryResponse(response);
  } catch {
    return {
      ok: false,
      error: {
        kind: "network-error",
        message: "Could not reach the model endpoint.",
      },
    };
  }
}
