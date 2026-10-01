import { Suspense, useEffect, useRef } from "react";
import { PiArrowLeft, PiGearSix, PiPushPin, PiSpinnerGap } from "react-icons/pi";
import { cn } from "cn";
import { SUITE_IDS, SUITES, type SuiteId, suiteNoun } from "@shared/suites";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clientSuite } from "@/suites";
import { projectSuite, useProjects } from "@/stores/projects";
import { type SettingsSection, useSettings } from "@/stores/settings";
import { GeneralSettings } from "./general-settings";
import { SettingsGroup, SettingsRow } from "./settings-ui";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
/** Settings' shortcut, as menus and tooltips show it. */
export const SETTINGS_KEYS = `${MOD},`;

/** A section's name, the line under it, and its icon. */
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

/** Settings, a page of its own over the whole window (`useSettings`): its sections on the left. */
export function SettingsPage() {
  const open = useSettings((s) => s.open);
  return open ? <SettingsWindow /> : null;
}

function SettingsWindow() {
  const section = useSettings((s) => s.section);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const info = sectionInfo(section);

  // Focus moves in (to the page, so Tab goes on to its sections) and goes back where it was when Settings closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => before?.focus();
  }, []);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // Esc goes back, wherever the focus is (a field that's just been left gives it to the page).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      // An open menu or list closes first (one that's only fading out doesn't count).
      if (document.querySelector("[data-radix-popper-content-wrapper] [data-state=open]")) return;
      e.preventDefault();
      useSettings.getState().close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings" data-settings className="fixed inset-0 z-50 flex bg-background text-foreground outline-none">
      <nav aria-label="Settings sections" className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
        <div data-titlebar="settings" className="settings-titlebar flex h-13 shrink-0 items-center px-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => useSettings.getState().close()}>
                <PiArrowLeft />
                Back
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Back to the app
              <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">Esc</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 pt-1">
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Settings</p>
          {SECTIONS.map((id) => (
            <SectionButton key={id} section={id} selected={id === section} />
          ))}
        </div>
        <p className="mt-auto px-5 py-4 text-xs leading-5 text-muted-foreground">
          <kbd className="font-sans">{SETTINGS_KEYS}</kbd> opens these on the app you're in.
        </p>
      </nav>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto" aria-labelledby="settings-title">
        <header data-titlebar="settings" className="sticky top-0 z-10 flex h-13 items-center border-b border-line bg-background/95 px-10 backdrop-blur-sm">
          <h1 id="settings-title" className="text-[15px] font-semibold">
            {info.title}
          </h1>
        </header>
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-10 pt-6 pb-16">
          <p className="-mb-2 px-1 text-[13px] text-muted-foreground">{info.description}</p>
          {section === "general" ? <GeneralSettings /> : <SuiteSection suite={section} />}
        </div>
      </main>
    </div>
  );
}

function SectionButton({ section, selected }: { section: SettingsSection; selected: boolean }) {
  const { title, icon: Icon, tint } = sectionInfo(section);
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      data-settings-section={section}
      onClick={() => useSettings.getState().setSection(section)}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-sm", tint)}>
        <Icon className="size-3.5" />
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
