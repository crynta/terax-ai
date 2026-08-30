export type GitHistoryRequest = {
  id: number;
  spaceId: string;
  workspaceScope: string;
  spaceRoot: string | null;
};

export type GitHistoryRequestGate = {
  invalidate: () => void;
  begin: (
    spaceId: string,
    workspaceScope: string,
    spaceRoot: string | null,
  ) => GitHistoryRequest;
  isCurrent: (
    request: GitHistoryRequest,
    activeSpaceId: string,
    activeWorkspaceScope: string,
    activeSpaceRoot: string | null,
  ) => boolean;
};

export function createGitHistoryRequestGate(): GitHistoryRequestGate {
  let latestId = 0;
  return {
    invalidate: () => {
      latestId += 1;
    },
    begin: (spaceId, workspaceScope, spaceRoot) => ({
      id: ++latestId,
      spaceId,
      workspaceScope,
      spaceRoot,
    }),
    isCurrent: (
      request,
      activeSpaceId,
      activeWorkspaceScope,
      activeSpaceRoot,
    ) =>
      request.id === latestId &&
      request.spaceId === activeSpaceId &&
      request.workspaceScope === activeWorkspaceScope &&
      request.spaceRoot === activeSpaceRoot,
  };
}
