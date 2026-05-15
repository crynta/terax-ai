import { getProvider, type ProviderId } from "../config";

export type RemoteModel = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

export type FetchModelsResult = {
  models: RemoteModel[];
  error?: string;
};

function getString(obj: unknown, key: string): string | undefined {
  const val = (obj as Record<string, unknown>)?.[key];
  return typeof val === "string" ? val : undefined;
}

function getNumber(obj: unknown, key: string): number | undefined {
  const val = (obj as Record<string, unknown>)?.[key];
  return typeof val === "number" ? val : undefined;
}

export async function fetchProviderModels(
  provider: ProviderId,
  apiKey?: string | null,
): Promise<FetchModelsResult> {
  const info = getProvider(provider);
  const url = info.modelsUrl;

  if (!url) {
    return {
      models: [],
      error: `${info.label} does not expose a /models endpoint.`,
    };
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: `${info.label} /models returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const json: unknown = await res.json();

    const data: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as Record<string, unknown>)?.data)
        ? ((json as Record<string, unknown>).data as unknown[])
        : [];

    const models: RemoteModel[] = data
      .map((item): RemoteModel | null => {
        if (typeof item !== "object" || item === null) return null;
        const id = getString(item, "id");
        if (typeof id !== "string") return null;
        return {
          id,
          object: getString(item, "object") ?? "model",
          created: getNumber(item, "created") ?? 0,
          owned_by: getString(item, "owned_by") ?? "",
        };
      })
      .filter((m): m is RemoteModel => m !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    return { models };
  } catch (err) {
    return {
      models: [],
      error: `Failed to fetch models from ${info.label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
