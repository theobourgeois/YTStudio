import { type KeyboardEvent, type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SUITE_IDS, SUITES, type SuiteId } from "@shared/suites";
import { cn } from "cn";
import { create } from "zustand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FILE_MANAGER } from "@/lib/key-labels";
import { useLayout } from "@/stores/layout";
import { projectSuite, useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { clientSuite } from "@/suites";
import { SETTINGS_KEYS } from "@/components/settings/settings-window";
import { showOpenDialog } from "./open-project-dialog";
import { CLOSE_TAB_KEYS, HOME_KEYS, NEW_PROJECT_KEYS, OPEN_KEYS, PROJECT_SEARCH_KEYS } from "./project-search-dialog";
import { log } from "@/lib/log";

const logger = log("menus");

/** One of a suite's own menus (Image, Patterns…): its name and its items (`components/ui/dropdown-menu`'s). */
export interface SuiteMenu {
  label: string;
  items: ReactNode;
}

/**
 * What a suite puts in the menu bar. The bar is the same in every suite (File, Edit, View, the suite's own,
 * Window), so moving between them nothing moves: a suite only fills it in.
 */
export interface SuiteMenus {
  /** File's own items, between Open and Show in Finder (Export…). */
  file?: ReactNode;
  /** Edit's items (undo, the clipboard…); Settings… follows them. */
  edit: ReactNode;
  view: ReactNode;
  /** Its own menus, between View and Window. */
  menus?: SuiteMenu[];
  /** Its panels or windows. */
  window: ReactNode;
}

/** Where the menus go (the tab strip's slot), and whether a suite's workspace has put its own there. */
const useMenuSlot = create<{ slot: HTMLElement | null; claimed: boolean }>(() => ({ slot: null, claimed: false }));

/** Every menu name a suite's bar has, in order (`appMenus`, with the suite's own from its `ClientSuite.menus`). */
const menuNames = (suite: SuiteId) => ["File", "Edit", "View", ...clientSuite(suite).menus, "Window"];

/**
 * In the tab strip: the open suite's menus once its workspace gives them (`SuiteMenuBar`), else the app's own.
 * It's always as wide as the widest suite's bar (each laid out unseen in the same cell, so in whatever font
 * is chosen), so the tabs after it stay where they are whichever project is shown, Home and loading included.
 */
export function MenuBarSlot() {
  const claimed = useMenuSlot((s) => s.claimed);
  return (
    <div className="grid shrink-0 self-center">
      {SUITE_IDS.map((suite) => (
        <div key={suite} aria-hidden className="invisible col-start-1 row-start-1 flex">
          {menuNames(suite).map((name) => (
            <span key={name} className={MENU_NAME}>
              {name}
            </span>
          ))}
        </div>
      ))}
      <div ref={(slot) => useMenuSlot.setState({ slot })} className="col-start-1 row-start-1 flex">
        {!claimed && <MenuBar menus={appMenus()} />}
      </div>
    </div>
  );
}

/**
 * A suite's menus, drawn in the tab strip. Its workspace renders this, so the items read its store only once
 * a project is open, and the windows they open live where the workspace keeps them.
 */
export function SuiteMenuBar(menus: SuiteMenus) {
  const slot = useMenuSlot((s) => s.slot);
  if (import.meta.env.DEV) {
    // The strip's room is worked out from the names the suite declares: they must be these.
    const suite = projectSuite(useProjects.getState().openId);
    const names = ["File", "Edit", "View", ...(menus.menus ?? []).map((m) => m.label), "Window"].join();
    if (suite && menuNames(suite).join() !== names) logger.error(`the ${suite} suite's \`menus\` (${menuNames(suite).join()}) aren't its menu bar's (${names})`);
  }
  useLayoutEffect(() => {
    useMenuSlot.setState({ claimed: true });
    return () => useMenuSlot.setState({ claimed: false });
  }, []);
  return slot ? createPortal(<MenuBar menus={appMenus(menus)} />, slot) : null;
}

/** The bar's menus: the app's File and Edit around the suite's items, then its View, own menus and Window. */
function appMenus(suite?: SuiteMenus): SuiteMenu[] {
  const edit = (
    <>
      {suite?.edit}
      {suite?.edit && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={() => useSettings.getState().show(projectSuite(useProjects.getState().openId) ?? "general")}>
        Settings… <DropdownMenuShortcut>{SETTINGS_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
  return [
    { label: "File", items: <FileItems>{suite?.file}</FileItems> },
    { label: "Edit", items: edit },
    ...(suite ? [{ label: "View", items: suite.view }, ...(suite.menus ?? []), { label: "Window", items: suite.window }] : []),
  ];
}

/** The app's File menu: new and open (any suite), the suite's own (`children`), then the open project's tab. */
function FileItems({ children }: { children?: ReactNode }) {
  const open = useProjects((s) => s.openId !== null);
  const projects = useProjects.getState;
  const reveal = () => {
    const { openId, reveal } = projects();
    if (openId) void reveal(openId);
  };
  const closeTab = () => {
    const { openId, closeTab } = projects();
    if (openId) void closeTab(openId);
  };
  return (
    <>
      {SUITE_IDS.map((suite) => (
        <DropdownMenuItem key={suite} onSelect={() => void projects().create({ suite })}>
          New {SUITES[suite].noun[0].toUpperCase() + SUITES[suite].noun.slice(1)}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onSelect={() => useLayout.getState().setNewProjectOpen(true)}>
        New Project… <DropdownMenuShortcut>{NEW_PROJECT_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => showOpenDialog()}>
        Open… <DropdownMenuShortcut>{OPEN_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => useLayout.getState().setProjectSearchOpen(true)}>
        Find Project… <DropdownMenuShortcut>{PROJECT_SEARCH_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
      {children && <DropdownMenuSeparator />}
      {children}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!open} onSelect={reveal}>
        Show in {FILE_MANAGER}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void projects().goHome()}>
        Home <DropdownMenuShortcut>{HOME_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!open} onSelect={closeTab}>
        Close Tab <DropdownMenuShortcut>{CLOSE_TAB_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

/** A menu's name in the bar (and in the slot's unseen copies, which must measure the same). */
const MENU_NAME = "flex h-7 items-center px-2 text-[13px]";

/**
 * A menu bar, as a desktop app's: press a name to open its menu; while one is open, the pointer moving onto
 * another name opens that one, and ← / → step through them. Each is a `DropdownMenu`, not modal, so the bar
 * stays live under an open menu.
 */
function MenuBar({ menus }: { menus: SuiteMenu[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const step = (e: KeyboardEvent, from: number) => {
    const target = e.target as HTMLElement;
    // A submenu's keys are its own (→ opens it, ← closes it).
    if (target.closest("[data-slot=dropdown-menu-sub-content]") || (e.key === "ArrowRight" && target.closest("[data-slot=dropdown-menu-sub-trigger]"))) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setOpen(menus[(from + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length].label);
  };
  return (
    <div role="menubar" aria-label="Menus" className="flex items-center">
      {menus.map((menu, i) => (
        <DropdownMenu
          key={menu.label}
          modal={false}
          open={open === menu.label}
          // Another menu may have opened already (the pointer moved onto it): only this one closes.
          onOpenChange={(next) => setOpen((current) => (next ? menu.label : current === menu.label ? null : current))}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              role="menuitem"
              data-menu={menu.label.toLowerCase()}
              className={cn(MENU_NAME, "rounded-md text-foreground outline-none hover:bg-accent/60 focus-visible:bg-accent data-[state=open]:bg-accent")}
              onPointerEnter={() => open && open !== menu.label && setOpen(menu.label)}
            >
              {menu.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            // Gone at once when closed, as a desktop app's (a menu fading out still takes Escape from what opened).
            className="min-w-56 data-[state=closed]:animate-none"
            onKeyDown={(e) => step(e, i)}
            // The focus isn't given back to the bar, as a desktop app's: a window or dialog the item opened keeps it,
            // and the editor's keys (Space to play) aren't a press of the menu's name.
            onCloseAutoFocus={(e) => e.preventDefault()}
            // Nor does it close when the focus is moved from under it (another menu, closing, gives the focus back to
            // its button): only a press outside, Escape or an item does, as a desktop app's.
            onFocusOutside={(e) => e.preventDefault()}
          >
            {menu.items}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
