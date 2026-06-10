/** Simple UUID v4 generator using the browser crypto API. */
export function v4(): string {
  return crypto.randomUUID();
}
