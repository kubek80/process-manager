// Icons of tools and languages: square images uploaded once and named by id in the lists.

export const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const ICON_MAX_BYTES = 64 * 1024;
/** Said before the person picks a file. */
export const ICON_RULES = "PNG, JPEG, WebP or SVG. Square, at most 64 KB.";

/** What is wrong with a chosen file before it is sent ("" when nothing is); the server checks the rest (square, size in pixels, safe drawing). */
export function iconFileProblem(file: { type: string; size: number; name?: string }): string {
  const type = file.type || (file.name?.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
  if (!(ICON_TYPES as readonly string[]).includes(type)) return "This file is not a PNG, JPEG, WebP or SVG image. Choose one of those.";
  if (file.size > ICON_MAX_BYTES) return `This image is ${Math.ceil(file.size / 1024)} KB. An icon can be at most 64 KB: make it smaller and choose it again.`;
  if (file.size === 0) return "This file is empty.";
  return "";
}

/** The content type to send: the browser's, or for an .svg file it did not recognise, SVG. */
export const iconContentType = (file: { type: string; name?: string }) => file.type || (file.name?.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
