import { useEffect, useState, type ReactNode } from "react";
import { iconUrl } from "../lib/store";
import "../icons.css";

/**
 * The uploaded icon of a tool or a language: a square image with a fixed size (nothing moves
 * while it loads). It is decoration - the name is always written next to it - so `alt` is empty.
 * Without an icon, or when the image does not load, it shows `fallback` (nothing by default).
 */
export function EntryIcon({ icon, size = 20, className = "", fallback = null }: { icon?: string; size?: number; className?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  if (!icon || failed) return <>{fallback}</>;
  return (
    <img className={`entry-icon ${className}`.trim()} src={iconUrl(icon)} alt="" loading="lazy" width={size} height={size} draggable={false}
      style={{ width: size, height: size }} onError={() => setFailed(true)} />
  );
}
