import type { ProjectSummary } from "@shared/types";
import { suiteNoun } from "@shared/suites";
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

interface TrashProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectSummary;
  onConfirm: () => void;
}

/** Asks before a project's package goes to the Trash (with its media); Remove from Recents is the gentler way. */
export function TrashProjectDialog({ open, onOpenChange, project, onConfirm }: TrashProjectDialogProps) {
  const noun = suiteNoun(project.suite);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base break-all">Move “{project.name}” to the Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            The {noun} and everything imported into it go with it. You can get it back from the Trash until
            it's emptied. To only take it off this list, remove it from the recents instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
