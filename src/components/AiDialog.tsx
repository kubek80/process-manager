import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Download, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import type { Issue, Process } from "../types";
import { createPrompt, fixPrompt, modifyPrompt } from "../lib/prompt";
import { extractJson, hasErrors, validateProcess } from "../lib/validate";
import { download } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { CopyButton, Modal } from "./ui";

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.level}>
          {i.level === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
          <span><code>{i.path}</code> {i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Works with any chat LLM: copy the prompt out, paste the answer back, the checker does the rest. */
export function AiDialog({ current, all, onImport, onClose }: {
  current?: Process; all: Process[]; onImport: (p: Process) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const { catalog } = useCatalog();
  const known = useMemo(() => all.map((p) => ({ id: p.id, title: p.title })), [all]);
  const prompt = () => (current ? modifyPrompt(current, text, known, catalog) : createPrompt(text, known, catalog));

  const parsed = useMemo(() => (answer.trim() ? extractJson(answer) : null), [answer]);
  const issues = useMemo(
    () => (parsed?.value ? validateProcess(parsed.value, { processIds: [...all.map((p) => p.id), (parsed.value as Process).id], catalog }) : []),
    [parsed, all, catalog],
  );
  const ok = !!parsed?.value && !hasErrors(issues);
  const result = parsed?.value as Process | undefined;
  const replaces = ok && !current && all.some((p) => p.id === result!.id);
  const idChanged = ok && current && result!.id !== current.id;

  return (
    <Modal wide onClose={onClose}
      title={<><Sparkles size={18} className="accent" /> {current ? `Change “${current.title}” with AI` : "Create a process from text with AI"}</>}
      subtitle="Use any chat assistant you are allowed to use - Gemini, Copilot, ChatGPT or Claude. Nothing is sent anywhere by this app."
      footer={<>
        <span className="muted small">{ok ? (current ? "The result replaces your draft. You still have to press Save." : "The process is saved as a new file.") : ""}</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onImport(current ? { ...result!, id: current.id } : result!)}>
          {current ? "Apply to draft" : replaces ? "Replace existing process" : "Create process"}
        </button>
      </>}>
      <ol className="ai-steps">
        <li>
          <span className="ai-n">1</span>
          <div>
            <h4>{current ? "Describe the change" : "Paste the description of the process"}</h4>
            <p className="muted small">{current
              ? "Plain words are fine, e.g. “After the budget approval add a security review by the Security team. If they reject, the requester updates the design.”"
              : "An email, a wiki page, meeting notes - anything that says who does what, in which order."}</p>
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={current ? "What should be different?" : "To get a new GCP project you first need a cost centre. Then you fill in the ‘New GCP project’ form in ServiceNow…"} />
          </div>
        </li>
        <li>
          <span className="ai-n">2</span>
          <div>
            <h4>Copy the prompt and paste it into your AI chat</h4>
            <p className="muted small">The prompt contains the rules, the JSON schema, your teams, tools and tiers, an example{current ? ", the current process" : ""} and your text. Send it as one message.</p>
            <div className="btn-row">
              <CopyButton primary label="Copy prompt" text={prompt} />
              <button className="btn" onClick={() => download("process-prompt.md", prompt())}><Download size={16} />Download as file</button>
              <span className="muted small">{Math.round(prompt().length / 1000)}k characters</span>
            </div>
          </div>
        </li>
        <li>
          <span className="ai-n">3</span>
          <div>
            <h4>Paste the answer here</h4>
            <p className="muted small">Paste the whole answer - the JSON is picked out and checked automatically.</p>
            <textarea rows={7} className="mono" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={'```json\n{ "schemaVersion": "1.0", … }\n```'} />
            {parsed?.error && (
              <div className="check bad"><CircleAlert size={16} /><span>{parsed.error}</span></div>
            )}
            {parsed?.value != null && (
              <>
                <div className={`check ${ok ? "good" : "bad"}`}>
                  {ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
                  <span>{ok
                    ? <>Valid: <b>{result!.title}</b> - {result!.steps.length} steps, {result!.actors.length} participants, {result!.prerequisites.length} prerequisites{issues.length ? `, ${issues.length} hint(s)` : ""}.</>
                    : <>{issues.filter((i) => i.level === "error").length} problem(s) found. Send the fix request to the same chat and paste the new answer.</>}</span>
                </div>
                {idChanged && <div className="check warn"><TriangleAlert size={16} /><span>The AI changed the process id. The current id “{current!.id}” is kept.</span></div>}
                {issues.length > 0 && <IssueList issues={issues} />}
              </>
            )}
            {(parsed?.error || (parsed?.value != null && issues.length > 0)) && (
              <div className="btn-row">
                <CopyButton label="Copy fix request" icon={<Wrench size={16} />} text={() => fixPrompt(issues, parsed?.error)} />
              </div>
            )}
          </div>
        </li>
      </ol>
    </Modal>
  );
}
