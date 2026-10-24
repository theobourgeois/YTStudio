import type { ReactNode } from "react";
import { PiSpinnerGap } from "react-icons/pi";
import { MenuRow } from "@/components/header/menu-row";
import { WindowButtons } from "@/components/header/window-buttons";
import { SettingsButton } from "@/components/settings/settings-button";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/stores/projects";

/** The main column with a bare menu row (the app's own menus): for the empty state, and a suite's loading or error. */
export function PlainWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MenuRow
        actions={
          <div className="ml-auto flex items-center">
            <SettingsButton />
            <WindowButtons className="ml-1.5" />
          </div>
        }
      />
      {children}
    </div>
  );
}

/** A project on its way: what's opening, so an empty window never looks like an empty project. */
export function WorkspaceLoading() {
  const name = useProjects((s) => s.projects.find((p) => p.id === s.openId)?.name);
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground" role="status" data-testid="workspace-loading">
      <PiSpinnerGap className="size-5 animate-spin" aria-hidden />
      {name ? `Opening ${name}…` : "Opening…"}
    </div>
  );
}

/** A project that couldn't be opened. */
export function WorkspaceError({ noun, error }: { noun: string; error: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>
        Couldn't open this {noun}: {error}
      </p>
      <Button variant="outline" size="sm" onClick={() => location.reload()}>
        Reload
      </Button>
    </div>
  );
}
