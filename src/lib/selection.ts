import { useCallback, useEffect, useRef, useState } from "react";
import { go, href, type Route } from "./store";

/**
 * The step or requirement that is open. It is part of the address, so that a link can point at
 * it - but the address only follows a moment after a click, and a page must never show "nothing
 * is open" in between (that would tear the side panel down under the cursor). So the page keeps
 * what was chosen until the address has caught up.
 *
 * What the history remembers: opening is a step forward (Back closes it); moving from one item
 * to another, or an item getting another id, changes the address in place; closing goes back to
 * where opening came from. Back therefore never opens again what was closed.
 *
 * `item` is the one in the address. `address` builds the route for an item (null: none open).
 * `exists` says whether an item is there: an address that points at nothing is cleaned up.
 */
export function useSelectedItem(item: string | undefined, address: (id: string | null) => Route, exists: (id: string) => boolean): [string | null, (id: string | null) => void] {
  const [chosen, setChosen] = useState<string | null | undefined>(undefined); // undefined: follow the address
  const selected = chosen !== undefined ? chosen : item ?? null;
  // Where the person was when the open item was opened by a step forward of ours (an address),
  // or null. Closing goes back there - if that is still the place to go back to.
  const opened = useRef<string | null>(null);

  // the address has caught up, or was changed by Back, a link or a typed address
  useEffect(() => {
    setChosen(undefined);
    if (!item) opened.current = null;
  }, [item]);

  // an address that points at an item that is not there (a discarded new step, an old link)
  const dangling = chosen === undefined && !!item && !exists(item);
  useEffect(() => { if (dangling) go(address(null), { replace: true }); }, [dangling]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((id: string | null) => {
    setChosen(id);
    if (id === null) {
      // Back is right only when it leads to this very page without the item. After a change of
      // tab, or when the item was opened from somewhere else, the address is changed in place.
      const from = opened.current;
      opened.current = null;
      if (from !== null && from === href(address(null))) history.back(); else go(address(null), { replace: true });
    } else if (selected === null) {
      opened.current = location.hash;
      go(address(id));
    } else if (id !== selected) {
      go(address(id), { replace: true });
    }
  }, [selected, address]);

  return [dangling ? null : selected, select];
}
