import { useEffect, useState } from "react";
import { cn } from "cn";
import { PiDesktop, PiMoon, PiSun } from "react-icons/pi";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEMES, applyTheme, useTheme, type Appearance, type ThemeId } from "@/stores/theme";
import { MUSIC_SECTIONS } from "@/suites/music/gallery";
import { PRIMITIVE_SECTIONS } from "./primitives";
import type { GallerySection } from "./types";

/** Every section, in order: the platform's primitives, then each suite's own controls. */
export const SECTIONS: GallerySection[] = [...PRIMITIVE_SECTIONS, ...MUSIC_SECTIONS];

/**
 * The component gallery (`/gallery`, in development): every UI primitive and suite control in the states
 * worth looking at, in whichever theme is picked, to restyle and check them without opening a project.
 * `?section=<id>` shows one section alone and `?theme=<id>&appearance=light|dark` picks the look without
 * saving it; `scripts/ui-sheet.ts` screenshots them all that way.
 */
export default function Gallery() {
  const params = new URLSearchParams(location.search);
  const only = params.get("section");
  const theme = useTheme((s) => s.theme);
  const appearance = useTheme((s) => s.appearance);
  const [active, setActive] = useState(only ?? SECTIONS[0].id);

  // The URL's look is for this page only: it's applied without saving it, so screenshots don't change the app's.
  useEffect(() => {
    const t = params.get("theme") as ThemeId | null;
    const a = params.get("appearance") as Appearance | null;
    if (t || a) useTheme.setState({ theme: t ?? theme, appearance: a ?? appearance });
  }, []);
  useEffect(() => {
    applyTheme(theme, appearance);
    useTheme.setState({ resolved: document.documentElement.classList.contains("dark") ? "dark" : "light" });
  }, [theme, appearance]);

  const shown = only ? SECTIONS.filter((s) => s.id === only) : SECTIONS;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full bg-background text-foreground">
        {!only && (
          <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-sidebar p-2" aria-label="Sections">
            <div className="px-2 pt-1 pb-2 text-[13px] font-semibold">Component gallery</div>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                className={cn(
                  "rounded-sm px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground",
                  active === s.id && "bg-brand/20 text-foreground",
                )}
              >
                {s.title}
              </a>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {!only && (
            <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
              <ToggleGroup
                type="single"
                size="sm"
                value={theme}
                onValueChange={(v) => v && useTheme.getState().setTheme(v as ThemeId)}
                aria-label="Theme"
              >
                {THEMES.map((t) => (
                  <ToggleGroupItem key={t.id} value={t.id}>
                    {t.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                type="single"
                size="sm"
                value={appearance}
                onValueChange={(v) => v && useTheme.getState().setAppearance(v as Appearance)}
                aria-label="Appearance"
              >
                <ToggleGroupItem value="light" aria-label="Light">
                  <PiSun />
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Dark">
                  <PiMoon />
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label="System">
                  <PiDesktop />
                </ToggleGroupItem>
              </ToggleGroup>
              <span className="ml-auto text-xs text-muted-foreground">pnpm tsx scripts/ui-sheet.ts screenshots every section</span>
            </header>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-6 p-6">
              {shown.map((s) => (
                <section key={s.id} id={s.id} data-gallery-section={s.id} data-gallery-shots={JSON.stringify(s.shots ?? [])} className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-[15px] font-semibold">{s.title}</h2>
                    <code className="font-mono text-[11px] text-muted-foreground">{s.source}</code>
                  </div>
                  <div className="rounded-md border border-line bg-background p-4">{s.render()}</div>
                </section>
              ))}
            </div>
          </main>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
