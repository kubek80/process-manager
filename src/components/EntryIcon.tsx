import { useEffect, useState } from "react";
import { iconUrl } from "../lib/store";
import "../icons.css";

/** An uploaded icon of a tool or a language: a square image, or nothing when there is none or it does not load. */
export function EntryIcon({ icon, size = 20, className = "" }: { icon?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  if (!icon || failed) return null;
  return (
    <img className={`entry-icon ${className}`.trim()} src={iconUrl(icon)} alt="" loading="lazy" width={size} height={size}
      style={{ width: size, height: size }} onError={() => setFailed(true)} />
  );
}
