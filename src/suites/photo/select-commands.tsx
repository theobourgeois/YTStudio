/**
 * The Select menu's commands where the user meets them (docs/photo/selections.md): the header's Select menu, the
 * canvas's right-click menu, Select Subject's question before its model is downloaded, and Feather's radius. What
 * they do is `selecting.ts`'s and `subject-model.ts`'s.
 */
import { useState } from "react";
import { toast } from "sonner";
import { PiCaretDown } from "react-icons/pi";
import { errorMessage } from "@shared/errors";
import type { SelectionMode } from "@shared/photo/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { create } from "zustand";
import { selectActions } from "./selecting";
import { useSelection } from "./store";
import { SubjectModelMissing, downloadSubjectModel, selectSubject, useSubjectModel } from "./subject-model";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** A shortcut as this platform writes it (⌘ on a Mac, Ctrl elsewhere). */
export const keys = (mac: string, other: string) => (MAC ? mac : other);

/** Feather's window: open, with the radius last used. */
export const useFeather = create<{ open: boolean; radius: number }>(() => ({ open: false, radius: 5 }));

/**
 * Select › Subject, from a click: the model finds the subject, meeting the selection by `mode`. Without the model,
 * the user is asked before it's downloaded; it runs once it's here.
 */
export async function runSelectSubject(mode: SelectionMode = "new") {
  if (useSubjectModel.getState().running) return;
  const working = toast.loading("Selecting the subject…");
  try {
    const s = await selectSubject(mode);
    toast.dismiss(working);
    if (!s) toast("No subject was found.");
  } catch (error) {
    toast.dismiss(working);
    if (error instanceof SubjectModelMissing) {
      if (error.status.status === "downloading") toast(error.message);
      else useSubjectModel.setState({ asking: true, pending: mode });
      return;
    }
    toast.error("Select Subject didn't work", { description: errorMessage(error) });
  }
}

/** The header's Select menu (Photoshop's). */
export function SelectMenu() {
  const selection = useSelection();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-select-menu>
          Select <PiCaretDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={selectActions.all}>
          All <DropdownMenuShortcut>{keys("⌘A", "Ctrl+A")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!selection} onSelect={selectActions.deselect}>
          Deselect <DropdownMenuShortcut>{keys("⌘D", "Ctrl+D")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!selection} onSelect={selectActions.inverse}>
          Inverse <DropdownMenuShortcut>{keys("⇧⌘I", "Shift+Ctrl+I")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void runSelectSubject()} data-select-subject>
          Subject
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!selection} onSelect={() => useFeather.setState({ open: true })}>
          Feather… <DropdownMenuShortcut>{keys("⇧F6", "Shift+F6")}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Select › Modify › Feather's window: the radius, then OK. */
export function FeatherDialog() {
  const open = useFeather((s) => s.open);
  const [value, setValue] = useState(() => String(useFeather.getState().radius));
  const radius = Number(value);
  const valid = Number.isFinite(radius) && radius > 0 && radius <= 250;
  const close = () => useFeather.setState({ open: false });
  const apply = () => {
    if (!valid) return;
    useFeather.setState({ open: false, radius });
    selectActions.feather(radius);
  };
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent data-feather-dialog>
        <AlertDialogHeader>
          <AlertDialogTitle>Feather Selection</AlertDialogTitle>
          <AlertDialogDescription>Softens the selection's edge by this many pixels each way.</AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-sm">
          Feather Radius
          <Input
            className="w-24"
            value={value}
            inputMode="decimal"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            autoFocus
            data-feather-radius
          />
          px
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={!valid} onClick={apply}>
            OK
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The question before Select Subject's model is downloaded (once per computer), and its progress after. */
export function SubjectModelDialog() {
  const asking = useSubjectModel((s) => s.asking);
  const size = useSubjectModel((s) => s.status?.size ?? 0);
  const error = useSubjectModel((s) => s.status?.error ?? null);
  const close = () => useSubjectModel.setState({ asking: false, pending: null });
  const download = async () => {
    const pending = useSubjectModel.getState().pending;
    const progress = toast.loading("Downloading the subject model…");
    const stop = useSubjectModel.subscribe((s) => {
      if (s.status?.status === "downloading") toast.loading(`Downloading the subject model… ${Math.round((s.status.progress ?? 0) * 100)}%`, { id: progress });
    });
    try {
      const status = await downloadSubjectModel();
      toast.dismiss(progress);
      if (status.status !== "ready") return void toast.error("The subject model didn't download", { description: status.error ?? undefined });
      if (pending) await runSelectSubject(pending);
    } catch (e) {
      toast.dismiss(progress);
      toast.error("The subject model didn't download", { description: errorMessage(e) });
    } finally {
      stop();
      useSubjectModel.setState({ pending: null });
    }
  };
  return (
    <AlertDialog open={asking} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent data-subject-download>
        <AlertDialogHeader>
          <AlertDialogTitle>Download Select Subject's model?</AlertDialogTitle>
          <AlertDialogDescription>
            Select Subject finds the main subject with a segmentation model (IS-Net) that runs on this computer. It's {Math.round(size / 1e6) || 88} MB, downloaded
            once from Hugging Face; nothing of your photos leaves this computer.
            {error ? ` The last try failed: ${error}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <Button onClick={() => void download()} data-autofocus>
            Download
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
