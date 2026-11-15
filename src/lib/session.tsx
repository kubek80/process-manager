import { createContext, useContext } from "react";
import type { Feedback, FeedbackKind, Me, Perms, TargetKind } from "../types";

/** The signed-in user. Rights come from the server; the app only uses them to show or hide controls. */
export const MeContext = createContext<Me>({ authenticated: false, provider: "dev" });
export const useMe = () => useContext(MeContext);

const NONE: Perms = { admin: false, catalog: false, processes: false, standards: false, standardUnits: [], owns: [] };
export const usePerms = (): Perms => useContext(MeContext).perms ?? NONE;

export const canEditStandard = (p: Perms, unit?: string) => p.standards || (!!unit && p.standardUnits.includes(unit));
export const canEditAnyStandard = (p: Perms) => p.standards || p.standardUnits.length > 0;
/** Anyone who can change processes or standards gets the Consumer / Editor switch. */
export const canEditSomething = (p: Perms) => p.processes || canEditAnyStandard(p);
/** The Admin panel has something for admins and for people who manage the lists. */
export const canOpenAdmin = (p: Perms) => p.admin || p.catalog;

export function roleLabel(p: Perms): string {
  if (p.admin) return "Admin";
  const parts: string[] = [];
  if (p.processes) parts.push("Process editor");
  if (canEditAnyStandard(p)) parts.push("Standards editor");
  if (p.catalog) parts.push("Manages the lists");
  if (p.owns.length) parts.push("Owner");
  return parts.join(" · ") || "Consumer";
}

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
