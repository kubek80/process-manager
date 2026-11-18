import { useMemo, useRef, useState } from "react";
import { Check, Copy, Mail, Share2, Type } from "lucide-react";
import { appBase, canShareNatively, copiedStatus, linkAndTitle, mailtoLink, nativeShareData, SHARE_HINT, shareCancelled, shareUrl, type ShareInfo } from "../lib/share";
import { copyText } from "../lib/store";
import { Modal } from "./ui";
import "../share.css";

type What = "link" | "title";

/**
 * Share a process or standard: its link (copied with the button next to it), the link with its
 * title, an e-mail, or - where the device has one - its own share sheet. Nothing is sent from here.
 */
export function ShareDialog({ info, onClose }: { info: ShareInfo; onClose: () => void }) {
  const url = shareUrl(appBase(), info.kind, info.id);
  const [copied, setCopied] = useState<What | null>(null);
  const [manual, setManual] = useState<{ what: What; text: string } | null>(null);
  const [problem, setProblem] = useState("");
  const timer = useRef<number>(0);
  const data = useMemo(() => nativeShareData(info, url), [info, url]);
  const native = useMemo(() => canShareNatively(typeof navigator === "undefined" ? undefined : navigator, data), [data]);

  const copy = async (what: What) => {
    const text = what === "link" ? url : linkAndTitle(info, url);
    let ok = false;
    try { ok = await copyText(text); } catch { ok = false; }
    window.clearTimeout(timer.current);
    setProblem("");
    if (ok) {
      setManual(null); setCopied(what);
      timer.current = window.setTimeout(() => setCopied(null), 2500);
    } else {
      // the browser did not allow it: show the text, selected, to copy by hand
      setCopied(null); setManual({ what, text });
    }
  };
  const shareOnDevice = async () => {
    setProblem(""); setCopied(null);
    try { await navigator.share(data); } catch (e) {
      if (!shareCancelled(e)) setProblem("This device could not share it. Copy the link instead.");
    }
  };
  const noun = info.kind === "process" ? "process" : "standard";
  const done = (what: What) => copied === what;
  return (
    <Modal title={`Share “${info.title}”`} subtitle={`Send the ${noun} to a colleague. Nothing is posted for you.`} onClose={onClose}>
      <div className="share-dialog">
        <div className="share-link">
          <input className="share-url" readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={`icon-btn share-copy ${done("link") ? "copied" : ""}`} aria-label="Copy link" title="Copy link" onClick={() => copy("link")}>
            {done("link") ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          </button>
        </div>
        <div className="share-options">
          <button type="button" className={`share-option ${done("title") ? "copied" : ""}`} onClick={() => copy("title")}>
            <span className="share-icon" aria-hidden="true">{done("title") ? <Check size={17} /> : <Type size={17} />}</span>
            <span className="share-text"><strong>Copy link and title{done("title") && <em className="share-copied" aria-hidden="true">Copied</em>}</strong><span>{SHARE_HINT.title}</span></span>
          </button>
          <a className="share-option" href={mailtoLink(info, url)}>
            <span className="share-icon" aria-hidden="true"><Mail size={17} /></span>
            <span className="share-text"><strong>Email</strong><span>{SHARE_HINT.email}</span></span>
          </a>
          {native && (
            <button type="button" className="share-option share-device" onClick={shareOnDevice}>
              <span className="share-icon" aria-hidden="true"><Share2 size={17} /></span>
              <span className="share-text"><strong>Share…</strong><span>{SHARE_HINT.device}</span></span>
            </button>
          )}
        </div>
        <p className={`share-status ${problem ? "bad" : ""}`} role="status" aria-live="polite">{problem || (copied ? copiedStatus(copied) : "")}</p>
        {manual && (
          <div className="share-manual">
            <p>Your browser did not allow copying. Select the text below and copy it (Ctrl+C, or ⌘C on a Mac).</p>
            <textarea readOnly rows={2} value={manual.text} aria-label="Text to copy" autoFocus onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
      </div>
    </Modal>
  );
}
