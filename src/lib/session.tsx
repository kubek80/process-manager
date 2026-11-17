import { createContext, useContext, useMemo } from "react";
import { useEditor } from "./mode";
import { canEdit as mayEdit } from "./rights";
import type { Feedback, FeedbackKind, Me, Perms, TargetKind } from "../types";
import { NO_PERMS } from "./rights";

/** The signed-in user. Rights come from the server; the app only uses them to show or hide controls. */
export const MeContext = createContext<Me>({ authenticated: false, provider: "dev" });
export const useMe = () => useContext(MeContext);

export const usePerms = (): Perms => useContext(MeContext).perms ?? NO_PERMS;

/**
 * Which drafts a list shows: in editor mode the drafts the person may edit, otherwise none.
 * The libraries, search and Home all follow this.
 */
export function useVisibleDrafts(): false | ((kind: TargetKind, doc: { owner?: string; platform?: string; practice?: string }) => boolean) {
  const perms = usePerms();
  const editor = useEditor();
  return useMemo(() => (editor ? (kind: TargetKind, doc: { owner?: string; platform?: string; practice?: string }) => mayEdit(perms, kind, doc) : false), [perms, editor]);
}

// the rights themselves are worked out in ./rights; these are here for the pages that import them from the session
export { canCreate, canEdit, canEditSomething, canManage, canOpenAdmin, editsAll, roleLabel } from "./rights";

/** Everything that can be done to feedback. Each action is saved on the server straight away. */
export interface FeedbackActions {
  add: (spec: { targetKind: TargetKind; targetId: string; itemId?: string; kind: FeedbackKind; text: string }) => Promise<boolean>;
  alsoHit: (item: Feedback, on: boolean) => void;
  resolve: (item: Feedback, resolved: boolean) => void;
  remove: (item: Feedback) => void;
}
const noop: FeedbackActions = { add: async () => false, alsoHit: () => {}, resolve: () => {}, remove: () => {} };
export const FeedbackContext = createContext<FeedbackActions>(noop);
export const useFeedbackActions = () => useContext(FeedbackContext);
