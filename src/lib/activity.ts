// Admin > Activity: what of an entry is worth showing to a reader.

/** Actions whose target is a technical id (an uploaded icon is named by the fingerprint of its bytes): the entry says what happened without it. */
const NO_TARGET = new Set(["icon.upload", "theme.change"]);

/** The target to show after the action's words; "" when it would mean nothing to a reader. */
export const shownTarget = (action: string, target: string): string => (NO_TARGET.has(action) || /^[0-9a-f]{64}$/.test(target) ? "" : target);
