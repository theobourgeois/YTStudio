import { useState } from "react";
import { create } from "zustand";
import type { ProjectSummary } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IS_MAC } from "@/lib/key-labels";
import { useProjects } from "@/stores/projects";

interface OpenDialogState {
  open: boolean;
  /** A missing project being looked for: the dialog starts where it was. */
  locate: ProjectSummary | null;
}

const useOpenDialog = create<OpenDialogState>(() => ({ open: false, locate: null }));

/**
 * Open a project from a file (Open…, ⌘O), or find a missing one (Locate…): the desktop app's own Open
 * dialog, else (a browser, which can't see the disk) this one, which asks for its path.
 */
export function showOpenDialog({ locate = null }: { locate?: ProjectSummary | null } = {}) {
  const parent = locate?.path.replace(/[/\\][^/\\]*$/, "");
  void useProjects.getState().chooseAndOpen(() => useOpenDialog.setState({ open: true, locate }), parent);
}

export function OpenProjectDialog() {
  const open = useOpenDialog((s) => s.open);
  return (
    <Dialog open={open} onOpenChange={(next) => useOpenDialog.setState({ open: next })}>
      <DialogContent className="sm:max-w-lg">{open && <PathForm />}</DialogContent>
    </Dialog>
  );
}

function PathForm() {
  const locate = useOpenDialog((s) => s.locate);
  const [path, setPath] = useState(locate?.path ?? "");
  const submit = () => {
    if (!path.trim()) return;
    useOpenDialog.setState({ open: false });
    void useProjects.getState().openFile(path.trim());
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="contents"
    >
      <DialogHeader>
        <DialogTitle>{locate ? `Where is “${locate.name}” now?` : "Open a project"}</DialogTitle>
        <DialogDescription>
          {locate
            ? "It isn't where it was last opened. Type where it is now: its .yt folder, or a file in it."
            : `Type where the project is on this computer: its .yt folder, or a file in it. ${IS_MAC ? "In Finder, ⌥⌘C" : "In File Explorer, Ctrl+Shift+C"} copies a file's path.`}
        </DialogDescription>
      </DialogHeader>
      <Input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Documents/YTStudio/My video.yt" aria-label="Project path" className="font-mono text-xs" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => useOpenDialog.setState({ open: false })}>
          Cancel
        </Button>
        <Button type="submit" disabled={!path.trim()}>
          Open
        </Button>
      </DialogFooter>
    </form>
  );
}
