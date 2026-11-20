import { logoUrl, type Look } from "../lib/theme";

/** The mark shown when no logo is set. */
export function DefaultMark({ size = 18 }: { size?: number }) {
  return <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg>;
}

/**
 * The portal's logo tile (Admin › Theming): the uploaded logo, or the default mark on the brand
 * colour. `src` overrides where the logo comes from (the preview shows one not saved yet).
 */
export function BrandLogo({ look, big, className = "", src }: { look: Look; big?: boolean; className?: string; src?: string }) {
  const url = src ?? logoUrl(look);
  return (
    <span className={`logo ${big ? "big" : ""} ${url ? "custom" : ""} ${className}`}>
      {url ? <img src={url} alt="" /> : <DefaultMark size={big ? 26 : 18} />}
    </span>
  );
}
