import { native, type FileStat } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";

export type SpaceRootFs = {
  canonicalize: (path: string, env: WorkspaceEnv) => Promise<string>;
  stat: (path: string, env: WorkspaceEnv) => Promise<FileStat>;
  authorize: (path: string, env: WorkspaceEnv) => Promise<unknown>;
};

const nativeRootFs: SpaceRootFs = {
  canonicalize: native.canonicalize,
  stat: native.stat,
  authorize: native.workspaceAuthorize,
};

export async function validateSpaceRoot(
  path: string,
  env: WorkspaceEnv,
  fs: SpaceRootFs = nativeRootFs,
): Promise<string> {
  const canonical = await fs.canonicalize(path, env);
  const stat = await fs.stat(canonical, env);
  if (stat.kind !== "dir") throw new Error("Space root must be a directory.");
  await fs.authorize(canonical, env);
  return canonical;
}
