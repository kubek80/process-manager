import type { Process, Step, StepType } from "../types";

/**
 * The code map's flow charts are ordinary processes, drawn by the same map as everything else
 * (as the Guide's are, `src/guide/flows.ts`). The lanes are the parts that act: the browser,
 * the server, Postgres, the provider of vectors.
 */

/** One step: its id, title, the lane it is in, its type, where it goes next (`"id"` or `["id", "label"]`), and a short note under the title. */
export const s = (id: string, title: string, actor: string, type: StepType, next: (string | [string, string])[], note?: string): Step => ({
  id, title, actor, type, ...(note ? { duration: note } : {}),
  next: next.map((n) => (typeof n === "string" ? { to: n } : { to: n[0], label: n[1] })),
});

/** A chart: an id (start it with "code-"), a title, a sentence, the lanes as `[id, name]` in the order they are drawn, and the steps. */
export const flow = (id: string, title: string, summary: string, lanes: [string, string][], steps: Step[]): Process => ({
  schemaVersion: "1.0", id, title, summary, prerequisites: [],
  actors: lanes.map(([aid, name]) => ({ id: aid, name })),
  steps,
});
