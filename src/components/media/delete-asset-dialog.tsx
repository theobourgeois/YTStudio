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
  /** The file's name, when there's one. */
  name: string;
  /** How many files are being removed. */
  count: number;
  /** Number of timeline clips that will be removed along with them. */
  uses: number;
  onConfirm: () => void;
}

export function DeleteAssetDialog({ open, onOpenChange, name, count, uses, onConfirm }: DeleteAssetDialogProps) {
  const many = count > 1;
  const clips = `${uses} clip${uses === 1 ? "" : "s"}`;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base break-all">
            {many ? `Remove ${count} files?` : `Remove “${name}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {uses === 0
              ? `${many ? "They" : "It"}'ll be removed from this video's media.`
              : `${many ? "They're" : "It's"} used in ${clips} — ${uses === 1 ? "it" : "they"}'ll be removed from the timeline.`}
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
