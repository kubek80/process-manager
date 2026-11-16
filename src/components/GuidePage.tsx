import { useEffect, useState, type ReactNode } from "react";
import { Bot, Braces, CalendarCheck, Check, Eye, Flag, History, KeyRound, List, ShieldCheck, GripVertical, Layers, ListChecks, MousePointerClick, Pencil, Plus, Sparkles, Workflow } from "lucide-react";
import type { Process } from "../types";
import { STEP_META, STEP_TYPES } from "../lib/stepMeta";
import { aiFlow, automationFlow, feedbackFlow, followFlow, reviewFlow, signInFlow, standardFlow, versionFlow } from "../guide/flows";
import { FlowView } from "./FlowView";
import { scrollBehavior, TypeIcon } from "./ui";

const GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "Using it", items: [
    ["what", "What it is"],
    ["modes", "Signing in and your rights"],
    ["read", "Reading a process"],
    ["follow", "Following a process"],
    ["blocks", "The building blocks"],
    ["standards", "Reading a standard"],
    ["feedback", "Feedback"],
    ["mine", "Your responsibilities"],
  ] },
  { title: "Editing", items: [
    ["edit", "Editing a process"],
    ["editstandard", "Editing a standard"],
    ["versions", "Versions, undo and working together"],
    ["ai", "Creating one with AI"],
    ["lifecycle", "Life-cycle and reviews"],
  ] },
  { title: "For AI assistants", items: [
    ["skills", "Skills and review agents"],
    ["agents", "For agents: MCP"],
    ["roadmap", "Planned: automation"],
  ] },
  { title: "Administration", items: [
    ["admin", "The Admin panel"],
    ["catalog", "The lists"],
  ] },
  { title: "Running it", items: [
    ["architecture", "How it is built"],
    ["local", "Running it locally"],
    ["tests", "Tests"],
    ["deploy", "Deploying"],
    ["files", "Files, schema and checker"],
    ["docs", "Keeping this guide current"],
  ] },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);

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
  const jump = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });

  return (
    <div className="page guide">
      <aside className="guide-toc">
        {GROUPS.map((g) => (
          <div key={g.title} className="guide-toc-group">
            <span className="eyebrow">{g.title}</span>
            {g.items.map(([id, title]) => (
              <button key={id} className={active === id ? "on" : ""} onClick={() => jump(id)}>{title}</button>
            ))}
          </div>
        ))}
      </aside>

      <article className="guide-body">
        <header className="guide-hero">
          <h1>How Process Manager works</h1>
          <p className="lead">One place for two questions. “How do I get a GCP project, a repository, an Akamai onboarding?” is answered by a <b>process</b>. “What must my application meet?” is answered by a <b>standard</b>. Both are written once, for people and for AI assistants.</p>
        </header>

        <Section id="what" title="What it is">
          <div className="guide-cards three">
            <div><Workflow size={20} /><h3>Processes</h3><p>Who does what, in which order. Read as a map with one lane per participant, your lane first, or as your own checklist with the exact actions.</p></div>
            <div><ShieldCheck size={20} /><h3>Standards</h3><p>Rules set by cyber security, platform owners and practices. Each requirement says what must be true, why, how to comply and how it is checked.</p></div>
            <div><Bot size={20} /><h3>Skills for AI assistants</h3><p>From every process and standard the portal generates instructions an AI coding assistant can follow, and for standards a reviewer for pull requests.</p></div>
          </div>
          <p>Processes and standards share the same ground: an owner, a life-cycle with regular reviews, feedback from readers, and the tiers, environments and languages they apply to.</p>
        </Section>

        <Section id="modes" title="Signing in and your rights">
          <p>You sign in with your company account, through Entra ID or Google depending on how the app was set up. The app never sees your password; it only learns your name and email.</p>
          <Chart process={signInFlow} caption="Signing in. Your rights are looked up on every request, so a change to them applies at once." />
          <p>Everyone who can sign in can read everything that is published, tick steps, and give feedback. A <b>role</b> adds more. Roles are given by an admin in the Admin panel; open your account menu (top right) to see yours.</p>
          <table className="guide-table roles">
            <thead><tr><th>Role</th><th>Adds</th><th>Limited to</th></tr></thead>
            <tbody>
              <tr><td><b>Owner</b></td><td>Confirm reviews; mark feedback as fixed, reopen or delete it; see drafts</td><td>What one team or unit owns</td></tr>
              <tr><td><b>Process editor</b></td><td>Create and change processes; close their feedback</td><td>All processes</td></tr>
              <tr><td><b>Standards editor</b></td><td>Create and change standards; close their feedback</td><td>One unit, or all units</td></tr>
              <tr><td><b>Lists manager</b></td><td>Teams, tools, tiers, environments and languages</td><td>—</td></tr>
              <tr><td><b>Admin</b></td><td>Everything, including who has which role</td><td>—</td></tr>
            </tbody>
          </table>
          <p><b>Signing out</b> ends your session everywhere, not only in this browser. A session also ends by itself after some hours. If that happens while a page is open, the page stays as it is, with anything you were editing, and asks you to sign in again in another tab.</p>
          <p>People who can edit get a switch in the top bar, <b>Consumer</b> and <b>Editor</b>, to turn the editing controls on and off. The server checks the same rights on every change, so a hidden button is never the only protection.</p>
          <div className="guide-cards two">
            <div className="mode-card">
              <h3><Eye size={18} />Consumer</h3>
              <p>For people who need something done or need to know the rules.</p>
              <ul>
                <li><Check size={14} />Find processes and standards, filtered to your application</li>
                <li><Check size={14} />Read the map, follow the checklist, read the requirements</li>
                <li><Check size={14} />Tick prerequisites and steps (kept in your browser)</li>
                <li><Check size={14} />Flag what does not work, or say “I hit this too”</li>
                <li><Check size={14} />See every earlier version and what changed</li>
                <li><Check size={14} />Read and download the generated skills</li>
              </ul>
            </div>
            <div className="mode-card editor">
              <h3><Pencil size={18} />Editor</h3>
              <p>For process owners, business analysts and the units that issue standards. Everything a consumer has, plus, for what your role covers:</p>
              <ul>
                <li><Check size={14} />Create processes and standards, blank or from text with AI</li>
                <li><Check size={14} />Change steps on the map and in the checklist; change requirements</li>
                <li><Check size={14} />Details: owner, where it applies, life-cycle, links</li>
                <li><Check size={14} />Undo, and bring back any earlier version</li>
                <li><Check size={14} />The raw JSON in a code editor</li>
                <li><Check size={14} />Extra guidance for the generated skills</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="read" title="Reading a process">
          <p>Open a process from the library. The header tells you which <b>application tiers</b>, <b>environments</b> and <b>programming languages</b> it applies to, who owns it, how long it usually takes and when it was last reviewed. Use “My application” in the library to hide what does not apply to you; your choice is remembered. The header also shows the <b>version</b>: press it to see who changed what and when. Below the header:</p>
          <dl className="guide-dl">
            <div><dt>Before you start</dt><dd>The prerequisites, useful links and the standards the process helps to meet. On the map this is one line that opens when you press it, so the map itself is on the first screen; the checklist shows it in full. Tick what you already have. If a prerequisite is itself a process, a link takes you there.</dd></div>
            <div><dt>Map</dt><dd>Time runs left to right, each lane is one participant. Dashed arrows loop back, for example after a rejection. Click a block to open its details on the right.</dd></div>
            <div><dt>Checklist</dt><dd>Steps in order. Yours show the exact actions, the link to open and what you get at the end. Steps of others are collapsed so you know what you are waiting for. “Only my steps” hides them.</dd></div>
            <div><dt>A link to one step</dt><dd>Opening a step changes the address in your browser. Copy it to send someone straight to that step. The Back button closes the step again.</dd></div>
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

        <Section id="standards" title="Reading a standard">
          <p>A standard is a list of requirements issued by a unit: cyber security, a platform owner or a practice. Open one from <b>Standards</b> in the top bar.</p>
          <dl className="guide-dl">
            <div><dt>Must, should, may</dt><dd><b>Must</b> is mandatory; deviating needs an exception from the unit. <b>Should</b> is expected unless you have a good reason. <b>May</b> is optional good practice.</dd></div>
            <div><dt>Each requirement</dt><dd>An id people and tools cite (such as SEC-LOG-01), the rule in a sentence, why it exists, how to comply, good and bad examples, and how it is checked: automatically, in code review, or by a person.</dd></div>
            <div><dt>My application</dt><dd>Choose your tier, environment and language. Requirements that do not apply to you are folded away, and the counts follow. The choice is remembered for every list and every standard.</dd></div>
            <div><dt>A link to one requirement</dt><dd>Opening a requirement changes the address in your browser. Copy it to point someone at exactly that rule.</dd></div>
            <div><dt>What reviewers look for</dt><dd>The concrete signs of a violation in a pull request. The review agent generated from the standard checks exactly these.</dd></div>
            <div><dt>Exceptions and help</dt><dd>The top of the page says how to ask for an exception and lists the processes that help you comply.</dd></div>
          </dl>
        </Section>

        <Section id="feedback" title="Feedback">
          <p>When a step does not work or a requirement is wrong or unclear, say so where you are: <Flag size={13} /> on the step or the requirement, or “Report a problem” for the whole process or standard. Pick a kind, write a sentence, send. Your name comes from your sign-in.</p>
          <Chart process={feedbackFlow} caption="A reported problem stays visible on the step until the owner marks it as fixed. Standards work the same way, per requirement." />
          <dl className="guide-dl">
            <div><dt>I hit this too</dt><dd>If someone already reported your problem, add yourself with one click. The count tells the owner what to fix first.</dd></div>
            <div><dt>Who can close it</dt><dd>Whoever may edit the process or standard, and people with the Owner role for the team or unit that owns it. The reporter is told when it is marked as fixed.</dd></div>
            <div><dt>May already be fixed</dt><dd>When a step or requirement is changed after feedback was written about it, the feedback says so. Owners can then close old items quickly.</dd></div>
          </dl>
        </Section>

        <Section id="mine" title="Your responsibilities">
          <p>If you are <b>Owner</b> for a team or unit, or edit the standards of a unit, the top bar has <b>My responsibilities</b>. The number next to it is what is waiting for you: reviews that are overdue and feedback nobody has dealt with.</p>
          <dl className="guide-dl">
            <div><dt><CalendarCheck size={14} />Reviews to do</dt><dd>What is overdue or due within a month, the most overdue first. Read it; if it is still right, press <b>Still correct</b>. That records today and your name, as a version of its own. You do not have to be an editor for this: the review belongs to the team that owns the thing. If something has to change, change it (or ask an editor), then confirm.</dd></div>
            <div><dt><Flag size={14} />Feedback waiting for you</dt><dd>Every open item on what your teams own, the oldest first: what was said, about which step or requirement, by whom, and how many others hit the same. <b>Mark as fixed</b> closes it and tells the person who reported it.</dd></div>
            <div><dt>Unfinished</dt><dd>Drafts that were never published, and things in use that nobody is asked to review because they have no review rhythm.</dd></div>
            <div><dt>Everything that is yours</dt><dd>Every process and standard of your teams and units with its status, its next review, its open feedback, and its version with who changed it last.</dd></div>
          </dl>
          <p>“Mark as reviewed” on a process or standard does the same from its own page. If somebody changed it after you opened it, the review is not recorded: you are shown the current version first, so nobody confirms what they have not read.</p>
        </Section>

        <Section id="edit" title="Editing a process">
          <p>Switch to <b>Editor</b>. Changes go into a draft; nothing is published until you press <b>Save changes</b>, and saving is blocked while the checker reports a problem. A save takes effect for everyone at once. A new process starts with its name: the name gives it its address, which never changes afterwards, and it starts as a draft that only editors see.</p>
          <div className="guide-cards three">
            <div><Plus size={20} /><h3>Insert on an arrow</h3><p>Press the small + on an arrow of the map (it appears when you point at the map; on a touch screen it is always there). A form appears right there: what happens, who does it, what kind. The step lands exactly between the two blocks. A new decision starts with a “Yes” and a “No” path.</p></div>
            <div><GripVertical size={20} /><h3>Drag between lanes</h3><p>Drag a block to another lane to change who does it. The + on a block adds a step after it; on a decision it adds a branch.</p></div>
            <div><ListChecks size={20} /><h3>Insert in the checklist</h3><p>The checklist works the same way: press “Insert a step here” between two steps. Use it when you think in order rather than in lanes.</p></div>
            <div><MousePointerClick size={20} /><h3>Click for the rest</h3><p>“Edit step” in the side panel holds the exact actions, tool, link, result, sub-process and what comes next. “Details” holds name, owner, where it applies, the standards it helps to meet, participants and prerequisites.</p></div>
          </div>
        </Section>

        <Section id="editstandard" title="Editing a standard">
          <p>You can edit the standards of the units your role covers. Press the pencil on a requirement, or <b>Add requirement</b>; the new one continues the numbering.</p>
          <dl className="guide-dl">
            <div><dt>The rule</dt><dd>One testable sentence or two, the level, the reason, how to comply, and examples. Keep the id stable: people and tools cite it. A changed id is taken over when you leave the field, and refused with a message if another requirement has it.</dd></div>
            <div><dt>How it is checked</dt><dd>Automatically, in code review, or by a person, and by what.</dd></div>
            <div><dt>For reviewers</dt><dd>The signs of a violation in a pull request, the files where it matters (one pattern per row), and how a finding is reported: blocker, warning or info. Leave it empty for rules that cannot be seen in a change. This is what the review agent is built from.</dd></div>
            <div><dt>Applies only to</dt><dd>A requirement can be narrower than its standard, for example “production only”.</dd></div>
            <div><dt>Details</dt><dd>The unit that issues it, scope, where it applies, the process for exceptions, and background links.</dd></div>
          </dl>
        </Section>

        <Section id="versions" title="Versions, undo and working together">
          <p>Every save is a <b>version</b>: numbered, with who saved it, when, and the note they left. Nothing is ever overwritten without a trace, and nothing you typed is dropped without asking.</p>
          <dl className="guide-dl">
            <div><dt><History size={14} />Versions</dt><dd>The header shows the version. Press it for the list: every version with its note. <b>What changed</b> compares a version with the one before it, in words: which steps or requirements were added, removed or changed. Everyone who can read a process or standard can see this; editors can also <b>Restore</b> a version into their draft and save it as the newest.</dd></div>
            <div><dt>Say what changed</dt><dd>Next to <b>Save changes</b> there is room for a short note, such as “New approval step after the audit”. It is optional and worth the ten seconds: it is what others read in the list of versions.</dd></div>
            <div><dt>Undo</dt><dd>Every change to a draft can be undone and redone with the arrows next to Save or with Ctrl+Z and Ctrl+Shift+Z: a deleted step, a block dragged to the wrong lane, a result pasted from the AI dialog, even <b>Discard</b>. Each action is a step of its own; typing in one field counts as one step until you pause.</dd></div>
            <div><dt>Leaving</dt><dd>With unsaved changes, every way out asks first: another page, the Back button, signing out, closing the tab. Moving between the tabs and steps of what you are editing keeps the changes. Text in the JSON tab that still has problems is not part of the draft, so leaving that tab asks too.</dd></div>
            <div><dt>Somebody else saved first</dt><dd>If a colleague saved while you were editing, your save is not carried out. You are shown what they changed and choose: continue from their version (your own changes stay one Undo away), or save yours as the newest (theirs stays in the list of versions). The lists are protected the same way; there you are told who saved, without the comparison.</dd></div>
            <div><dt>Somebody else deleted it</dt><dd>If what you are editing is deleted by somebody else, it stays on your screen. Saving then tells you, and asks whether to bring it back with your version. Deleting works on the version you are looking at: if somebody changed it since, it is not deleted.</dd></div>
            <div><dt>Up to date</dt><dd>When you come back to the tab, the portal fetches what others changed in the meantime. If you have unsaved changes they are kept, and a notice tells you that there is a newer version.</dd></div>
          </dl>
          <Chart process={versionFlow} caption="A save is only carried out on top of the newest version. Otherwise you compare and decide; either way both versions are kept." />
        </Section>

        <Section id="ai" title="Creating one with AI">
          <p>You do not need a particular AI product. The app builds one self-contained prompt that works in any chat assistant you are allowed to use, such as Gemini or Copilot in the browser, and checks whatever comes back. Nothing is sent anywhere by the app itself. This works for processes and for standards.</p>
          <Chart process={aiFlow} caption="From free text to a checked process. If the answer has problems, the app writes the fix request for you to send to the same chat. Afterwards you review and adjust." />
          <p>The prompt contains the modelling rules, the JSON schema, your current lists, what already exists (so it can be linked) and one worked example. “Change with AI” on a page works the same way and adds the current content to the prompt; the result replaces your draft and can be undone.</p>
          <p>Whatever is created this way starts as a draft that only editors see, whatever the answer of the assistant says, and never replaces something that exists: if the name is taken, the new one is created next to it.</p>
        </Section>

        <Section id="lifecycle" title="Life-cycle and reviews">
          <p>A description that nobody checks goes stale. Every process and every standard therefore has a status and a review rhythm, both set in Details.</p>
          <dl className="guide-dl">
            <div><dt>Draft</dt><dd>Being written. Only the people who can edit it and the team or unit that owns it get to see it: for everyone else it does not exist, not in the lists and not by its link. No skill is generated. New processes and standards start here.</dd></div>
            <div><dt>Active</dt><dd>In use and visible to everyone. The owner is asked to review it every 3, 6, 12 or 24 months.</dd></div>
            <div><dt>Retired</dt><dd>No longer the way to do it. It stays for reference, greyed out, and can point to what replaces it. Its skills are withdrawn.</dd></div>
          </dl>
          <Chart process={reviewFlow} caption="The review cycle of an active process or standard. “Mark as reviewed” records the date and who confirmed it." />
          <p><CalendarCheck size={13} /> Owners find what is due under <b>My responsibilities</b>. In Editor mode the library shows what needs a review, and <b>Admin › Health</b> lists everything that is due, for all teams.</p>
          <p>“Mark as reviewed” on something without other changes is saved at once, as a version of its own with the note “Reviewed: confirmed as still correct” and the date of the day. The team or unit that owns it can do this as well as its editors; see <b>Your responsibilities</b>.</p>
        </Section>

        <Section id="skills" title="Skills and review agents">
          <p>The portal turns what it knows into instructions for AI coding assistants. They are generated by fixed templates, not by AI, so the same source always gives the same text.</p>
          <dl className="guide-dl">
            <div><dt>Process skill</dt><dd>“Follow this process for a person”: the prerequisites, your steps with the exact actions, what to wait for from others. It tells the assistant never to approve anything and to ask before it submits.</dd></div>
            <div><dt>Standard skill</dt><dd>How to write code and configuration that complies: every requirement with its reason, how to comply and examples.</dd></div>
            <div><dt>Review agent</dt><dd>A reviewer for pull requests: what to look for per requirement, in which files, how severe a finding is, and how to report it with the requirement id.</dd></div>
          </dl>
          <Chart process={standardFlow} caption="A rule written once reaches the code twice: as guidance while writing, and as a check when reviewing." />
          <dl className="guide-dl">
            <div><dt>Always current</dt><dd>Saving a process or standard produces a new version of its skills. Each version is numbered and names the version of the process or standard it was made from, so a repository holding an old copy can tell. Skills that mention another process or standard follow it too: when that one is renamed they get the new name, and when it is retired or deleted they stop pointing at its skill.</dd></div>
            <div><dt>Where to find them</dt><dd>The <b>Skill</b> or <b>Skills</b> tab of a process or standard, and <b>Admin › Skills</b> for all of them. Copy or download; the page shows where the file belongs in a repository.</dd></div>
            <div><dt>Extra guidance</dt><dd>Editors can add hand-written notes to a skill, for example an exemption. They are added to every new version and survive changes of the source.</dd></div>
            <div><dt>Links to other skills</dt><dd>A process or a step can also link to skills kept elsewhere, such as one that updates an infrastructure repository. Those are shown under “Do it faster”.</dd></div>
          </dl>
          <p>The generated files follow the Claude Code layout: skills under <code>.claude/skills/</code>, review agents under <code>.claude/agents/</code>.</p>
        </Section>

        <Section id="agents" title="For agents: MCP">
          <p>The same knowledge is meant for people and for AI agents. People use this app. Agents will use an <b>MCP server</b> (Model Context Protocol) on top of the same content. The server is <b>not built yet</b>; the contract below is the plan, described in full in <code>docs/mcp.md</code>.</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>search_processes</code>, <code>search_standards</code></td><td>Find what applies, by words, tier, environment and language. Only what is active.</td></tr>
              <tr><td><code>get_process</code>, <code>get_standard</code></td><td>The full content, with names and contacts resolved.</td></tr>
              <tr><td><code>get_my_steps</code></td><td>Only the steps of one participant, in order, with exact actions.</td></tr>
              <tr><td><code>get_skill</code></td><td>The latest version of a generated skill or review agent.</td></tr>
              <tr><td><code>get_catalog</code></td><td>Teams with contacts, tools with links, tiers, environments and languages.</td></tr>
              <tr><td><code>report_problem</code></td><td>File feedback on a step or a requirement, the same as the flag in the app.</td></tr>
            </tbody>
          </table>
          <p>Until then, the generated skills are the way to give an assistant this knowledge: put them in the repository it works in.</p>
        </Section>

        <Section id="roadmap" title="Planned: automation">
          <p>Today a person follows the checklist. The next stage is an agent that follows it for you: it looks the process up over MCP, does your steps with the linked skills, asks you to approve, and tracks the steps of other teams. Nothing in this section exists yet.</p>
          <Chart process={automationFlow} caption="Planned, not built: an AI agent follows the process on your behalf. You stay in control of approvals." />
          <p>This is why steps name their participant, tool and kind precisely, and why skills are generated from the same content: the description is already written for a machine to act on.</p>
        </Section>

        <Section id="admin" title="The Admin panel">
          <p><b>Admin</b> in the top bar is where everything is configured. Admins see all of it; people who manage the lists see Lists, Skills and Health.</p>
          <dl className="guide-dl">
            <div><dt><KeyRound size={14} />Access</dt><dd>Who has which role. Give a role by email, optionally limited to one team or unit; remove it with one click. A change applies on the person’s next click, without signing in again.</dd></div>
            <div><dt><List size={14} />Lists</dt><dd>Teams and units, tools, tiers, environments and languages.</dd></div>
            <div><dt><Bot size={14} />Skills</dt><dd>Every generated skill and review agent, with its versions and extra guidance.</dd></div>
            <div><dt><CalendarCheck size={14} />Health</dt><dd>Reviews that are due, open feedback, drafts that were never published, and active documents without an owner or a review rhythm.</dd></div>
            <div><dt>Activity</dt><dd>Who changed what and when: content with the version and its note, lists, roles, skills, and feedback that was closed, reopened or deleted by someone other than its author. The newest entries come first; “Show older” goes back as far as the log does.</dd></div>
            <div><dt>System</dt><dd>How this installation signs people in and where it sends notifications. These are set where the server runs, not here.</dd></div>
          </dl>
          <p>The people named as admins in the server settings always have access and cannot be removed in the panel, so nobody can lock everyone out. Among the others, the last admin cannot be removed.</p>
        </Section>

        <Section id="catalog" title="The lists">
          <p>Processes and standards do not type these in; they pick them from shared lists, so a team is spelled the same everywhere and renaming it once renames it everywhere. Everyone can look them up under <b>Teams &amp; tools</b>; they are changed in <b>Admin › Lists</b>.</p>
          <dl className="guide-dl">
            <div><dt>Teams and units</dt><dd>A team owns processes and takes part in them, which gives it a lane. A <b>unit</b> is a team of the kind cyber security, platform owner or practice: only units issue standards.</dd></div>
            <div><dt>Tools</dt><dd>A step picks its tool from the list. Editors who manage the lists can add a missing tool straight from that picker.</dd></div>
            <div><dt><Layers size={14} />Tiers</dt><dd>How critical an application is. A process or standard applies to every tier or to chosen ones.</dd></div>
            <div><dt>Environments</dt><dd>Where things run, such as test or production. A requirement can apply to production only.</dd></div>
            <div><dt>Languages</dt><dd>Most content does not depend on the programming language. Some does, such as publishing a Go module.</dd></div>
          </dl>
          <p>An entry that is still used cannot be removed; its page lists the processes and standards that use it. A team that a role is limited to cannot be removed either. The lists have versions like everything else, and two people changing them at once are told about each other.</p>
        </Section>

        <Section id="architecture" title="How it is built">
          <p>Everything people change in the portal lives in a database: processes, standards, the lists, roles, feedback and the generated skills. A small server signs people in, decides what they may do, keeps every version, and regenerates the skills when their source changes.</p>
          <figure className="guide-fig">
            <div className="arch">
              <div className="arch-col">
                <div className="arch-box who"><strong>People</strong><span>in a browser</span></div>
                <div className="arch-box who planned"><strong>AI agents</strong><span>over MCP, planned</span></div>
              </div>
              <div className="arch-arrow" aria-hidden="true">→</div>
              <div className="arch-col">
                <div className="arch-group">
                  <em>One container</em>
                  <div className="arch-box core"><strong>The app</strong><span>built, static files</span></div>
                  <div className="arch-box core"><strong>Go server</strong><span>sign-in, roles, content, skills, feedback</span></div>
                </div>
              </div>
              <div className="arch-arrow" aria-hidden="true">→</div>
              <div className="arch-col">
                <div className="arch-box ext"><strong>Postgres</strong><span>content with every version, roles, feedback, skills, activity</span></div>
                <div className="arch-box ext"><strong>Entra ID or Google</strong><span>sign-in</span></div>
                <div className="arch-box ext"><strong>Team channel</strong><span>notifications, optional</span></div>
                <div className="arch-box ext planned"><strong>Files in git</strong><span>first fill, import, export and backup</span></div>
              </div>
            </div>
            <figcaption>What runs where. A change saved in the portal is live at once; no deployment is involved.</figcaption>
          </figure>
          <dl className="guide-dl">
            <div><dt>In the database</dt><dd>All content and its history, roles, feedback, generated skills and the activity log.</dd></div>
            <div><dt>In the repository</dt><dd>The code, the formats (<code>schema/</code>), and sample content that fills an empty database on its first start.</dd></div>
            <div><dt>Import and export</dt><dd><code>npm run export -- &lt;folder&gt;</code> writes the content and the skills to files, as a backup or to commit. <code>npm run db:import</code> loads the files of the repository over what is stored; files that do not match the format are reported and skipped. An export also removes the files of skills that were withdrawn.</dd></div>
            <div><dt>Two checks</dt><dd>The app checks a document fully before it lets you save. The server checks again: the rights, the format, that the parts of the document fit together (every step leads to a step that exists, every tier is in the lists), and that the save was made from the newest version. Nothing invalid, unauthorised or outdated is stored.</dd></div>
            <div><dt>Protection in the browser</dt><dd>The server tells the browser to run only the app’s own code and never to show the app inside another page. For that reason the format checks are not built in the browser but generated from the schemas beforehand (<code>npm run validators</code>).</dd></div>
          </dl>
        </Section>

        <Section id="local" title="Running it locally">
          <p>You need Node 22, Go 1.26 and Docker. One command starts everything: a Postgres container, the server (rebuilt when you change its code) and the app with live reload. An empty database is filled with the sample content of the repository.</p>
          <pre className="guide-code">npm install{"\n"}npm run dev</pre>
          <p>Open <code>http://localhost:5173</code>. Instead of a company sign-in you choose who to be, so you can try each set of rights:</p>
          <dl className="guide-dl">
            <div><dt>Sam Consumer</dt><dd>Reads, follows and reports problems.</dd></div>
            <div><dt>Alex Editor</dt><dd>Edits processes and manages the lists.</dd></div>
            <div><dt>Casey Owner</dt><dd>Owner for the Cloud Platform team: closes feedback on what it owns.</dd></div>
            <div><dt>Riley Security</dt><dd>Edits the standards of Cyber Security.</dd></div>
            <div><dt>Dana Admin</dt><dd>Admin: everything, including who has which role.</dd></div>
          </dl>
          <p>Choosing who to be only works on your own machine: the server refuses to start this way on an address that others can reach.</p>
          <p><code>npm run db:reset</code> empties the feedback and adds the samples again. To use a Postgres you already run instead of Docker, set <code>PM_PG</code>, for example <code>PM_PG=postgres://pm:pm@localhost:5432</code>.</p>
        </Section>

        <Section id="tests" title="Tests">
          <p>Every level is tested, and <code>npm run test:all</code> runs all of it. The same runs on every pull request.</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>npm test</code></td><td>The logic of the app: both checkers, editing, undo and the rules for saving, comparing versions, map layout, review dates, the AI prompts, rights, and that every sample file in the repository is valid.</td></tr>
              <tr><td><code>npm run test:server</code></td><td>The server against a real Postgres: sign-in (with a stand-in for Entra and Google that signs real tokens), roles, content with versions and saves at the same time, the skill generators, feedback, the Admin endpoints, starting and stopping.</td></tr>
              <tr><td><code>npm run test:e2e</code></td><td>A real browser against the real server and database: signing in, following a process, reading a standard, editing both, versions and two people editing at once, feedback, the Admin panel, skills, AI import.</td></tr>
              <tr><td><code>npm run validate</code></td><td>The sample files, or a folder written by <code>npm run export</code>, against the schemas and the rules.</td></tr>
            </tbody>
          </table>
          <p>The browser tests run on their own database, emptied and refilled at the start of every run.</p>
        </Section>

        <Section id="deploy" title="Deploying">
          <p>The <code>Dockerfile</code> builds one container with the server, the app and the sample content. It needs a Postgres database and a few settings:</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>DATABASE_URL</code></td><td>Where the Postgres database is.</td></tr>
              <tr><td><code>PM_AUTH</code></td><td><code>entra</code> or <code>google</code>. There is no default, so a deployment cannot fall back to the local user picker by accident.</td></tr>
              <tr><td><code>PM_ADMINS</code></td><td>Emails of the first admins. They give everyone else their roles in the Admin panel.</td></tr>
              <tr><td><code>PM_BASE_URL</code></td><td>The public address, starting with <code>https://</code>. Register <code>&lt;address&gt;/auth/callback</code> with Entra or Google.</td></tr>
              <tr><td><code>PM_OIDC_CLIENT_ID</code>, <code>PM_OIDC_CLIENT_SECRET</code></td><td>The app registration.</td></tr>
              <tr><td><code>PM_ENTRA_TENANT</code></td><td>Entra ID: your tenant.</td></tr>
              <tr><td><code>PM_GOOGLE_HOSTED_DOMAIN</code></td><td>Google: your Workspace domain. Without a limit any Google account could sign in, so the server does not start with Google unless this or the next setting is given.</td></tr>
              <tr><td><code>PM_ALLOWED_EMAIL_DOMAINS</code></td><td>Optional, for either provider: only addresses of these domains may sign in.</td></tr>
              <tr><td><code>PM_SESSION_SECRET</code></td><td>At least 32 random characters, for example from <code>openssl rand -base64 48</code>. A placeholder is refused.</td></tr>
              <tr><td><code>PM_NOTIFY</code>, <code>PM_NOTIFY_WEBHOOK_URL</code></td><td>Optional: send notifications to a chat webhook instead of the server log.</td></tr>
              <tr><td><code>PM_LOG_FORMAT</code></td><td>Optional: <code>json</code> for one JSON object per log line.</td></tr>
            </tbody>
          </table>
          <p>The server answers <code>/healthz</code> when it runs and <code>/readyz</code> when it can also reach the database; use the second to decide whether it gets traffic. Several copies can start at the same time, also on an empty database. When it is asked to stop it finishes the requests it is answering first.</p>
          <p>On its first start with an empty database the server loads the sample content from the container; after that the database is the only source, and a new version of the container never overwrites it. The full list of settings, the API and the rights are in <code>docs/backend.md</code>; a template is in <code>.env.example</code>.</p>
        </Section>

        <Section id="files" title="Files, schema and checker">
          <p>The formats are defined once, as JSON Schema, and used by the app, the server and the command line.</p>
          <table className="guide-table">
            <tbody>
              <tr><td><code>schema/*.schema.json</code></td><td>The formats of a process, a standard and the lists</td></tr>
              <tr><td><code>src/lib/validators.generated.js</code></td><td>The checks the app runs, generated from the schemas. After changing a schema run <code>npm run validators</code>; a test fails when it was forgotten</td></tr>
              <tr><td><code>processes/</code>, <code>standards/</code>, <code>catalog/</code></td><td>Sample content that fills an empty database; also the layout of an export</td></tr>
              <tr><td><code>docs/llm-prompt.md</code>, <code>docs/llm-prompt-standards.md</code></td><td>The AI prompts as shareable files</td></tr>
              <tr><td><code>docs/backend.md</code></td><td>The server: API, settings, rights, database</td></tr>
              <tr><td><code>docs/mcp.md</code></td><td>Planned MCP contract for agents</td></tr>
              <tr><td><code>server/</code></td><td>The backend</td></tr>
              <tr><td><code>.claude/skills/</code></td><td>Instructions for AI coding assistants working on this repository</td></tr>
            </tbody>
          </table>
          <p>The checker runs in the app on every change and from the command line with <code>npm run validate</code>. Beyond the schema it catches, for a process: steps that point nowhere, unknown participants, decisions without labelled branches, missing sub-processes, and steps that can never be reached. For a standard: duplicate requirement ids, an owner that is not a unit, a requirement wider than its standard, and rules checked in review that give reviewers nothing to look for.</p>
        </Section>

        <Section id="docs" title="Keeping this guide current">
          <p>This guide is part of the app’s code (<code>src/components/GuidePage.tsx</code>, with the flow charts in <code>src/guide/flows.ts</code>), so it is changed in the same commit as the feature it describes. An instruction for AI coding assistants, the <code>update-docs</code> skill, makes that the last step of every task that changes code.</p>
          <p className="muted"><Sparkles size={13} /> The flow charts on this page are themselves processes, drawn by the same map.</p>
        </Section>
      </article>
    </div>
  );
}
