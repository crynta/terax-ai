import { native } from "@/modules/ai/lib/native";
import { useCallback, useEffect, useRef, useState } from "react";

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "copied";

export type GitStatusMap = Record<string, GitFileStatus>;

const POLL_INTERVAL = 3000;

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function parsePorcelain(output: string): GitStatusMap {
  const map: GitStatusMap = {};
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (!rest) continue;

    const x = xy[0];
    const y = xy[1];

    let status: GitFileStatus;
    if (x === "?" && y === "?") {
      status = "untracked";
    } else if (x === "A" || y === "A") {
      status = "added";
    } else if (x === "D" || y === "D") {
      status = "deleted";
    } else if (x === "R" || y === "R") {
      status = "renamed";
    } else if (x === "C" || y === "C") {
      status = "copied";
    } else {
      status = "modified";
    }

    if (status === "renamed" && rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      for (const p of parts) {
        if (p) map[normalizeSlashes(p)] = status;
      }
    } else {
      map[normalizeSlashes(rest)] = status;
    }
  }
  return map;
}

export function getGitStatus(
  statusMap: GitStatusMap,
  rootPath: string,
  absPath: string,
): GitFileStatus | undefined {
  if (!rootPath || !absPath) return undefined;
  const rootNorm = normalizeSlashes(rootPath);
  const absNorm = normalizeSlashes(absPath);
  if (absNorm === rootNorm) return undefined;
  const prefix = rootNorm.endsWith("/") ? rootNorm : rootNorm + "/";
  if (!absNorm.startsWith(prefix)) return undefined;
  const rel = absNorm.slice(prefix.length);
  return statusMap[rel];
}

export function useGitStatus(rootPath: string | null): GitStatusMap {
  const [statusMap, setStatusMap] = useState<GitStatusMap>({});
  const aliveRef = useRef(true);

  const poll = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await native.runCommand(
        "git status --porcelain -u --no-renames",
        rootPath,
        10,
      );
      if (!aliveRef.current) return;
      if (r.exit_code === 0 && r.stdout) {
        setStatusMap(parsePorcelain(r.stdout));
      } else {
        setStatusMap({});
      }
    } catch {
      if (aliveRef.current) setStatusMap({});
    }
  }, [rootPath]);

  useEffect(() => {
    aliveRef.current = true;
    setStatusMap({});
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  return statusMap;
}

export const GIT_STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: "#e2b340",
  added: "#3fb950",
  deleted: "#f85149",
  untracked: "#6e7681",
  renamed: "#58a6ff",
  copied: "#58a6ff",
};
