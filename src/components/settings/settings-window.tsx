import { type KeyboardEvent as ReactKeyboardEvent, Suspense, useEffect, useRef, useState } from "react";
import { PiGearSix, PiPushPin, PiSpinnerGap } from "react-icons/pi";
import { cn } from "cn";
import { SUITE_IDS, SUITES, type SuiteId, suiteNoun } from "@shared/suites";
import { Button } from "@/components/ui/button";
import { FloatingWindow } from "@/components/windows/floating-window";
import type { WindowPlace } from "@/components/windows/store";
import { clientSuite } from "@/suites";
import { projectSuite, useProjects } from "@/stores/projects";
import { type SettingsSection, useSettings } from "@/stores/settings";
import { GeneralSettings } from "./general-settings";
import { SettingsGroup, SettingsRow } from "./settings-ui";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
/** Settings' shortcut, as menus and tooltips show it. */
export const SETTINGS_KEYS = `${MOD},`;

/** A tab's name, the line at the top of it, and its icon. */
function sectionInfo(section: SettingsSection) {
  if (section === "general") return { title: "General", description: "How the whole app looks: its theme and its fonts.", icon: PiGearSix, tint: "bg-surface-3 text-muted-foreground" };
  const suite = clientSuite(section);
  return { title: suite.settings.title, description: suite.settings.description, icon: suite.icon, tint: suite.tint };
}

const SECTIONS: SettingsSection[] = ["general", ...SUITE_IDS];

/**
 * ⌘, opens Settings on the open project's suite (General when none is open), and closes it again. It's
 * the app's, so it works whichever suite has the keyboard; not over another dialog, which would sit on top.
 */
export function useSettingsShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "," || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const settings = useSettings.getState();
      if (settings.open) return settings.close();
      if (document.querySelector(":is([role=dialog], [role=alertdialog])[data-state=open]")) return;
      settings.show(projectSuite(useProjects.getState().openId) ?? "general");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

/** Where Settings first opens: the middle of the window, a little above it, as big as there's room for. */
function firstPlace(): WindowPlace {
  const width = Math.min(860, window.innerWidth - 64);
  const height = Math.min(640, window.innerHeight - 96);
  return { x: Math.max(0, Math.round((window.innerWidth - width) / 2)), y: Math.max(48, Math.round((window.innerHeight - height) / 3)), width, height };
}

/**
 * Settings, a window over the whole app (`useSettings`) as FL Studio's is: a tab for the app (General)
 * and one per suite. It doesn't stop the app under it being used (a song keeps playing, a click on the
 * timeline works), but keys pressed in it are its own (`keepsKeys`): Esc closes it, and the editors'
 * shortcuts leave them alone.
 */
export function SettingsWindow() {
  const section = useSettings((s) => s.section);
  const [initial] = useState(firstPlace);
  const panelRef = useRef<HTMLDivElement>(null);
  const info = sectionInfo(section);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // The arrows go from tab to tab (and Home, End to the first and last), as in any list of tabs.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = SECTIONS.indexOf(section);
    const to =
      e.key === "ArrowRight" ? (at + 1) % SECTIONS.length
      : e.key === "ArrowLeft" ? (at - 1 + SECTIONS.length) % SECTIONS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? SECTIONS.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    useSettings.getState().setSection(SECTIONS[to]);
    e.currentTarget.querySelector<HTMLElement>(`[data-settings-section="${SECTIONS[to]}"]`)?.focus();
  };

  return (
    <FloatingWindow id="settings" title="Settings" initial={initial} resizable={{ minWidth: 520, minHeight: 360 }} keepsKeys onClose={() => useSettings.getState().close()}>
      <div data-settings className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface-1 px-2 py-1.5">
          <div role="tablist" aria-label="Settings sections" className="flex min-w-0 items-center gap-1" onKeyDown={onTabKey}>
            {SECTIONS.map((id) => (
              <SectionTab key={id} section={id} selected={id === section} />
            ))}
          </div>
          <span className="ml-auto shrink-0 truncate pl-3 text-[11px] text-muted-foreground">
            <kbd className="font-sans">{SETTINGS_KEYS}</kbd> opens it on the app you're in
          </span>
        </div>
        <div ref={panelRef} role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${section}`} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 pt-5 pb-12">
            <p className="-mb-2 px-1 text-[13px] text-muted-foreground">{info.description}</p>
            {section === "general" ? <GeneralSettings /> : <SuiteSection suite={section} />}
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}

function SectionTab({ section, selected }: { section: SettingsSection; selected: boolean }) {
  const { title, icon: Icon, tint } = sectionInfo(section);
  return (
    <button
      type="button"
      role="tab"
      id={`settings-tab-${section}`}
      aria-selected={selected}
      aria-controls="settings-panel"
      tabIndex={selected ? 0 : -1}
      data-settings-section={section}
      // The focus goes to the tab shown when Settings opens.
      data-autofocus={selected || undefined}
      onClick={() => useSettings.getState().setSection(section)}
      className={cn(
        "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-sm", tint)}>
        <Icon className="size-3" />
      </span>
      {title}
    </button>
  );
}

function SuiteSection({ suite }: { suite: SuiteId }) {
  const { Panel } = clientSuite(suite).settings;
  return (
    <>
      <Suspense
        fallback={
          <div className="grid h-40 place-items-center text-muted-foreground">
            <PiSpinnerGap className="size-5 animate-spin" />
          </div>
        }
      >
        <Panel />
      </Suspense>
      <StartingPoint suite={suite} />
    </>
  );
}

/** Where a suite's new projects start: blank, or a copy of one of the user's (the sidebar's "Use as starting point"). */
function StartingPoint({ suite }: { suite: SuiteId }) {
  const template = useProjects((s) => s.templates[suite]);
  const noun = suiteNoun(suite);
  const nouns = suiteNoun(suite, 2);
  return (
    <SettingsGroup title={`New ${nouns}`}>
      <SettingsRow
        title="Starting point"
        description={
          template ? (
            <span className="flex min-w-0 items-center gap-1 text-brand">
              <PiPushPin className="size-3 shrink-0" />
              <span className="truncate">
                New {nouns} start as a copy of “{template.name}”.
              </span>
            </span>
          ) : (
            `New ${nouns} start blank. To start each one from a ${noun} of yours, pick “Use as starting point” in its menu in the sidebar.`
          )
        }
      >
        {template && (
          <Button variant="outline" size="sm" onClick={() => void useProjects.getState().clearTemplate(suite)} aria-label={`Start new ${SUITES[suite].label} projects blank`}>
            Start blank
          </Button>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
