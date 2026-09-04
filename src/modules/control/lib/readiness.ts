export function createReadinessQueue(
  update: (ready: boolean) => Promise<unknown>,
): (ready: boolean) => Promise<unknown> {
  let pending: Promise<unknown> = Promise.resolve();
  return (ready) => {
    const run = () => update(ready);
    const next = pending.then(run, run);
    pending = next;
    return next;
  };
}
