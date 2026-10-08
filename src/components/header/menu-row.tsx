import type { ReactNode } from "react";
import { cn } from "cn";
import { MenuBarSlot } from "@/components/home/menu-bar";

/**
 * The row under the tabs: the project's name (and what goes with it: the video's format, the photo's save state),
 * its menus (`SuiteMenuBar` fills them in), then `children` and `actions` (`HeaderActions`, or Settings alone while
 * a project loads). A suite's own tools go in a row of their own below it (the music editor, short of height, has
 * its menus in its toolbar instead: `MenuBarSlot` goes anywhere). It drags the desktop app's window, as a title bar.
 */
export function MenuRow({ name, children, actions, className }: { name?: ReactNode; children?: ReactNode; actions: ReactNode; className?: string }) {
  return (
    <header data-titlebar="header" className={cn("flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3 select-none", className)}>
      {name && (
        <>
          <div className="flex min-w-0 shrink items-center gap-2">{name}</div>
          <div aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
        </>
      )}
      <MenuBarSlot />
      {children}
      {actions}
    </header>
  );
}
