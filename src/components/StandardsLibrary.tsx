import { useMemo } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { Feedback, Process, Standard } from "../types";
import { useEditor } from "../lib/mode";
import { canCreate, usePerms } from "../lib/session";
import { DocList } from "./DocList";

export function StandardsLibrary({ standards, processes, feedback, onNew, onAi }: {
  standards: Standard[]; processes: Process[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
}) {
  const perms = usePerms();
  // the buttons to create one: for a standards editor, and for whoever owns a platform or practice
  const editor = useEditor() && canCreate(perms, "standard");
  const standardIds = useMemo(() => standards.map((s) => s.id), [standards]);
  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>What must I meet?</h1>
          <p className="lead">Standards set by cyber security, platforms and practices. Each one is a list of requirements with the reason, how to comply and how it is checked.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank standard</button>
          </div>
        )}
      </section>
      <DocList kind="standard" processes={processes} standards={standards} standardIds={standardIds} feedback={feedback}
        empty={editor ? "There are no standards yet. Create the first one with the buttons above." : "There are no standards yet."} />
    </div>
  );
}
