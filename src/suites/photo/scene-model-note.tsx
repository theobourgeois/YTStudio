/**
 * A filter's scene maps need a model that isn't here (docs/photo/effects/scene-maps.md): the depth model (Lens Blur,
 * Fog…) or Select Subject's (Aura, Apply To…). Properties and the Filter Gallery say so beside the filter, with the
 * download (asked as every photo model is: `ModelDialog`), after which the maps are built.
 */
import { useEffect } from "react";
import { PiCubeFocus, PiDownloadSimple } from "react-icons/pi";
import type { EffectDefinition } from "@shared/photo/effects/index";
import { PHOTO_MODELS } from "@shared/photo/models";
import type { EffectParamValue } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { liveRenderer } from "./live";
import { modelApi, useModels } from "./models";

type SceneModel = "depth" | "subject";

/** Asks for a scene model's download; once it's here, the renderer builds what was waiting for it. */
export function askForSceneModel(model: SceneModel) {
  useModels.setState({ asking: { model, then: () => void liveRenderer()?.then((r) => r.scene.retry()) } });
}

/** The models a filter needs with these settings that aren't here: a line saying so, and the download. */
export function SceneModelNote({ def, params }: { def: EffectDefinition; params: Record<string, EffectParamValue> }) {
  const reads = def.scene?.(params) ?? null;
  const status = useModels((s) => s.status);
  const needed: SceneModel[] = reads ? (["depth", "subject"] as const).filter((m) => reads[m]) : [];
  const wanted = needed.join(",");
  useEffect(() => {
    for (const m of wanted.split(",").filter(Boolean) as SceneModel[]) {
      if (!useModels.getState().status[m]) void modelApi.status(m).then((s) => useModels.setState((st) => ({ status: { ...st.status, [m]: s } })), () => {});
    }
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
              : `This needs the ${m} model (${Math.round(PHOTO_MODELS[m].size / 1e6)} MB, downloaded once): it changes nothing until it's here.`}
          </span>
          {status[m]!.status !== "downloading" && (
            <Button size="sm" variant="outline" onClick={() => askForSceneModel(m)}>
              <PiDownloadSimple /> Download
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
