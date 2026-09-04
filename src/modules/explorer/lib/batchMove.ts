export type BatchMoveItem = {
  from: string;
  to: string;
  name: string;
};

export type FsMoveResult =
  | { status: "conflict"; replaceable: boolean; token: string }
  | { status: "moved" };

export type BatchMoveOutcome = {
  moved: number;
  blocked: number;
  failures: number;
};

type BatchMoveDeps = {
  move: (
    item: BatchMoveItem,
    expectedConflict: string | null,
  ) => Promise<FsMoveResult>;
  resolveConflict: (item: BatchMoveItem) => Promise<"replace" | "skip">;
  canReplace: (item: BatchMoveItem) => boolean;
  onMoved: (item: BatchMoveItem) => void;
  isCurrent: () => boolean;
};

function joinPath(parent: string, name: string): string {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function excludeNestedSources(sources: string[]): string[] {
  const normalized = sources.map(normalizePath);
  return normalized.filter(
    (path) =>
      !normalized.some(
        (other) => other !== path && path.startsWith(`${other}/`),
      ),
  );
}

export async function executeBatchMove(
  sources: string[],
  toDir: string,
  deps: BatchMoveDeps,
): Promise<BatchMoveOutcome> {
  const targetDir = normalizePath(toDir);
  const outcome: BatchMoveOutcome = {
    moved: 0,
    blocked: 0,
    failures: 0,
  };

  for (const from of excludeNestedSources(sources)) {
    const name = from.slice(from.lastIndexOf("/") + 1);
    const item = { from, to: joinPath(targetDir, name), name };
    if (item.to === from) continue;
    if (!deps.isCurrent()) {
      break;
    }

    try {
      let result = await deps.move(item, null);

      if (result.status === "conflict") {
        if (!result.replaceable) {
          outcome.failures += 1;
          continue;
        }
        if (!deps.isCurrent()) {
          break;
        }
        const resolution = await deps.resolveConflict(item);
        if (!deps.isCurrent()) {
          break;
        }
        if (resolution === "skip") continue;
        if (!deps.canReplace(item)) {
          outcome.blocked += 1;
          continue;
        }
        result = await deps.move(item, result.token);
      }

      if (result.status === "conflict") {
        outcome.failures += 1;
      } else {
        outcome.moved += 1;
        deps.onMoved(item);
      }
    } catch (error) {
      outcome.failures += 1;
      console.error(`fs_move (${item.from} -> ${item.to}) failed:`, error);
    }

    if (!deps.isCurrent()) {
      break;
    }
  }

  return outcome;
}
