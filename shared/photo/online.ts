/**
 * The photo suite's Online panel (docs/photo/online.md): pictures found on the internet, placed as layers. Icons
 * come from Iconify (open-source sets, as SVG), images from a web image search, free photos from Openverse
 * (Creative Commons), and a pasted link is read for the pictures on it. The server searches and downloads; these
 * are the types both sides share, and the pure rules about them.
 */

/** Where results come from. */
export type OnlineSource = "icons" | "web" | "photos" | "link";

export const ONLINE_SOURCES: readonly OnlineSource[] = ["icons", "web", "photos", "link"];

/** A web search's narrowing (Bing's filters): any picture, only ones with transparency, clip art, line drawings, photos. */
export type WebFilter = "any" | "transparent" | "clipart" | "line" | "photo";

export const WEB_FILTERS: readonly WebFilter[] = ["any", "transparent", "clipart", "line", "photo"];

/** One result: enough to show it and to place it. */
export interface OnlineResult {
  source: OnlineSource;
  /** The icon's name ("mdi:bell"), else the picture's address: what placing it asks for. */
  id: string;
  title: string;
  /** A small picture to show (an address the page loads, or a data URL). */
  thumb: string;
  /** Its size when known. */
  width?: number;
  height?: number;
  /** An address to fall back on when the picture's own won't download (a search engine's copy). */
  fallback?: string;
  /** The page it's from. */
  page?: string;
  /** Who made it and its licence, when the source says. */
  credit?: string;
  license?: string;
  /** An icon in colours of its own (an emoji, a logo): not recoloured. */
  palette?: boolean;
  /** An icon's set ("Material Design Icons"). */
  set?: string;
}

export interface OnlineSearch {
  results: OnlineResult[];
  /** The next page to ask for, or null at the end. */
  next: number | null;
}

/** Placing a result: the result, and for an icon the size and colour it's drawn at. */
export interface OnlinePlaceRequest {
  source: OnlineSource;
  id: string;
  title?: string;
  fallback?: string;
  /** An icon's longer side in pixels. */
  size?: number;
  /** An icon's colour, "#rrggbb" (a palette icon keeps its own). */
  colour?: string;
}

export const ICON_SIZES = { min: 16, max: 4096, default: 512 } as const;

/** Whether what was typed is an address to read rather than words to search for. */
export function isLink(query: string): boolean {
  const text = query.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** An icon's name as Iconify writes it: a set's prefix and the icon's, "mdi:bell". */
export const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** A layer's name for a result: its title, short and without a file's extension. */
export function onlineLayerName(result: { title?: string; id: string; source: OnlineSource }): string {
  const raw = (result.title ?? "").trim() || (result.source === "icons" ? result.id.split(":")[1] ?? result.id : result.id.split(/[/?#]/).filter(Boolean).at(-1) ?? "Image");
  const name = raw.replace(/\.(png|jpe?g|webp|gif|svg|avif)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name) || "Image";
}

/** The icon size a canvas suggests: a quarter of its shorter side, within reason. */
export function iconSizeFor(canvas: { width: number; height: number }): number {
  const size = Math.round(Math.min(canvas.width, canvas.height) / 4);
  return Math.max(64, Math.min(1024, size));
}
