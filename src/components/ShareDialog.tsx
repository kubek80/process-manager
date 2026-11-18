import { useRef, useState } from "react";
import { Check, Link2, Mail, MessageSquare, MessagesSquare } from "lucide-react";
import { appBase, copiedStatus, SHARE_HINT, googleChatMessage, mailtoLink, shareUrl, slackMessage, type ShareInfo } from "../lib/share";
import { copyText } from "../lib/store";
import { Modal } from "./ui";
import "../detail.css";

type What = "link" | "slack" | "chat";

/** Copies rich text where the browser allows it (kept by Slack when pasted), else plain text. */
async function copyRich(text: string, html?: string): Promise<boolean> {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
      return true;
    } catch { /* fall back to plain text */ }
  }
  try { return await copyText(text); } catch { return false; }
}

/**
 * Share a process or standard: copy its address, a message for Slack or Google Chat, or open an
 * e-mail. Nothing is sent from here.
 */
export function ShareDialog({ info, onClose }: { info: ShareInfo; onClose: () => void }) {
  const url = shareUrl(appBase(), info.kind, info.id);
  const [copied, setCopied] = useState<What | null>(null);
  const [manual, setManual] = useState<{ what: What; text: string } | null>(null);
  const timer = useRef<number>(0);
  const copy = async (what: What) => {
    const slack = slackMessage(info, url);
    const text = what === "link" ? url : what === "slack" ? slack.text : googleChatMessage(info, url);
    const ok = await copyRich(text, what === "slack" ? slack.html : undefined);
    window.clearTimeout(timer.current);
    if (ok) {
      setManual(null); setCopied(what);
      timer.current = window.setTimeout(() => setCopied(null), 2500);
    } else {
      // the browser did not allow it: show the text, selected, to copy by hand
      setCopied(null); setManual({ what, text });
    }
  };
  const noun = info.kind === "process" ? "process" : "standard";
  // a function, not a component: the button must stay the same element (and keep the focus) when it changes
  const option = (what: What, icon: React.ReactNode, label: string, hint: string) => (
    <button key={what} type="button" className={`share-option ${copied === what ? "copied" : ""}`} onClick={() => copy(what)}>
      <span className="share-icon" aria-hidden="true">{copied === what ? <Check size={17} /> : icon}</span>
      <span className="share-text"><strong>{label}{copied === what && <em className="share-copied" aria-hidden="true">Copied</em>}</strong><span>{hint}</span></span>
    </button>
  );
  return (
    <Modal title={`Share “${info.title}”`} subtitle={`Send the ${noun} to a colleague. Nothing is posted for you: you paste it where you like.`} onClose={onClose}>
      <div className="share-dialog">
        <div className="share-url"><Link2 size={14} aria-hidden="true" /><span>{url}</span></div>
        <div className="share-options">
          {option("link", <Link2 size={17} />, "Copy link", SHARE_HINT.link)}
          {option("slack", <MessageSquare size={17} />, "Copy message for Slack", SHARE_HINT.slack)}
          {option("chat", <MessagesSquare size={17} />, "Copy message for Google Chat", SHARE_HINT.chat)}
          <a className="share-option" href={mailtoLink(info, url)}>
            <span className="share-icon" aria-hidden="true"><Mail size={17} /></span>
            <span className="share-text"><strong>Email</strong><span>Opens your mail program with the message filled in</span></span>
          </a>
        </div>
        <p className="share-status" role="status" aria-live="polite">{copied ? copiedStatus(copied) : ""}</p>
        {manual && (
          <div className="share-manual">
            <p>Your browser did not allow copying. Select the text below and copy it (Ctrl+C, or ⌘C on a Mac).</p>
            <textarea readOnly rows={manual.what === "link" ? 2 : 4} value={manual.text} aria-label="Text to copy" autoFocus onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
      </div>
    </Modal>
  );
}
