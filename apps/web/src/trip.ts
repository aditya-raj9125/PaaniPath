/** Preserve uncommitted search text when stops are inserted, removed, reversed or reordered. */
export function remapDrafts(drafts: Readonly<Record<number, string>>, originalIndices: readonly number[]): Record<number, string> {
  const next: Record<number, string> = {};
  originalIndices.forEach((original, current) => {
    const value = drafts[original];
    if (value !== undefined) next[current] = value;
  });
  return next;
}
