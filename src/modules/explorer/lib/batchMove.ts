export type BatchMoveItem = {
  from: string;
  to: string;
  name: string;
};

export type ExplorerPathRename = {
  from: string;
  to: string;
  replaced: boolean;
};

export type FsMoveResult =
  | { status: "conflict"; replaceable: boolean }
  | { status: "moved" };

export type BatchMoveOutcome = {
  renamed: ExplorerPathRename[];
  blocked: BatchMoveItem[];
  unreplaceable: BatchMoveItem[];
  failures: Array<{ item: BatchMoveItem; error: unknown }>;
  cancelled: boolean;
};

type BatchMoveDeps = {
  move: (item: BatchMoveItem, replace: boolean) => Promise<FsMoveResult>;
  resolveConflict: (item: BatchMoveItem) => Promise<"replace" | "skip">;
  canReplace: (
    item: BatchMoveItem,
    completed: readonly ExplorerPathRename[],
  ) => boolean;
  isCurrent: () => boolean;
};

function joinPath(parent: string, name: string): string {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

export function excludeNestedSources(sources: string[]): string[] {
  return sources.filter(
    (path) =>
      !sources.some((other) => other !== path && path.startsWith(`${other}/`)),
  );
}

export function planBatchMove(
  sources: string[],
  toDir: string,
): BatchMoveItem[] {
  return excludeNestedSources(sources).flatMap((from) => {
    const name = from.slice(from.lastIndexOf("/") + 1);
    const to = joinPath(toDir, name);
    return to === from ? [] : [{ from, to, name }];
  });
}

export async function executeBatchMove(
  sources: string[],
  toDir: string,
  deps: BatchMoveDeps,
): Promise<BatchMoveOutcome> {
  const outcome: BatchMoveOutcome = {
    renamed: [],
    blocked: [],
    unreplaceable: [],
    failures: [],
    cancelled: false,
  };

  for (const item of planBatchMove(sources, toDir)) {
    if (!deps.isCurrent()) {
      outcome.cancelled = true;
      break;
    }

    try {
      let result = await deps.move(item, false);
      let replaced = false;

      if (result.status === "conflict") {
        if (!result.replaceable) {
          outcome.unreplaceable.push(item);
          continue;
        }
        if (!deps.isCurrent()) {
          outcome.cancelled = true;
          break;
        }
        const resolution = await deps.resolveConflict(item);
        if (!deps.isCurrent()) {
          outcome.cancelled = true;
          break;
        }
        if (resolution === "skip") continue;
        if (!deps.canReplace(item, outcome.renamed)) {
          outcome.blocked.push(item);
          continue;
        }
        result = await deps.move(item, true);
        replaced = true;
      }

      if (result.status === "conflict") {
        outcome.failures.push({
          item,
          error: new Error("destination changed during replacement"),
        });
      } else {
        outcome.renamed.push({ from: item.from, to: item.to, replaced });
      }
    } catch (error) {
      outcome.failures.push({ item, error });
    }

    if (!deps.isCurrent()) {
      outcome.cancelled = true;
      break;
    }
  }

  return outcome;
}
