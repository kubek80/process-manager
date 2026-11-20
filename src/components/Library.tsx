import { Plus, Sparkles } from "lucide-react";
import type { DocMeta, Feedback, Process } from "../types";
import { canCreate, usePerms } from "../lib/session";
import { DocList } from "./DocList";

export function Library({ processes, standardIds, onNew, onAi, feedback, meta }: {
  processes: Process[]; standardIds: string[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
  /** What the server says about each process (dates, unpublished changes), by id. */
  meta?: Record<string, DocMeta | undefined>;
}) {
  const perms = usePerms();
  // the buttons to create one: for a process editor, and for whoever owns a platform or practice
  const editor = canCreate(perms, "process");
  return (
    <div className="page library">
      <section className="hero list-hero">
        <div>
          <h1>How do I get…?</h1>
          <p className="lead">Step by step: who does what, and your own checklist.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank process</button>
          </div>
        )}
      </section>
      <DocList kind="process" processes={processes} standards={[]} standardIds={standardIds} feedback={feedback} meta={meta}
        empty={editor ? "There are no processes yet. Create the first one with the buttons above." : "There are no processes yet."} />
    </div>
  );
}
