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

interface DeleteAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Number of timeline clips that will be removed along with the asset. */
  uses: number;
  onConfirm: () => void;
}

export function DeleteAssetDialog({ open, onOpenChange, name, uses, onConfirm }: DeleteAssetDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base break-all">Remove “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It's used in {uses} clip{uses === 1 ? "" : "s"} — {uses === 1 ? "it" : "they"}'ll be
            removed from the timeline.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
