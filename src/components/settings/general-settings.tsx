import { PiCheckBold } from "react-icons/pi";
import { cn } from "cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type FontChoice, FONTS, MONO_FONTS, THEMES, type ThemeChoice, type ThemeId, themeClasses, useTheme } from "@/stores/theme";
import { SettingsBlock, SettingsGroup, SettingsRow } from "./settings-ui";
import { AppIconPicker } from "./app-icon-picker";
import { LogSettings } from "./log-settings";
import { ProjectsLocation } from "./projects-location";

/** Settings' own section: where projects are saved and how the whole app looks, whichever suite is open. */
export function GeneralSettings() {
  return (
    <>
      <ProjectsLocation />
      <SettingsGroup title="Theme" description="System is Light or Dark, as your computer is set.">
        <SettingsBlock>
          <ThemePicker />
        </SettingsBlock>
      </SettingsGroup>
      <AppIconPicker />
      <SettingsGroup title="Text">
        <FontRow title="Interface font" description="Menus, panels, labels and the assistant's chat." fonts={FONTS} which="font" />
        <FontRow title="Numbers and code" description="Times, values, the position and tempo displays, expressions." fonts={MONO_FONTS} which="monoFont" />
        <FontSample />
      </SettingsGroup>
      <LogSettings />
    </>
  );
}

const CHOICES: { id: ThemeChoice; name: string; description: string }[] = [
  { id: "system", name: "System", description: "Follows your computer" },
  ...THEMES.map(({ id, name, description }) => ({ id, name, description })),
];

/** Every theme as a small picture of the app drawn in it, to pick one; System first. */
export function ThemePicker() {
  const choice = useTheme((s) => s.choice);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3">
      {CHOICES.map((t) => (
        <ThemeCard key={t.id} choice={t.id} name={t.name} description={t.description} selected={t.id === choice} onPick={() => useTheme.getState().setTheme(t.id)} />
      ))}
    </div>
  );
}

function ThemeCard({ choice, name, description, selected, onPick }: { choice: ThemeChoice; name: string; description: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      data-theme-option={choice}
      onClick={onPick}
      className={cn(
        "group flex flex-col gap-2 rounded-md p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "bg-brand/12 ring-2 ring-brand" : "hover:bg-accent/60",
      )}
    >
      {choice === "system" ? (
        // Light and Dark side by side, the way the computer may show either.
        <span className="relative block h-24">
          <ThemePreview theme="light" className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]" />
          <ThemePreview theme="dark" className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
        </span>
      ) : (
        <ThemePreview theme={choice} />
      )}
      <span className="flex items-start gap-2 px-1 pb-0.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        {selected && (
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground">
            <PiCheckBold className="size-2.5" />
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * A theme drawn small: the sidebar, a toolbar with a raised, a pressed and an accent button, a panel with a
 * field and a few lines of text. It wears the theme's own classes, so it's that theme's real values.
 */
export function ThemePreview({ theme, className }: { theme: ThemeId; className?: string }) {
  return (
    <span aria-hidden className={cn(themeClasses(theme), "flex h-24 overflow-hidden rounded-sm border border-line bg-surface-0 text-foreground", className)}>
      <span className="flex w-1/4 flex-col gap-1.5 border-r border-line bg-surface-1 p-1.5">
        <span className="h-1.5 w-3/4 rounded-full bg-foreground/80" />
        <span className="h-3 rounded-[2px] bg-accent" />
        <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/70" />
        <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/70" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 items-center gap-1 border-b border-line bg-surface-1 px-1.5">
          <span className="raised h-3 w-5 rounded-[2px]" />
          <span className="pressed h-3 w-5 rounded-[2px]" />
          <span className="raised-brand ml-auto h-3 w-7 rounded-[2px]" />
        </span>
        <span className="flex flex-1 flex-col gap-1.5 bg-surface-2 p-1.5">
          <span className="sunken h-3.5 w-full rounded-[2px]" />
          <span className="h-1.5 w-5/6 rounded-full bg-foreground/80" />
          <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/70" />
          <span className="mt-auto flex items-center gap-1">
            <span className="h-2 w-6 rounded-full bg-brand" />
            <span className="h-2 flex-1 rounded-full bg-sunken" />
          </span>
        </span>
      </span>
    </span>
  );
}

function FontRow({ title, description, fonts, which }: { title: string; description: string; fonts: FontChoice[]; which: "font" | "monoFont" }) {
  const value = useTheme((s) => s[which]);
  const set = (id: string) => (which === "font" ? useTheme.getState().setFont(id) : useTheme.getState().setMonoFont(id));
  return (
    <SettingsRow title={title} description={description}>
      <Select value={value} onValueChange={set}>
        <SelectTrigger size="sm" className="w-44" aria-label={title}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fonts.map((f) => (
            <SelectItem key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

/** The fonts picked, as they'll read: a label and a time. */
function FontSample() {
  return (
    <div className="flex items-baseline gap-4 bg-sunken/50 px-4 py-3" data-testid="font-sample">
      <span className="min-w-0 flex-1 truncate text-[15px]">Quick brown foxes cut to the beat</span>
      <span className="shrink-0 font-mono text-[13px] text-muted-foreground tabular-nums">00:01:24:12 · 128 BPM</span>
    </div>
  );
}
