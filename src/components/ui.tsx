import { useEffect, useState, type ReactNode } from "react";
import {
  ClipboardList, GitPullRequest, Stamp, Eye, Hourglass, Send, Users, Bot, FileText, ShieldCheck,
  Split, Workflow, SquareCheck, X, Check, Copy, type LucideIcon,
} from "lucide-react";
import type { StepType } from "../types";
import { STEP_META } from "../lib/stepMeta";
import { copyText } from "../lib/store";

export const STEP_ICON: Record<StepType, LucideIcon> = {
  form: ClipboardList, code: GitPullRequest, approval: Stamp, review: Eye, wait: Hourglass,
  communication: Send, meeting: Users, automation: Bot, document: FileText, verify: ShieldCheck,
  decision: Split, subprocess: Workflow, task: SquareCheck,
};

export function TypeIcon({ type, size = 36 }: { type: StepType; size?: number }) {
  const Icon = STEP_ICON[type] ?? SquareCheck;
  return (
    <span className="type-icon" style={{ "--c": STEP_META[type]?.color ?? "#475569", width: size, height: size } as React.CSSProperties}>
      <Icon size={Math.round(size * 0.52)} strokeWidth={2} />
    </span>
  );
}

export function Modal({ title, subtitle, onClose, children, wide, footer }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function CopyButton({ text, label, primary, icon }: { text: () => string; label: string; primary?: boolean; icon?: ReactNode }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className={`btn ${primary ? "primary" : ""}`}
      onClick={async () => { if (await copyText(text())) { setOk(true); setTimeout(() => setOk(false), 1600); } }}
    >
      {ok ? <Check size={16} /> : icon ?? <Copy size={16} />}
      {ok ? "Copied" : label}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}
