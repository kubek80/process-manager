import { useMemo } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { DocMeta, Feedback, Process, Standard } from "../types";
import { canCreate, usePerms } from "../lib/session";
import { DocList } from "./DocList";

export function StandardsLibrary({ standards, processes, feedback, onNew, onAi, meta }: {
  standards: Standard[]; processes: Process[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
  /** What the server says about each standard (dates, unpublished changes), by id. */
  meta?: Record<string, DocMeta | undefined>;
}) {
  const perms = usePerms();
  // the buttons to create one: for a standards editor, and for whoever owns a platform or practice
  const editor = canCreate(perms, "standard");
  const standardIds = useMemo(() => standards.map((s) => s.id), [standards]);
  return (
    <div className="page library">
      <section className="hero list-hero">
        <div>
          <h1>What must I meet?</h1>
          <p className="lead">The rules your work must meet, set by cyber security, platforms and practices.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank standard</button>
          </div>
        )}
      </section>
      <DocList kind="standard" processes={processes} standards={standards} standardIds={standardIds} feedback={feedback} meta={meta}
        empty={editor ? "There are no standards yet. Create the first one with the buttons above." : "There are no standards yet."} />
    </div>
  );
}
