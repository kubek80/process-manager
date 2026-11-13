import { useEffect, useState, type ReactNode } from "react";
import { Braces, CalendarCheck, Check, Eye, Flag, GripVertical, Layers, ListChecks, MousePointerClick, Pencil, Plus, Sparkles, Workflow } from "lucide-react";
import type { Process } from "../types";
import { STEP_META, STEP_TYPES } from "../lib/stepMeta";
import { aiFlow, automationFlow, feedbackFlow, followFlow, reviewFlow } from "../guide/flows";
import { FlowView } from "./FlowView";
import { TypeIcon } from "./ui";

const SECTIONS: [string, string][] = [
  ["what", "What it is"],
  ["modes", "Consumer and Editor"],
  ["read", "Reading a process"],
  ["follow", "Following a process"],
  ["blocks", "The building blocks"],
  ["edit", "Editing a process"],
  ["ai", "Creating one with AI"],
  ["skills", "Skills and links"],
  ["catalog", "Teams, tools, tiers, languages"],
  ["feedback", "Feedback"],
  ["lifecycle", "Life-cycle and reviews"],
  ["agents", "For agents: MCP"],
  ["roadmap", "Planned: automation"],
  ["files", "Files, schema and checker"],
];

const NONE = new Set<string>();

function Chart({ process, caption }: { process: Process; caption: string }) {
  return (
    <figure className="guide-fig">
      <FlowView bare editable={false} process={process} selectedId={null} done={NONE} feedback={[]} onSelect={() => {}} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={`guide-${id}`} className="guide-section"><h2>{title}</h2>{children}</section>;
}

export function GuidePage() {
  const [active, setActive] = useState("what");
  useEffect(() => {
    const on = () => {
      let cur = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const el = document.getElementById(`guide-${id}`);
        if (el && el.getBoundingClientRect().top < 140) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const jump = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="page guide">
      <aside className="guide-toc">
        <span className="eyebrow">Guide</span>
        {SECTIONS.map(([id, title]) => (
          <button key={id} className={active === id ? "on" : ""} onClick={() => jump(id)}>{title}</button>
        ))}
      </aside>

      <article className="guide-body">
        <header className="guide-hero">
          <h1>How Process Manager works</h1>
          <p className="lead">One place that answers “how do I get a GCP project, a repository, an Akamai onboarding…”. Every process is written once and read two ways: as a map of who does what, and as your own checklist.</p>
        </header>

        <Section id="what" title="What it is">
          <div className="guide-cards three">
            <div><Workflow size={20} /><h3>A map</h3><p>Swim lanes, one per participant. Your lane is always the first, so you see at a glance what is yours and what you wait for.</p></div>
            <div><ListChecks size={20} /><h3>A checklist</h3><p>The same steps as a numbered list. Your steps are opened up with the exact actions; you tick them as you go.</p></div>
            <div><Braces size={20} /><h3>A file</h3><p>Behind both is one JSON file with a strict format. That is what makes it checkable, and what lets an AI write it for you.</p></div>
          </div>
        </Section>

        <Section id="modes" title="Consumer and Editor">
          <p>The switch in the top bar decides what the app offers you. It is a view, not a permission: anyone can flip it, and it is remembered in your browser.</p>
          <div className="guide-cards two">
            <div className="mode-card">
              <h3><Eye size={18} />Consumer</h3>
              <p>For people who need something done.</p>
              <ul>
                <li><Check size={14} />Find a process, filter by application tier</li>
                <li><Check size={14} />Read the map and follow the checklist</li>
                <li><Check size={14} />Tick prerequisites and steps (kept in your browser)</li>
                <li><Check size={14} />Flag a step that does not work</li>
                <li><Check size={14} />Look up teams and tools</li>
              </ul>
            </div>
            <div className="mode-card editor">
              <h3><Pencil size={18} />Editor</h3>
              <p>For process owners and business analysts. Everything a consumer has, plus:</p>
              <ul>
                <li><Check size={14} />Create processes, blank or from text with AI</li>
                <li><Check size={14} />Add, move and change steps directly on the map</li>
                <li><Check size={14} />Edit details, owner, tiers, participants, prerequisites</li>
                <li><Check size={14} />Edit the raw JSON in a code editor with problems marked on the line</li>
                <li><Check size={14} />Manage teams, tools and tiers; close feedback</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="read" title="Reading a process">
          <p>Open a process from the library. The header tells you which <b>application tiers</b> and <b>programming languages</b> it applies to, who owns it, how long it usually takes and when it was last reviewed. Below it:</p>
          <dl className="guide-dl">
            <div><dt>Before you start</dt><dd>The prerequisites. Tick what you already have. If a prerequisite is itself a process, a link takes you there.</dd></div>
            <div><dt>Map</dt><dd>Time runs left to right, each lane is one participant. Dashed arrows loop back, for example after a rejection. Click a block to open its details on the right.</dd></div>
            <div><dt>Checklist</dt><dd>Steps in order. Yours show the exact actions, the link to open and what you get at the end. Steps of others are collapsed so you know what you are waiting for. “Only my steps” hides them.</dd></div>
            <div><dt>Sub-processes</dt><dd>A step can hand over to another process, such as “Raise a ServiceNow request”. Expand it in place or open it.</dd></div>
          </dl>
        </Section>

        <Section id="follow" title="Following a process">
          <p>The typical path of a consumer, from finding the process to getting the result.</p>
          <Chart process={followFlow} caption="A consumer following a process. The dashed loop is a missing prerequisite. If a step fails, flagging it tells the owner." />
        </Section>

        <Section id="blocks" title="The building blocks">
          <p>Every step has a kind. The kind sets the icon and colour, so the map can be read without reading every title.</p>
          <div className="guide-blocks">
            {STEP_TYPES.map((t) => (
              <div key={t}><TypeIcon type={t} size={34} /><div><strong>{STEP_META[t].label}</strong><span>{STEP_META[t].when}</span></div></div>
            ))}
          </div>
        </Section>

        <Section id="edit" title="Editing a process">
          <p>Switch to <b>Editor</b>. Changes go into a draft; nothing is written until you press <b>Save changes</b>, and saving is blocked while the checker reports a problem.</p>
          <div className="guide-cards three">
            <div><Plus size={20} /><h3>Insert on an arrow</h3><p>Hover the map and press the small + on an arrow. A form appears right there: what happens, who does it, what kind. The step lands exactly between the two blocks.</p></div>
            <div><GripVertical size={20} /><h3>Drag between lanes</h3><p>Drag a block to another lane to change who does it. The + on a block adds a step after it; on a decision it adds a branch.</p></div>
            <div><ListChecks size={20} /><h3>Insert in the checklist</h3><p>The checklist works the same way: hover between two steps and press “Insert a step here”. Use it when you think in order rather than in lanes.</p></div>
            <div><MousePointerClick size={20} /><h3>Click for the rest</h3><p>“Edit step” in the side panel holds the exact actions, tool, link, result, sub-process and what comes next. “Details” holds name, owner, tiers, participants and prerequisites.</p></div>
          </div>
        </Section>

        <Section id="ai" title="Creating one with AI">
          <p>You do not need a particular AI product. The app builds one self-contained prompt that works in any chat assistant you are allowed to use, such as Gemini or Copilot in the browser, and checks whatever comes back. Nothing is sent anywhere by the app itself.</p>
          <Chart process={aiFlow} caption="From free text to a checked process. If the answer has problems, the app writes the fix request for you to send to the same chat. Afterwards you review and adjust on the map." />
          <p>The prompt contains the modelling rules, the JSON schema, your current teams, tools and tiers, the existing processes (so it can reuse them as sub-processes) and one worked example. “Change with AI” on a process works the same way and adds the current process to the prompt.</p>
        </Section>

        <Section id="skills" title="Skills and links">
          <p>A process, or a single step, can carry links that help to do the work: repositories, templates, documentation, and <b>self-service skills</b>. A skill is a set of instructions that an AI coding assistant can run, for example “add a GCP project to the IaC repository and open the pull request”. Skills are shown first under “Do it faster”, and on the step they belong to.</p>
          <p>This is how a description turns into self-service: the process says what must happen, the skill does it.</p>
        </Section>

        <Section id="catalog" title="Teams, tools, tiers and languages">
          <p>Processes do not type these in; they pick them from shared lists, so a team is spelled the same everywhere and renaming it once renames it in every process.</p>
          <dl className="guide-dl">
            <div><dt><Layers size={14} />Tiers</dt><dd>A process applies to every application tier, or only to the ones selected in its details. The library filter “My application is…” hides processes that do not apply to you.</dd></div>
            <div><dt>Languages</dt><dd>Most processes do not depend on the programming language. Some do, such as publishing a Go module or an npm package; those name their languages, and the library filter “written in…” hides the rest.</dd></div>
            <div><dt>Teams</dt><dd>A team can own a process and can be added as a participant, which gives it a lane.</dd></div>
            <div><dt>Tools</dt><dd>A step picks its tool from the list. Editors can add a missing tool straight from that picker.</dd></div>
          </dl>
          <p>An entry that is still used by a process cannot be removed; its page lists the processes that use it.</p>
        </Section>

        <Section id="feedback" title="Feedback">
          <p>When a step does not work, say so where you are: <Flag size={13} /> “This step doesn’t work” in the step panel, the flag on a checklist step, or “Report a problem” for the whole process. Pick a kind, write a sentence, send.</p>
          <Chart process={feedbackFlow} caption="A reported problem stays visible on the step until the owner marks it as fixed." />
        </Section>

        <Section id="lifecycle" title="Life-cycle and reviews">
          <p>A description that nobody checks goes stale. Every process therefore has a status and a review rhythm, both set in Details.</p>
          <dl className="guide-dl">
            <div><dt>Draft</dt><dd>Being written. Only editors see it. New processes, including those created with AI, start here.</dd></div>
            <div><dt>Active</dt><dd>In use and visible to everyone. The owner is asked to review it every 3, 6, 12 or 24 months.</dd></div>
            <div><dt>Retired</dt><dd>No longer the way to do it. It stays for reference, greyed out, and can point to the process that replaces it.</dd></div>
          </dl>
          <Chart process={reviewFlow} caption="The review cycle of an active process. “Mark as reviewed” records the date and who confirmed it." />
          <p><CalendarCheck size={13} /> In Editor mode the library shows how many processes need a review, and each of them carries a badge. From the command line, <code>npm run reviews</code> lists what is overdue or due within 30 days, grouped by owner team with its contact, and exits with an error when something is overdue. A scheduled job can use that to remind the owners.</p>
        </Section>

        <Section id="agents" title="For agents: MCP">
          <p>The same knowledge is meant for people and for AI agents. People use this app. Agents will use an <b>MCP server</b> (Model Context Protocol) that serves the same files. The server is <b>not built yet</b>; the contract below is the plan, described in full in <code>docs/mcp.md</code>.</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>search_processes</code></td><td>Find processes by words, application tier and language. Returns only active ones.</td></tr>
              <tr><td><code>get_process</code></td><td>The full process: prerequisites, participants, steps, links and skills.</td></tr>
              <tr><td><code>get_my_steps</code></td><td>Only the steps of one participant, in order, with exact actions. What an agent acting for you needs.</td></tr>
              <tr><td><code>get_catalog</code></td><td>Teams with contacts, tools with links, tiers and languages.</td></tr>
              <tr><td><code>report_problem</code></td><td>File feedback on a step, the same as the flag in the app.</td></tr>
            </tbody>
          </table>
          <p>Until then an agent with access to the repository can read <code>processes/*.json</code> directly; the schema in <code>schema/</code> tells it what every field means.</p>
        </Section>

        <Section id="roadmap" title="Planned: automation">
          <p>Today a person follows the checklist. The next stage is an agent that follows it for you: it looks the process up over MCP, does your steps with the linked skills, asks you to approve, and tracks the steps of other teams. Nothing in this section exists yet.</p>
          <Chart process={automationFlow} caption="Planned, not built: an AI agent follows the process on your behalf. You stay in control of approvals." />
          <p>This is why steps name their participant, tool and kind precisely, and why skills are linked to the step they perform: the description is already written for a machine to act on.</p>
        </Section>

        <Section id="files" title="Files, schema and checker">
          <p>Everything is a plain file in the repository, so it can be reviewed and versioned like code.</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>processes/&lt;id&gt;.json</code></td><td>One process per file</td></tr>
              <tr><td><code>catalog/catalog.json</code></td><td>Teams, tools, tiers and languages</td></tr>
              <tr><td><code>feedback/&lt;id&gt;.json</code></td><td>Feedback for one process</td></tr>
              <tr><td><code>schema/*.schema.json</code></td><td>The formats (JSON Schema)</td></tr>
              <tr><td><code>docs/llm-prompt.md</code></td><td>The AI prompt as a shareable file</td></tr>
              <tr><td><code>docs/mcp.md</code></td><td>Planned MCP contract for agents</td></tr>
              <tr><td><code>.claude/skills/</code></td><td>Instructions for AI coding assistants: <code>edit-process</code>, <code>manage-catalog</code></td></tr>
            </tbody>
          </table>
          <p>The checker runs in the app on every change and from the command line with <code>npm run validate</code>. Beyond the schema it catches steps that point nowhere, unknown participants, decisions without labelled branches, missing sub-processes, unknown tiers or languages, and steps that can never be reached.</p>
          <p className="muted"><Sparkles size={13} /> The flow charts on this page are themselves processes, drawn by the same map.</p>
        </Section>
      </article>
    </div>
  );
}
