import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Download, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import type { Issue } from "../types";
import { fixPrompt } from "../lib/prompt";
import { extractJson, hasErrors } from "../lib/validate";
import { download } from "../lib/store";
import { issuePlace, issueText, publishLines } from "../lib/editing";
import { useCatalog } from "../lib/catalog";
import { CopyButton, Modal } from "./ui";

/** What the dialog needs to know about the kind of document it creates or changes. */
export interface AiSpec<T extends { id: string; title: string }> {
  noun: "process" | "standard";
  current?: T;
  existingIds: string[];
  /** Builds the full prompt from what the person typed. */
  prompt: (text: string) => string;
  validate: (value: unknown) => Issue[];
  describe: (value: T) => string;
  describePlaceholder: string;
  changeExample: string;
}

/** Works with any chat LLM: copy the prompt out, paste the answer back, the checker does the rest. */
export function AiDialog<T extends { id: string; title: string }>({ spec, onImport, onClose }: {
  spec: AiSpec<T>; onImport: (d: T) => void; onClose: () => void;
}) {
  const { current, noun } = spec;
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");

  const parsed = useMemo(() => (answer.trim() ? extractJson(answer) : null), [answer]);
  const issues = useMemo(() => (parsed?.value ? spec.validate(parsed.value) : []), [parsed, spec]);
  const ok = !!parsed?.value && !hasErrors(issues);
  const result = parsed?.value as T | undefined;
  const replaces = ok && !current && spec.existingIds.includes(result!.id);
  const idChanged = ok && current && result!.id !== current.id;
  const { catalog } = useCatalog();
  // what applying changes in the draft, in the words of the Publish list
  const changes = useMemo(() => {
    if (!ok || !current) return [];
    try { return publishLines(noun, current as never, { ...(result as object), id: current.id } as never, catalog); } catch { return []; }
  }, [ok, current, result, noun, catalog]);
  const title: ReactNode = current ? `Change “${current.title}” with AI` : `Create a ${noun} from text with AI`;

  return (
    <Modal wide onClose={onClose}
      title={<><Sparkles size={18} className="accent" /> {title}</>}
      subtitle="Use any chat assistant you are allowed to use - Gemini, Copilot, ChatGPT or Claude. Nothing is sent anywhere by this app."
      footer={<>
        <span className="muted small">{ok ? (current ? "The result replaces your draft (Undo brings it back). You still have to press Save draft."
          : replaces ? `A ${noun} “${result!.id}” exists already: this one is created next to it, as a draft that only editors see.`
            : `The ${noun} is created as a draft that only editors see.`) : ""}</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onImport(current ? { ...result!, id: current.id } : result!)}>
          {current ? "Apply to draft" : `Create ${noun}`}
        </button>
      </>}>
      <ol className="ai-steps">
        <li>
          <span className="ai-n">1</span>
          <div>
            <h4>{current ? "Describe the change" : noun === "process" ? "Paste the description of the process" : "Paste the policy or guideline"}</h4>
            <p className="muted small">{current ? `Plain words are fine, e.g. “${spec.changeExample}”` : noun === "process"
              ? "An email, a wiki page, meeting notes - anything that says who does what, in which order."
              : "A policy document, a wiki page, a list of rules - anything that says what must or should be true."}</p>
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={current ? "What should be different?" : spec.describePlaceholder}
              aria-label={current ? "Describe the change" : noun === "process" ? "Description of the process" : "The policy or guideline"} data-autofocus="" />
          </div>
        </li>
        <li>
          <span className="ai-n">2</span>
          <div>
            <h4>Copy the prompt and paste it into your AI chat</h4>
            <p className="muted small">The prompt contains the rules a {noun} follows, how it must be written down, your teams, tools, tiers and environments, an example{current ? `, the current ${noun}` : ""} and your text. Send it as one message.</p>
            <div className="btn-row">
              <CopyButton primary label="Copy prompt" text={() => spec.prompt(text)} />
              <button className="btn" onClick={() => download(`${noun}-prompt.md`, spec.prompt(text))}><Download size={16} />Download as file</button>
              <span className="muted small">{Math.round(spec.prompt(text).length / 1000)}k characters</span>
            </div>
          </div>
        </li>
        <li>
          <span className="ai-n">3</span>
          <div>
            <h4>Paste the answer here</h4>
            <p className="muted small">Paste the whole answer: the {noun} is picked out of it and checked automatically.</p>
            <textarea rows={7} className="mono" value={answer} aria-label="The answer of the AI chat" onChange={(e) => setAnswer(e.target.value)} placeholder="Paste the whole answer from the chat here." />
            {parsed?.error && (
              <div className="check bad"><CircleAlert size={16} /><span>{parsed.error}</span></div>
            )}
            {parsed?.value != null && (
              <>
                <div className={`check ${ok ? "good" : "bad"}`}>
                  {ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
                  <span>{ok
                    ? <>Valid: <b>{result!.title}</b> - {spec.describe(result!)}{issues.length ? `, ${issues.length} ${issues.length === 1 ? "suggestion" : "suggestions"}` : ""}.</>
                    : <>{issues.filter((i) => i.level === "error").length} to fix. Send the fix request to the same chat and paste the new answer.</>}</span>
                </div>
                {ok && current && (
                  <div className="ai-changes">
                    <h4>What changes in your draft{changes.length ? ` (${changes.length})` : ""}</h4>
                    {changes.length
                      ? <ul className="publish-changes">{changes.map((l, k) => <li key={k}>{l}</li>)}</ul>
                      : <p className="muted small">Nothing that readers see changes.</p>}
                  </div>
                )}
                {idChanged && <div className="check warn"><TriangleAlert size={16} /><span>The answer changed the address of the {noun}. Its own (“{current!.id}”) is kept.</span></div>}
                {issues.length > 0 && (
                  <ul className="issues ai-issues">
                    {issues.map((i, k) => (
                      <li key={k} className={i.level}>
                        {i.level === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
                        <span><b>{issuePlace(noun, parsed.value, i.path)}</b> {issueText(i, noun)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {(parsed?.error || (parsed?.value != null && issues.length > 0)) && (
              <div className="btn-row">
                <CopyButton label="Copy fix request" icon={<Wrench size={16} />} text={() => fixPrompt(issues, parsed?.error, parsed?.value)} />
              </div>
            )}
          </div>
        </li>
      </ol>
    </Modal>
  );
}
