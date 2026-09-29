import { useEffect, useMemo, useState, type FormEvent } from "react";
import { create } from "zustand";
import { flattenFolders } from "@shared/library";
import { clipName, getClip } from "@shared/timeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
}

/** Asks for a name (a new folder, a rename). */
export function NameDialog({ open, onOpenChange, title, initial = "", confirmLabel, onConfirm }: NameDialogProps) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onConfirm(name.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-label="Name"
            spellCheck={false}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ open, onOpenChange, title, description, onConfirm }: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base break-all">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The clips the "Save to Library" dialog is saving (null while it's closed). */
export const useSaveToLibrary = create<{ clipIds: string[] | null; open: (clipIds: string[]) => void; close: () => void }>(
  (set) => ({
    clipIds: null,
    open: (clipIds) => set({ clipIds }),
    close: () => set({ clipIds: null }),
  }),
);

/** Value of the top level in the folder picker (Radix Select can't use ""). */
const TOP = "top";

/** Saves the selected timeline clips, with everything set on them, to a Library folder. */
export function SaveToLibraryDialog() {
  const clipIds = useSaveToLibrary((s) => s.clipIds);
  const folders = useLibrary((s) => s.folders);
  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(TOP);
  const [saving, setSaving] = useState(false);
  const count = clipIds?.length ?? 0;

  useEffect(() => {
    if (!clipIds) return;
    void useLibrary.getState().load();
    const { project, getAsset } = useEditor.getState();
    const first = getClip(project, clipIds[0]);
    setName(clipIds.length === 1 && first ? clipName(first, getAsset(first.assetId)).replace(/\.[^.]+$/, "") : "");
    // Where the Library tab is browsing, if that's a folder.
    const view = useLibrary.getState().view;
    setFolder(view.kind === "folder" && view.folderId ? view.folderId : TOP);
  }, [clipIds]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clipIds || !name.trim() || saving) return;
    setSaving(true);
    const saved = await useLibrary.getState().saveClips(clipIds, name.trim(), folder === TOP ? null : folder);
    setSaving(false);
    if (saved) useSaveToLibrary.getState().close();
  };

  return (
    <Dialog open={clipIds !== null} onOpenChange={(open) => !open && useSaveToLibrary.getState().close()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Save {count === 1 ? "clip" : `${count} clips`} to Library</DialogTitle>
            <DialogDescription>
              Keeps the trim, position, text, effects and transitions, so you can drop {count === 1 ? "it" : "them"}{" "}
              into any video as is.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="library-save-name">Name</Label>
            <Input
              id="library-save-name"
              autoFocus
              value={name}
              placeholder="e.g. Logo bottom right"
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="library-save-folder">Folder</Label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger id="library-save-folder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP}>Library</SelectItem>
                {flat.map(({ folder: f, depth }) => (
                  <SelectItem key={f.id} value={f.id} style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => useSaveToLibrary.getState().close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
