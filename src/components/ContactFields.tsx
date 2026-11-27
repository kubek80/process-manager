import { useState } from "react";
import type { Contacts } from "../types";
import { CONTACT_LABEL, CONTACT_MAX, contactProblems, DESCRIPTION_MAX, LINK_KEYS, OTHER_LABEL, OTHER_MAX, withScheme } from "../lib/groups";
import type { GroupKind } from "../lib/members";

/** What the fields change: the description, the free line and the contact details of one group. */
export interface DetailsValue { description?: string; contact?: string; contacts?: Contacts }

/** What the description is called for each kind, with an example. */
const DESCRIPTION: Record<GroupKind, { label: string; placeholder: string }> = {
  team: { label: "What they do", placeholder: "What this team is responsible for, in a sentence or two" },
  platform: { label: "What it is", placeholder: "What this platform is for and who uses it, in a sentence or two" },
  practice: { label: "What it covers", placeholder: "What this practice agrees on, in a sentence or two" },
};

/** The rows, in the order the page shows them. */
const ROWS: { key: keyof Contacts; placeholder: string; hint?: string; type?: string }[] = [
  { key: "email", placeholder: "e.g. cloud-platform@company.com", type: "email" },
  { key: "slack", placeholder: "e.g. #cloud-platform" },
  { key: "slackUrl", placeholder: "https://…slack.com/archives/…", type: "url" },
  { key: "chat", placeholder: "e.g. Cloud Platform questions" },
  { key: "chatUrl", placeholder: "https://chat.google.com/room/…", type: "url" },
  { key: "confluence", placeholder: "https://…atlassian.net/wiki/…", type: "url" },
  { key: "page", placeholder: "https://…", type: "url", hint: "Their own page or site" },
  { key: "form", placeholder: "https://…", type: "url", hint: "Where people ask them for something" },
];

/**
 * The fields for the description and the contact details of a team, platform or practice: one
 * labelled field per row; a problem is shown on its own field, in plain words, once the field is
 * left (or, with `showAll`, after a save was tried). Used on the group's page and in Admin › Teams.
 */
export function ContactFields({ kind, value, onChange, showAll = false, idPrefix = "group" }: {
  kind: GroupKind; value: DetailsValue; onChange: (v: DetailsValue) => void;
  /** Show every problem, also on fields not visited yet (after a save was tried). */
  showAll?: boolean;
  /** Makes the ids of the fields unique on the page. */
  idPrefix?: string;
}) {
  const [left, setLeft] = useState<Partial<Record<string, boolean>>>({});
  const problems = contactProblems(value.contacts);
  const c = value.contacts ?? {};
  const set = (key: keyof Contacts, v: string) => onChange({ ...value, contacts: { ...c, [key]: v } });
  const id = (k: string) => `${idPrefix}-${k}`;
  const shown = (k: keyof Contacts) => (showAll || left[k]) && problems[k];
  return (
    <div className="contact-fields">
      <div className="field">
        <label className="field-label" htmlFor={id("description")}>{DESCRIPTION[kind].label}</label>
        <textarea id={id("description")} rows={3} maxLength={DESCRIPTION_MAX} value={value.description ?? ""} placeholder={DESCRIPTION[kind].placeholder}
          onChange={(e) => onChange({ ...value, description: e.target.value })} />
      </div>
      {ROWS.map((r) => {
        const problem = shown(r.key);
        return (
          <div key={r.key} className="field" data-contact-field={r.key}>
            <label className="field-label" htmlFor={id(r.key)}>{CONTACT_LABEL[r.key]}{r.hint && <em>{r.hint}</em>}</label>
            <input id={id(r.key)} type={r.type === "email" ? "email" : "text"} inputMode={r.type === "url" ? "url" : undefined} autoComplete="off" spellCheck={false}
              value={c[r.key] ?? ""} maxLength={CONTACT_MAX[r.key] + 20} placeholder={r.placeholder}
              aria-invalid={problem ? true : undefined} aria-describedby={problem ? id(`${r.key}-problem`) : undefined}
              onChange={(e) => set(r.key, e.target.value)} onBlur={(e) => {
                // a link typed without its beginning ("example.atlassian.net/wiki/x") gets https:// added
                if (LINK_KEYS.includes(r.key)) { const v = withScheme(e.target.value); if (v !== e.target.value) set(r.key, v); }
                setLeft((l) => ({ ...l, [r.key]: true }));
              }} />
            {problem && <p className="field-error" id={id(`${r.key}-problem`)}>{problem}</p>}
          </div>
        );
      })}
      <div className="field">
        <label className="field-label" htmlFor={id("contact")}>{OTHER_LABEL}<em>Anything else, e.g. a queue or office hours</em></label>
        <input id={id("contact")} value={value.contact ?? ""} maxLength={OTHER_MAX} placeholder="e.g. ServiceNow queue “Cloud Platform”"
          onChange={(e) => onChange({ ...value, contact: e.target.value })} />
      </div>
    </div>
  );
}
