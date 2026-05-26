/**
 * Compose the storage key for a saved session. Launch dir partitions
 * sessions per project so `terax ~/projects/foo` and `terax ~/projects/bar`
 * keep separate tab sets; falsy launch dir collapses to a shared "default"
 * key (typical of icon-launched windows).
 */
export function sessionKey(
  launchDir: string | undefined,
  workspaceScope: string,
): string {
  const base = launchDir && launchDir.length > 0 ? launchDir : "default";
  return `${base}::${workspaceScope}`;
}
