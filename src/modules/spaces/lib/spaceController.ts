import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import type { SpaceMeta } from "@/modules/spaces/lib/store";

export type PreparedWorkspace = {
  env: WorkspaceEnv;
  home: string;
};

export type SpaceControllerDeps = {
  getSpace(id: string): SpaceMeta | null;
  currentEnv(): WorkspaceEnv;
  validateRoot(path: string, env: WorkspaceEnv): Promise<string>;
  prepareEnv(env: WorkspaceEnv): Promise<PreparedWorkspace>;
  applyEnv(prepared: PreparedWorkspace): void;
  commitActive(target: { spaceId: string; tabId?: number }): void;
  createMeta(input: {
    name: string;
    root: string;
    env: WorkspaceEnv;
  }): SpaceMeta;
  createTerminal(spaceId: string, root: string): number;
  setRoot(spaceId: string, root: string): void;
  reportError(message: string): void;
};

export type SpaceController = {
  activate(target: { spaceId: string; tabId?: number }): Promise<boolean>;
  create(input: {
    name: string;
    root: string;
    env: WorkspaceEnv;
  }): Promise<SpaceMeta | null>;
  createAtHome(input: {
    name: string;
    env: WorkspaceEnv;
  }): Promise<SpaceMeta | null>;
  changeRoot(spaceId: string, path: string): Promise<boolean>;
};

export function nextSpaceName(spaces: SpaceMeta[]): string {
  let highest = 0;
  for (const space of spaces) {
    const match = /^Space (\d+)$/.exec(space.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Space ${highest + 1}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSpaceController(
  deps: SpaceControllerDeps,
): SpaceController {
  let requestId = 0;
  let transaction = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transaction.then(operation, operation);
    transaction = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const isCurrentRequest = (id: number) => id === requestId;
  const hasCurrentEnv = (env: WorkspaceEnv) =>
    workspaceScopeKey(deps.currentEnv()) === workspaceScopeKey(env);

  return {
    activate: (target) => {
      const id = ++requestId;
      return serialize(async () => {
        const space = deps.getSpace(target.spaceId);
        if (!space || !isCurrentRequest(id)) return false;

        let prepared: PreparedWorkspace | null = null;
        try {
          if (!hasCurrentEnv(space.env))
            prepared = await deps.prepareEnv(space.env);
        } catch (error) {
          if (isCurrentRequest(id)) {
            deps.reportError(
              `Unable to activate Space: ${errorMessage(error)}`,
            );
          }
          return false;
        }

        if (!isCurrentRequest(id)) return false;
        if (prepared) deps.applyEnv(prepared);
        deps.commitActive(target);
        return true;
      });
    },

    create: (input) => {
      const id = ++requestId;
      return serialize(async () => {
        let root: string;
        let prepared: PreparedWorkspace;
        try {
          root = await deps.validateRoot(input.root, input.env);
          if (!isCurrentRequest(id)) return null;
          prepared = await deps.prepareEnv(input.env);
        } catch (error) {
          if (isCurrentRequest(id)) {
            deps.reportError(`Unable to create Space: ${errorMessage(error)}`);
          }
          return null;
        }

        if (!isCurrentRequest(id)) return null;
        const space = deps.createMeta({ ...input, root });
        deps.createTerminal(space.id, root);
        deps.applyEnv(prepared);
        deps.commitActive({ spaceId: space.id });
        return space;
      });
    },

    createAtHome: (input) => {
      const id = ++requestId;
      return serialize(async () => {
        let root: string;
        let prepared: PreparedWorkspace;
        try {
          prepared = await deps.prepareEnv(input.env);
          if (!isCurrentRequest(id)) return null;
          root = await deps.validateRoot(prepared.home, input.env);
        } catch (error) {
          if (isCurrentRequest(id)) {
            deps.reportError(`Unable to create Space: ${errorMessage(error)}`);
          }
          return null;
        }

        if (!isCurrentRequest(id)) return null;
        const space = deps.createMeta({ ...input, root });
        deps.createTerminal(space.id, root);
        deps.applyEnv(prepared);
        deps.commitActive({ spaceId: space.id });
        return space;
      });
    },

    changeRoot: (spaceId, path) => {
      const space = deps.getSpace(spaceId);
      const id = ++requestId;
      return serialize(async () => {
        if (!space || !isCurrentRequest(id)) return false;

        let root: string;
        try {
          root = await deps.validateRoot(path, space.env);
        } catch (error) {
          if (isCurrentRequest(id)) {
            deps.reportError(
              `Unable to change Space root: ${errorMessage(error)}`,
            );
          }
          return false;
        }

        const currentSpace = deps.getSpace(spaceId);
        if (
          !isCurrentRequest(id) ||
          !currentSpace ||
          workspaceScopeKey(currentSpace.env) !== workspaceScopeKey(space.env)
        ) {
          return false;
        }
        deps.setRoot(spaceId, root);
        return true;
      });
    },
  };
}
