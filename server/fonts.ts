/**
 * The fonts installed on this computer, like Photoshop's font menu. The
 * browser draws text itself (in any installed font, by family name), so this
 * only has to say which families and styles exist and how CSS asks for each
 * style (weight, italic, width).
 *
 * macOS: AppKit's font manager (through JavaScript for Automation). Elsewhere:
 * fontconfig's `fc-list`. Without either, a few fonts every system has.
 */
import type { FontFamily, FontStyleInfo } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { run } from "./process.ts";
import { log } from "./log.ts";

const logger = log("fonts");

/** Fonts rarely change; look again after this long. */
const CACHE_MS = 5 * 60_000;

let cached: { at: number; fonts: Promise<FontFamily[]> } | null = null;

export function listFonts(): Promise<FontFamily[]> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const fonts = findFonts().catch((err) => {
      logger.warn(`couldn't list the installed fonts: ${errorMessage(err)}`);
      return FALLBACK;
    });
    cached = { at: Date.now(), fonts };
  }
  return cached.fonts;
}

async function findFonts(): Promise<FontFamily[]> {
  const raw = process.platform === "darwin" ? await appKitFonts() : await fontconfigFonts();
  return tidy(raw);
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

/** Every family with its members as [style name, AppKit weight 0..15, trait mask]. */
const APPKIT_SCRIPT = `
ObjC.import("AppKit");
const fm = $.NSFontManager.sharedFontManager;
JSON.stringify(ObjC.deepUnwrap(fm.availableFontFamilies).map((family) => [
  family,
  (ObjC.deepUnwrap(fm.availableMembersOfFontFamily(family)) || []).map((m) => [m[1], m[2], m[3]]),
]));
`;

const ITALIC_MASK = 0x1;
const NARROW_MASK = 0x10;
const EXPANDED_MASK = 0x20;
const CONDENSED_MASK = 0x40;
const COMPRESSED_MASK = 0x200;

async function appKitFonts(): Promise<FontFamily[]> {
  const out = await run("osascript", ["-l", "JavaScript", "-e", APPKIT_SCRIPT]);
  const families = JSON.parse(out) as [string, [string, number, number][]][];
  return families.map(([family, members]) => ({
    family,
    styles: members.map(([name, weight, traits]) => ({
      name,
      weight: appKitWeightToCss(weight),
      italic: (traits & ITALIC_MASK) !== 0,
      stretch:
        traits & (CONDENSED_MASK | COMPRESSED_MASK | NARROW_MASK)
          ? "condensed"
          : traits & EXPANDED_MASK
            ? "expanded"
            : "normal",
    })),
  }));
}

/**
 * AppKit's 0..15 weight scale as a CSS weight: the inverse of the mapping
 * Chrome uses to find a local font for a CSS weight, so asking for this
 * weight finds this style again.
 */
export function appKitWeightToCss(weight: number): number {
  if (weight <= 2) return 100;
  if (weight <= 3) return 200;
  if (weight <= 4) return 300;
  if (weight <= 5) return 400;
  if (weight <= 6) return 500;
  if (weight <= 8) return 600;
  if (weight <= 9) return 700;
  if (weight <= 11) return 800;
  return 900;
}

// ---------------------------------------------------------------------------
// Linux / Windows with fontconfig
// ---------------------------------------------------------------------------

async function fontconfigFonts(): Promise<FontFamily[]> {
  const out = await run("fc-list", ["--format", "%{family[0]}\\t%{style[0]}\\t%{weight}\\t%{slant}\\t%{width}\\n"]);
  const byFamily = new Map<string, FontStyleInfo[]>();
  for (const line of out.split("\n")) {
    const [family, name, weight, slant, width] = line.split("\t");
    if (!family || !name) continue;
    const styles = byFamily.get(family) ?? [];
    styles.push({
      name,
      weight: fontconfigWeightToCss(Number(weight)),
      italic: Number(slant) > 0,
      stretch: Number(width) < 100 ? "condensed" : Number(width) > 100 ? "expanded" : "normal",
    });
    byFamily.set(family, styles);
  }
  return [...byFamily].map(([family, styles]) => ({ family, styles }));
}

function fontconfigWeightToCss(weight: number): number {
  if (!Number.isFinite(weight)) return 400;
  if (weight <= 0) return 100;
  if (weight <= 40) return 200;
  if (weight <= 50) return 300;
  if (weight <= 80) return 400;
  if (weight <= 100) return 500;
  if (weight <= 180) return 600;
  if (weight <= 200) return 700;
  if (weight <= 205) return 800;
  return 900;
}

// ---------------------------------------------------------------------------

const basic = (family: string): FontFamily => ({
  family,
  styles: [
    { name: "Regular", weight: 400, italic: false, stretch: "normal" },
    { name: "Italic", weight: 400, italic: true, stretch: "normal" },
    { name: "Bold", weight: 700, italic: false, stretch: "normal" },
    { name: "Bold Italic", weight: 700, italic: true, stretch: "normal" },
  ],
});

const FALLBACK: FontFamily[] = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Impact",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
].map(basic);

const STRETCH_ORDER = ["normal", "condensed", "expanded"];

/**
 * Sort families A to Z and each family's styles by width, weight, then upright
 * before italic, dropping hidden system families and styles CSS can't tell
 * apart from an earlier one (the browser could only ever draw one of them).
 */
export function tidy(families: FontFamily[]): FontFamily[] {
  return families
    .filter((f) => f.family && !f.family.startsWith(".") && f.styles.length > 0)
    .map((f) => {
      const seen = new Set<string>();
      const styles = [...f.styles]
        .sort(
          (a, b) =>
            STRETCH_ORDER.indexOf(a.stretch) - STRETCH_ORDER.indexOf(b.stretch) ||
            a.weight - b.weight ||
            Number(a.italic) - Number(b.italic),
        )
        .filter((s) => {
          const key = `${s.weight}/${s.italic}/${s.stretch}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return { family: f.family, styles };
    })
    .sort((a, b) => a.family.localeCompare(b.family, "en", { sensitivity: "base" }));
}
