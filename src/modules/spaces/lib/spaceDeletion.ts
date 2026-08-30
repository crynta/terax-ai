type SpaceDeletionDeps = {
  isActive: boolean;
  activate: () => Promise<boolean>;
  remove: () => void;
};

export async function deleteSpaceAfterActivation({
  isActive,
  activate,
  remove,
}: SpaceDeletionDeps): Promise<boolean> {
  if (isActive && !(await activate())) return false;
  remove();
  return true;
}
