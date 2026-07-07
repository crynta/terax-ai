import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { areOpenClickyAiToolsEnabled } from "@/modules/ai/lib/featureGates";

export type Model3DResult = {
  modelUrl: string;
  thumbnailUrl: string;
};

export function use3DGeneration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Model3DResult | null>(null);

  const generate = useCallback(
    async (prompt: string): Promise<Model3DResult | null> => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        if (!areOpenClickyAiToolsEnabled()) {
          throw new Error(
            "3D generation is experimental and disabled for this build.",
          );
        }
        const res = await invoke<Model3DResult>("generate_3d_model", {
          prompt,
        });
        setResult(res);
        return res;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { generate, loading, error, result };
}
