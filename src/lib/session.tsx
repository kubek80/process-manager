import { createContext, useContext } from "react";
import type { Feedback, FeedbackKind, Me } from "../types";

/** The signed-in user. Roles come from the server; the app only uses them to show or hide controls. */
export const MeContext = createContext<Me>({ authenticated: false, provider: "dev", contentWritable: false });
export const useMe = () => useContext(MeContext);

/** Everything that can be done to feedback. Each action is saved on the server straight away. */
export interface FeedbackActions {
  add: (spec: { processId: string; stepId?: string; kind: FeedbackKind; text: string }) => Promise<boolean>;
  alsoHit: (item: Feedback, on: boolean) => void;
  resolve: (item: Feedback, resolved: boolean) => void;
  remove: (item: Feedback) => void;
}
const noop: FeedbackActions = { add: async () => false, alsoHit: () => {}, resolve: () => {}, remove: () => {} };
export const FeedbackContext = createContext<FeedbackActions>(noop);
export const useFeedbackActions = () => useContext(FeedbackContext);
