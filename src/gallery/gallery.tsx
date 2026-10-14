import { useEffect, useState } from "react";
import { cn } from "cn";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TitleTips } from "@/components/ui/title-tips";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEMES, applyTheme, useTheme, type ThemeId } from "@/stores/theme";
import { isThemeId, themeInfo } from "@/themes";
import { HOME_SECTIONS } from "@/components/home/gallery";
import { NOW_PLAYING_SECTIONS } from "@/components/now-playing/gallery";
import { SHADER_SECTIONS } from "@/components/shader/gallery";
import { MUSIC_SECTIONS } from "@/suites/music/gallery";
import { PHOTO_SECTIONS } from "@/suites/photo/gallery";
import { PRIMITIVE_SECTIONS } from "./primitives";
import type { GallerySection } from "./types";

/** Every section, in order: the platform's primitives, then each suite's own controls. */
export const SECTIONS: GallerySection[] = [...PRIMITIVE_SECTIONS, ...HOME_SECTIONS, ...NOW_PLAYING_SECTIONS, ...SHADER_SECTIONS, ...MUSIC_SECTIONS, ...PHOTO_SECTIONS];

/**
 * The component gallery (`/gallery`, in development): every UI primitive and suite control in the states
 * worth looking at, in whichever theme is picked, to restyle and check them without opening a project.
 * `?section=<id>` shows one section alone and `?theme=<id>` picks the look without saving it; `scripts/ui-sheet.ts` screenshots them all that way.
 */
export default function Gallery() {
  const params = new URLSearchParams(location.search);
  const only = params.get("section");
  const theme = useTheme((s) => s.theme);
  const [active, setActive] = useState(only ?? SECTIONS[0].id);

  // The URL's look is for this page only: it's applied without saving it, so screenshots don't change the app's.
  useEffect(() => {
    const t = params.get("theme");
    if (isThemeId(t)) useTheme.setState({ choice: t, theme: t, resolved: themeInfo(t).dark ? "dark" : "light" });
  }, []);
  useEffect(() => applyTheme(theme), [theme]);

  const shown = only ? SECTIONS.filter((s) => s.id === only) : SECTIONS;

  return (
    <TooltipProvider delayDuration={200}>
      <TitleTips />
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
