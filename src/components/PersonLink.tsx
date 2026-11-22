import type { ReactNode } from "react";
import { personLabel, type PersonRef } from "../lib/members";
import type { SentencePart } from "../lib/editing";

/** One person drawn in a text: by name where it is known (`personLabel`), the address as tooltip and mail link. */
export function PersonLink({ person, children }: { person: PersonRef; children?: ReactNode }) {
  return <a className="person-link" href={`mailto:${person.email}`} title={person.email}>{children ?? personLabel(person)}</a>;
}

/** A sentence in parts (`whoPublishesParts`), its people drawn by `PersonLink`. */
export function SentenceParts({ parts }: { parts: readonly SentencePart[] }) {
  return <>{parts.map((p, i) => (typeof p === "string" ? p : <PersonLink key={i} person={p} />))}</>;
}
