/**
 * Asking for the models a filter's scene maps need (docs/photo/effects/scene-maps.md): the depth model (Lens Blur, Fog…)
 * or Select Subject's (Aura, Apply To…). Downloaded once per computer, only when the user says yes; the renderer asks
 * (`SceneMapStore.onMissing`) when a filter needs one, and Properties says so beside the filter until it's here.
 */
import { useEffect } from "react";
import { PiCubeFocus, PiDownloadSimple } from "react-icons/pi";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { EffectDefinition } from "@shared/photo/effects/index";
import type { EffectParamValue } from "@shared/photo/types";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { liveRenderer } from "./live";
import { MODEL_SIZES, type PhotoModel, downloadModel, modelStatus, usePhotoModels } from "./scene-models";

const ABOUT: Record<PhotoModel, { title: string; what: string }> = {
  depth: {
    title: "Download the depth model?",
    what: "Depth filters (Lens Blur, Fog, Tilt-Shift…) see how far away each part of the photo is with a depth model (Depth Anything V2) that runs on this computer.",
  },
  subject: {
    title: "Download the subject model?",
    what: "Subject filters (Aura, Rim Light, Sticker) and Apply To find the photo's subject with Select Subject's model (IS-Net), which runs on this computer.",
  },
};

/** Downloads a model, saying how it goes, then has the renderer build what was waiting for it. */
export async function fetchModel(model: PhotoModel) {
  const progress = toast.loading(`Downloading the ${model} model…`);
  const stop = usePhotoModels.subscribe((s) => {
    const status = s.status[model];
    if (status?.status === "downloading") toast.loading(`Downloading the ${model} model… ${Math.round((status.progress ?? 0) * 100)}%`, { id: progress });
  });
  try {
    const status = await downloadModel(model);
    toast.dismiss(progress);
    if (status.status !== "ready") return void toast.error(`The ${model} model didn't download`, { description: status.error ?? undefined });
    toast.success(`The ${model} model is ready`);
  } catch (e) {
    toast.dismiss(progress);
    toast.error(`The ${model} model didn't download`, { description: errorMessage(e) });
  } finally {
    stop();
    void liveRenderer()?.then((r) => r.scene.retry());
  }
}

/** The question before a scene model is downloaded (once per computer). */
export function SceneModelDialog() {
  const asking = usePhotoModels((s) => s.asking);
  const error = usePhotoModels((s) => (s.asking ? (s.status[s.asking]?.error ?? null) : null));
  const close = () => usePhotoModels.setState({ asking: null });
  const about = asking ? ABOUT[asking] : null;
  return (
    <AlertDialog open={!!asking} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent data-scene-model-download={asking ?? undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{about?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {about?.what} It's {asking ? Math.round(MODEL_SIZES[asking] / 1e6) : 0} MB, downloaded once from Hugging Face; nothing of your photos leaves this computer.
            {error ? ` The last try failed: ${error}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <Button
            onClick={() => {
              const model = asking;
              close();
              if (model) void fetchModel(model);
            }}
            data-autofocus
          >
            Download
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The models a filter needs with these settings that aren't here: a line saying so, and the download. */
export function SceneModelNote({ def, params }: { def: EffectDefinition; params: Record<string, EffectParamValue> }) {
  const reads = def.scene?.(params) ?? null;
  const status = usePhotoModels((s) => s.status);
  const needed: PhotoModel[] = reads ? (["depth", "subject"] as const).filter((m) => reads[m]) : [];
  const wanted = needed.join(",");
  useEffect(() => {
    for (const m of wanted.split(",").filter(Boolean) as PhotoModel[]) if (!usePhotoModels.getState().status[m]) void modelStatus(m).catch(() => {});
  }, [wanted]);
  const missing = needed.filter((m) => status[m] && status[m]!.status !== "ready");
  if (!missing.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-sm bg-sunken p-2 text-xs text-muted-foreground" data-scene-model-note={missing.join(",")}>
      {missing.map((m) => (
        <div key={m} className="flex items-center gap-2">
          <PiCubeFocus className="shrink-0" />
          <span className="flex-1">
            {status[m]!.status === "downloading"
              ? `The ${m} model is downloading (${Math.round((status[m]!.progress ?? 0) * 100)}%).`
              : `This needs the ${m} model (${Math.round(MODEL_SIZES[m] / 1e6)} MB, downloaded once): it changes nothing until it's here.`}
          </span>
          {status[m]!.status !== "downloading" && (
            <Button size="sm" variant="outline" onClick={() => void fetchModel(m)}>
              <PiDownloadSimple /> Download
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
