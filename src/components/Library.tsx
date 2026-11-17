import { Plus, Sparkles } from "lucide-react";
import type { Feedback, Process } from "../types";
import { useEditor } from "../lib/mode";
import { canCreate, usePerms } from "../lib/session";
import { DocList } from "./DocList";

export function Library({ processes, standardIds, onNew, onAi, feedback }: {
  processes: Process[]; standardIds: string[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
}) {
  const perms = usePerms();
  // the buttons to create one: for a process editor, and for whoever owns a platform or practice
  const editor = useEditor() && canCreate(perms, "process");
  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>How do I get…?</h1>
          <p className="lead">Platform processes, step by step. See who does what on the map, then follow your own checklist.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank process</button>
          </div>
        )}
      </section>
      <DocList kind="process" processes={processes} standards={[]} standardIds={standardIds} feedback={feedback}
        empty={editor ? "There are no processes yet. Create the first one with the buttons above." : "There are no processes yet."} />
    </div>
  );
}
