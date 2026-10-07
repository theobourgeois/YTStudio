/**
 * The question before a photo model is downloaded (once per computer), and its progress after: the same for every
 * command that needs one (Select Subject, Content-Aware Fill). Saying yes runs the command once the model is here.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { PHOTO_MODELS, modelSize } from "@shared/photo/models";
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
import { downloadModel, useModels } from "./models";

export function ModelDialog() {
  const asking = useModels((s) => s.asking);
  const model = asking?.model ?? null;
  const spec = model ? PHOTO_MODELS[model] : null;
  const error = useModels((s) => (model ? (s.status[model]?.error ?? null) : null));
  const close = () => useModels.setState({ asking: null });
  const download = async () => {
    if (!asking || !spec) return;
    const { model, then } = asking;
    useModels.setState({ asking: null });
    const progress = toast.loading(`Downloading ${spec.command}'s model…`);
    try {
      const status = await downloadModel(model, (f) => toast.loading(`Downloading ${spec.command}'s model… ${Math.round(f * 100)}%`, { id: progress }));
      toast.dismiss(progress);
      if (status.status !== "ready") return void toast.error(`${spec.command}'s model didn't download`, { description: status.error ?? undefined });
      then?.();
    } catch (e) {
      toast.dismiss(progress);
      toast.error(`${spec.command}'s model didn't download`, { description: errorMessage(e) });
    }
  };
  return (
    <AlertDialog open={!!spec} onOpenChange={(o) => !o && close()}>
      {spec && (
        <AlertDialogContent data-model-download={model}>
          <AlertDialogHeader>
            <AlertDialogTitle>Download {spec.command}'s model?</AlertDialogTitle>
            <AlertDialogDescription>
              {spec.command} {spec.does} that runs on this computer. It's {Math.round(modelSize(spec) / 1e6)} MB, downloaded once from Hugging Face; nothing of your photos
              leaves this computer.
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
      )}
    </AlertDialog>
  );
}
