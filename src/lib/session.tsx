import { createContext, useContext } from "react";
import type { Feedback, FeedbackKind, Me, Perms, TargetKind } from "../types";
import { changeBlocked, NO_PERMS } from "./rights";

/** The signed-in user. Rights come from the server; the app only uses them to show or hide controls. */
export const MeContext = createContext<Me>({ authenticated: false, provider: "dev" });
export const useMe = () => useContext(MeContext);

export const usePerms = (): Perms => useContext(MeContext).perms ?? NO_PERMS;

/** Why nothing can be changed right now (an admin viewing the portal as somebody else, `changeBlocked`); "" when it can. A control that changes something is then disabled with this as its reason, never hidden. */
export const useChangeBlocked = (): string => changeBlocked(useContext(MeContext));

// the rights themselves are worked out in ./rights; these are here for the pages that import them from the session
export { canCreate, canDraft, canEdit, canManage, canOpenAdmin, editsAll, roleLabel } from "./rights";

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
