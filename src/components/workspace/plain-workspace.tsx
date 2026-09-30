import type { ReactNode } from "react";
import { PiSpinnerGap } from "react-icons/pi";
import { SidebarLead } from "@/components/header/header";
import { ThemeMenu } from "@/components/header/theme-menu";
import { Button } from "@/components/ui/button";

/** The main column with a bare header: for the empty state, and a suite's loading or error. */
export function PlainWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
        <SidebarLead />
        <div className="ml-auto">
          <ThemeMenu />
        </div>
      </header>
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
