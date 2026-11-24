import type { ReactNode } from "react";

/**
 * The portal's one alert (the designer's): what a person must know about the page they are on, in
 * one of four states. A filled icon at the top left (24 × 24, its artwork 20 × 20), then the title
 * (16/24 Medium) and the description (16/24 Regular), 4 apart; padding 12, 12, 12 and 16 on the
 * left, 12 between icon and text, radius 8, no border or shadow; it fits its parent and grows with
 * its text. Colours: `--alert-<state>-bg`, `--alert-<state>-icon` and `--alert-text` (styles.css,
 * worked out from the look in theme.ts). Actions, if any, sit under the text.
 *
 * A one-sentence notice is a description alone; a notice with a lead is a title and a description.
 * `role` stays what the notice had: "alert" for what went wrong just now, "status" for what changed,
 * "note" for what is so about the page (a draft, unpublished changes).
 */
export type AlertTone = "info" | "success" | "warning" | "problem";

export function Alert({ tone, title, children, actions, role, className = "", id, tabIndex }: {
  tone: AlertTone;
  /** The lead, Medium: "Review overdue since 2026-09-02". */
  title?: ReactNode;
  /** The description, Regular. */
  children?: ReactNode;
  /** Links or buttons the notice offers, under its text. */
  actions?: ReactNode;
  role?: "alert" | "status" | "note";
  className?: string;
  id?: string;
  tabIndex?: number;
}) {
  return (
    <div className={`alert alert-${tone} ${className}`.trim()} role={role} id={id} tabIndex={tabIndex}>
      <span className="alert-icon" aria-hidden="true"><AlertIcon tone={tone} /></span>
      <div className="alert-body">
        {title && <p className="alert-title">{title}</p>}
        {children && <div className="alert-desc">{children}</div>}
        {actions && <div className="alert-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The filled icon of a state, drawn here (no icon font, nothing from another host): information a
 * circle with an i, success a circle with a tick, warning a triangle with an exclamation mark,
 * problem a circle with an exclamation mark. The shape tells the state apart without its colour;
 * the mark inside is cut in the glyph colour (`--alert-glyph`).
 */
export function AlertIcon({ tone, size = 20 }: { tone: AlertTone; size?: number }) {
  const g = "var(--alert-glyph)";
  return (
    <svg className="alert-glyph" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {tone === "warning"
        ? <path d="M8.27 1.99a2 2 0 0 1 3.46 0l7.98 13.84A2 2 0 0 1 17.98 18.83H2.02A2 2 0 0 1 .29 15.83Z" fill="currentColor" />
        : <circle cx="10" cy="10" r="10" fill="currentColor" />}
      {tone === "info" && <><circle cx="10" cy="5.8" r="1.3" fill={g} /><rect x="9" y="8.4" width="2" height="6.8" rx="1" fill={g} /></>}
      {tone === "success" && <path d="M5.6 10.4 8.6 13.3 14.4 7.2" fill="none" stroke={g} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {tone === "warning" && <><rect x="9" y="6.6" width="2" height="6" rx="1" fill={g} /><circle cx="10" cy="15.1" r="1.2" fill={g} /></>}
      {tone === "problem" && <><rect x="9" y="4.6" width="2" height="6.8" rx="1" fill={g} /><circle cx="10" cy="14.4" r="1.3" fill={g} /></>}
    </svg>
  );
}
