/**
 * The tabs of the lists (Teams and Tools, for readers and in Admin): a place's tabs in two sets that
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
 * What an address of the lists asks to show (`#/admin/teams/pillars/compute`, `#/tools/paths`): the
 * list and the entry it names. An address that names only its place (`#/teams`, `#/admin/tools`)
 * opens the place's first list on the reader's side; Admin stays where it is when the list shown
 * is already in that place (its unsaved changes stay in any case: it is one page), else it opens
 * the place's first list. `placeOf` says which place a list is in.
 */
export function addressedList<K extends string, P extends string>(
  editor: boolean, place: P, list: K | undefined, id: string | undefined, current: K, firstOf: (place: P) => K, placeOf: (list: K) => P,
): { list: K; id: string | null } | null {
  if (list) return { list, id: id ?? null };
  if (editor && placeOf(current) === place) return null;
  return { list: firstOf(place), id: null };
}

/**
 * Whether the search box of the lists keeps its words when the page moves from one list to
 * another: the search belongs to the list a person is looking at, so it stays while only the
 * entry changes and is emptied when the list changes (another tab or the other place).
 */
export const searchStays = <K extends string>(from: K, to: K): boolean => from === to;
