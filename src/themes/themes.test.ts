/// <reference types="node" />
// Node's, for reading the CSS (Vitest hands CSS imports over empty).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, resolveTheme } from "./index";

/**
 * Every theme must be readable, however playful: its text on every surface it's drawn on, the text on its
 * accent's buttons, and the accent itself against the panels (WCAG: 4.5:1 for text, 3:1 for what isn't).
 * Read from the CSS itself: Studio's values (`studio.css`, the base: `.theme`, `.theme.dark` for dark
 * themes) with the theme's own on top.
 */
const read = (file: string) => (fs.existsSync(path.join(import.meta.dirname, file)) ? fs.readFileSync(path.join(import.meta.dirname, file), "utf8") : "");

/** The custom properties a selector sets in a file (its last block with exactly that selector). */
function block(file: string, selector: string): Record<string, string> {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const values: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].trim() !== selector) continue;
    for (const decl of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) values[decl[1]] = decl[2].trim();
  }
  return values;
}

function themeValues(id: string, dark: boolean): Record<string, string> {
  const own = id === "light" || id === "dark" ? {} : block(`${id}.css`, `.theme.theme-${id}`);
  return { ...block("studio.css", ".theme"), ...(dark ? block("studio.css", ".theme.dark") : {}), ...own };
}

/** A variable's colour as #rrggbb, following `var()` aliases; null for what isn't a plain colour. */
function colour(values: Record<string, string>, name: string): string | null {
  let value = values[name];
  for (let i = 0; value && i < 10; i++) {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    if (!alias) break;
    value = values[alias[1]];
  }
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--sunken", "--popover"];
const PAIRS: [foreground: string, backgrounds: string[], need: number][] = [
  ["--foreground", [...SURFACES, "--accent"], 4.5],
  ["--muted-foreground", SURFACES, 4.5],
  ["--brand-foreground", ["--brand"], 4.5],
  ["--brand", ["--surface-1", "--surface-2", "--surface-3"], 3],
];

describe("themes", () => {
  for (const theme of THEMES) {
    it(`${theme.name} is readable`, () => {
      const values = themeValues(theme.id, theme.dark);
      const failures: string[] = [];
      for (const [fg, backgrounds, need] of PAIRS) {
        for (const bg of backgrounds) {
          const a = colour(values, fg);
          const b = colour(values, bg);
          expect(a, `${fg} is a plain colour`).not.toBeNull();
          expect(b, `${bg} is a plain colour`).not.toBeNull();
          const ratio = contrast(a!, b!);
          if (ratio < need) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${need}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("has a CSS file for every theme but Studio's two, imported by index.css", () => {
    for (const { id } of THEMES) {
      if (id === "light" || id === "dark") continue;
      expect(read(`${id}.css`), id).toBeTruthy();
      expect(read("../index.css")).toContain(`@import "./themes/${id}.css";`);
    }
  });

  it("has System follow the computer between Light and Dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("luna", true)).toBe("luna");
  });
});
