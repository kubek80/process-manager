/**
 * The tabs of the lists (Admin › Lists, Teams & tools): twelve tabs in three named groups that
 * behave as one set of tabs for the keyboard: one Tab stop (the chosen tab), the arrow keys move
 * through all of them in order across the groups (and choose, as the app's other one-of-several
 * controls do), Home and End go to the first and the last.
 */

/** The tab a key leads to from `current`, in the order of `keys`; null for a key that moves nothing. */
export function tabAfterKey<K extends string>(keys: readonly K[], current: K, key: string): K | null {
  if (!keys.length) return null;
  const at = Math.max(0, keys.indexOf(current));
  switch (key) {
    case "ArrowRight": return keys[(at + 1) % keys.length];
    case "ArrowLeft": return keys[(at + keys.length - 1) % keys.length];
    case "Home": return keys[0];
    case "End": return keys[keys.length - 1];
    default: return null;
  }
}

/**
 * What an address of the lists asks to show (`#/admin/lists/tribes/payments`, `#/catalog/tools`):
 * the list and the entry it names. An address without a list (`#/admin/lists`) asks nothing of
 * Admin › Lists, which then stays where it is with its unsaved changes; on Teams & tools, which
 * keeps the list in the address, it means the first list.
 */
export function addressedList<K extends string>(editor: boolean, list: K | undefined, id: string | undefined, first: K): { list: K; id: string | null } | null {
  if (!list) return editor ? null : { list: first, id: null };
  return { list, id: id ?? null };
}
