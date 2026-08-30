export { SpaceSwitcher } from "./SpaceSwitcher";
export { SpaceAvatar } from "./SpaceAvatar";
export { usableActiveSpaceRoot } from "./lib/activeSpace";
export type { SpaceRootFs } from "./lib/rootValidation";
export { validateSpaceRoot } from "./lib/rootValidation";
export type {
  PreparedWorkspace,
  SpaceController,
  SpaceControllerDeps,
} from "./lib/spaceController";
export {
  createSpaceController,
  nextSpaceName,
} from "./lib/spaceController";
export { canPersistSpaceState, useSpaces } from "./lib/useSpaces";
export { useSpacesBoot } from "./lib/useSpacesBoot";
export { useSpacePersistence } from "./lib/useSpacePersistence";
export type { SpaceMeta } from "./lib/store";
