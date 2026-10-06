/**
 * The internet, as the Online panel's tests see it (`EDITOR_ONLINE_ASSETS=stand-in`: the e2e suite): Iconify,
 * Bing and Openverse answer as they do, about made-up pictures that are small SVGs, so the panel's searches,
 * fallbacks and placing run for real without the network. One picture's original is missing, as a hotlink-shy
 * host's is, so the fallback to the search engine's copy is exercised.
 */
import { ICONIFY } from "./online.ts";

const slugOf = (query: string) => query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "picture";

/** A made-up picture: a disc of `colour` on a transparent square of `size`, with a stroke so it's never flat. */
export function standInSvg(size: number, colour: string, palette = false): string {
  const fill = palette ? "#f5b400" : colour;
  const stroke = palette ? "#c0392b" : colour;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2" fill-opacity="0.85"/></svg>`;
}

/** A picture the page shows instead of a stand-in host's address (which it can't load). */
export function standInThumb(url: string): string {
  if (url.startsWith("data:")) return url;
  const palette = /twemoji|photo|images|thumbs|pages/.test(url);
  return `data:image/svg+xml;utf8,${encodeURIComponent(standInSvg(64, "#000000", palette))}`;
}

const svgResponse = (svg: string) => new Response(svg, { headers: { "content-type": "image/svg+xml" } });

const htmlAttr = (value: unknown) => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** `fetch` for the stand-in internet. */
export const standInFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.href.startsWith(`${ICONIFY}/search`)) {
    const slug = slugOf(url.searchParams.get("query") ?? "");
    const start = Number(url.searchParams.get("start") ?? 0);
    const icons = start > 0 ? [] : [`mdi:${slug}`, `mdi:${slug}-outline`, `tabler:${slug}`, `twemoji:${slug}`];
    return Response.json({
      icons,
      total: 4,
      collections: {
        mdi: { name: "Material Design Icons", palette: false, license: { title: "Apache 2.0" }, author: { name: "Pictogrammers" } },
        tabler: { name: "Tabler Icons", palette: false, license: { title: "MIT" } },
        twemoji: { name: "Twitter Emoji", palette: true, license: { title: "CC BY 4.0" } },
      },
    });
  }
  // A set's shapes: a disc, in its own colours for the emoji, else in currentColor (recoloured when placed).
  if (url.href.startsWith(ICONIFY) && url.pathname.endsWith(".json")) {
    const palette = url.pathname === "/twemoji.json";
    const names = (url.searchParams.get("icons") ?? "").split(",").filter(Boolean);
    const body = palette
      ? '<circle cx="12" cy="12" r="9" fill="#f5b400" stroke="#c0392b" stroke-width="2"/>'
      : '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="currentColor" stroke-width="2" fill-opacity="0.85"/>';
    return Response.json({ prefix: url.pathname.slice(1, -5), width: 24, height: 24, icons: Object.fromEntries(names.map((n) => [n, { body }])) });
  }
  if (url.hostname === "www.bing.com") {
    const slug = slugOf(url.searchParams.get("q") ?? "");
    if (Number(url.searchParams.get("first") ?? 1) > 1) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    const items = [1, 2, 3].map((n) => ({
      murl: n === 2 ? `https://images.stand-in/missing/${slug}-${n}.png` : `https://images.stand-in/${slug}-${n}.svg`,
      turl: `https://thumbs.stand-in/th?id=${slug}-${n}`,
      t: `${url.searchParams.get("q")} picture ${n}`,
      purl: `https://pages.stand-in/${slug}-${n}`,
    }));
    return new Response(`<html><body>${items.map((m) => `<a class="iusc" m="${htmlAttr(m)}"></a>`).join("")}</body></html>`, { headers: { "content-type": "text/html" } });
  }
  if (url.hostname === "api.openverse.org") {
    const slug = slugOf(url.searchParams.get("q") ?? "");
    return Response.json({
      page_count: 1,
      results: [1, 2].map((n) => ({
        url: `https://images.stand-in/photo-${slug}-${n}.svg`,
        thumbnail: `https://thumbs.stand-in/photo-${slug}-${n}`,
        title: `${slug} photo ${n}`,
        width: 640,
        height: 640,
        creator: "Stand-in",
        license: "by",
        license_version: "4.0",
        foreign_landing_url: `https://pages.stand-in/photo-${slug}-${n}`,
      })),
    });
  }
  if (url.hostname === "images.stand-in" || url.hostname === "thumbs.stand-in") {
    if (url.pathname.startsWith("/missing/")) return new Response("Forbidden", { status: 403 });
    return svgResponse(standInSvg(640, "#2d7ff9", true));
  }
  if (url.hostname === "pages.stand-in") {
    if (url.pathname.endsWith(".svg")) return svgResponse(standInSvg(640, "#2d7ff9", true));
    return new Response(
      `<html><head><title>Stand-in page</title><meta property="og:image" content="https://images.stand-in/og.svg"></head><body><img src="/one.svg"><img srcset="https://images.stand-in/two-small.svg 1x, https://images.stand-in/two.svg 2x"></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  return new Response("Not found", { status: 404 });
};
