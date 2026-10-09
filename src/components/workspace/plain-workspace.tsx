import type { ReactNode } from "react";
import { PiSpinnerGap } from "react-icons/pi";
import { MenuRow } from "@/components/header/menu-row";
import { WindowButtons } from "@/components/header/window-buttons";
import { SettingsButton } from "@/components/settings/settings-button";
import { Button } from "@/components/ui/button";

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

export function WorkspaceLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <PiSpinnerGap className="size-5 animate-spin" />
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
