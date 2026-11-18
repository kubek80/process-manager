import type { EngagementApi } from "./engagement";

// Bookmarks and upvotes come from the server after the page is shown. Until they are in (or when
// they could not be loaded) a count of 0 or "no bookmarks" would look like a fact.

type Known = Pick<EngagementApi, "ready"> & Partial<Pick<EngagementApi, "known" | "failed">>;

/** Whether the bookmarks and upvotes are known: loaded, and not refused. */
export const engagementKnown = (eng: Known): boolean => eng.known ?? (eng.ready && !eng.failed);

/** Why "Only my bookmarks" cannot be used yet, or undefined when it can. */
export function bookmarksUnknown(eng: Known): string | undefined {
  if (!eng.ready) return "loading your bookmarks…";
  if (eng.failed) return "your bookmarks could not be loaded";
  return undefined;
}
