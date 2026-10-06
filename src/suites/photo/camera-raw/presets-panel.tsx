/**
 * Camera Raw's Presets (docs/photo/camera-raw.md, "CR3"): the built-in looks and the user's own (this computer's,
 * saved from the window's settings), each a card with the picture developed by it. Hovering a card shows it on the
 * canvas (Camera Raw's hover preview); a click applies it (over the defaults: a preset is a whole look).
 */
import { useEffect, useState } from "react";
import { PiFloppyDisk, PiX } from "react-icons/pi";
import { CAMERA_RAW_PARAMS, CAMERA_RAW_PRESETS } from "@shared/photo/effects/camera-raw/index";
import { defaultParams } from "@shared/photo/effects/params";
import { createId } from "@shared/ids";
import type { EffectParamValue, PhotoProject } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import type { CameraRawTarget } from "../ui";
import { cameraRawEdit } from "./actions";
import { targetDoc, thumbnail } from "./pictures";

/** A preset in the window: its settings (only what it changes). */
interface CardPreset {
  id: string;
  label: string;
  description: string;
  params: Record<string, EffectParamValue>;
  own?: true;
}

const OWN_KEY = "photo.cameraRaw.presets";

function ownPresets(): CardPreset[] {
  try {
    const saved = JSON.parse(localStorage.getItem(OWN_KEY) ?? "[]") as CardPreset[];
    return Array.isArray(saved) ? saved.filter((p) => p && typeof p.id === "string" && typeof p.label === "string" && p.params && typeof p.params === "object").map((p) => ({ ...p, own: true as const })) : [];
  } catch {
    return [];
  }
}

const saveOwn = (presets: CardPreset[]) => localStorage.setItem(OWN_KEY, JSON.stringify(presets.map(({ own: _, ...p }) => p)));

/** A preset's whole settings: the defaults with its own over them. */
export const presetSettings = (params: Record<string, EffectParamValue>) => ({ ...defaultParams(CAMERA_RAW_PARAMS), ...structuredClone(params) });

/** What differs from the defaults (what a saved preset keeps). */
function changed(params: Record<string, EffectParamValue>) {
  const defaults = defaultParams(CAMERA_RAW_PARAMS);
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => k in defaults && JSON.stringify(v) !== JSON.stringify(defaults[k])));
}

export function PresetsPanel({
  baseDoc,
  target,
  draft,
  onHover,
  onApply,
}: {
  baseDoc: PhotoProject;
  target: CameraRawTarget;
  draft: Record<string, EffectParamValue>;
  onHover: (params: Record<string, EffectParamValue> | null) => void;
  onApply: (params: Record<string, EffectParamValue>) => void;
}) {
  const [own, setOwn] = useState(ownPresets);
  const [naming, setNaming] = useState<string | null>(null);
  const builtIn: CardPreset[] = CAMERA_RAW_PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description, params: p.params(baseDoc.canvas) }));
  const all = [...own, ...builtIn];
  const pictures = usePictures(baseDoc, target, all);

  const save = () => {
    const label = naming?.trim();
    if (!label) return setNaming(null);
    const next = [{ id: createId("crp"), label, description: "Your preset", params: changed(draft), own: true as const }, ...own];
    saveOwn(next);
    setOwn(next);
    setNaming(null);
  };
  const remove = (id: string) => {
    const next = own.filter((p) => p.id !== id);
    saveOwn(next);
    setOwn(next);
  };

  const card = (p: CardPreset) => (
    <div key={p.id} className="group relative">
      <button
        type="button"
        className="flex w-full flex-col gap-1 rounded p-1 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
        title={p.description}
        onPointerEnter={() => onHover(presetSettings(p.params))}
        onPointerLeave={() => onHover(null)}
        onClick={() => {
          onHover(null);
          onApply(presetSettings(p.params));
        }}
        data-preset={p.id}
      >
        <span className="sunken block aspect-[4/3] w-full overflow-hidden rounded bg-surface-0">
          {pictures[p.id] && <img src={pictures[p.id]} alt="" className="size-full object-cover" draggable={false} />}
        </span>
        <span className="truncate text-[11px]">{p.label}</span>
      </button>
      {p.own && (
        <button type="button" aria-label={`Delete preset ${p.label}`} className="absolute top-1.5 right-1.5 hidden size-4 place-items-center rounded bg-black/60 text-white group-hover:grid" onClick={() => remove(p.id)}>
          <PiX className="size-3" />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 py-3" data-camera-raw-presets>
      <div className="flex items-center gap-1">
        {naming === null ? (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={() => setNaming("")}>
            <PiFloppyDisk /> Save current settings…
          </Button>
        ) : (
          <form
            className="flex flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              aria-label="Preset name"
              placeholder="Preset name"
              className="h-6 min-w-0 flex-1 rounded border border-line bg-surface-0 px-1.5 text-xs outline-none focus:border-brand"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNaming(null);
                }
              }}
            />
            <Button size="sm" type="submit" className="h-6 px-2 text-xs">
              Save
            </Button>
          </form>
        )}
      </div>
      {own.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Yours</span>
          <div className="grid grid-cols-2 gap-1">{own.map(card)}</div>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase">Looks</span>
        <div className="grid grid-cols-2 gap-1">{builtIn.map(card)}</div>
      </section>
    </div>
  );
}

/** Each preset's picture: the target developed by it (rendered one at a time, kept while the panel is open). */
function usePictures(baseDoc: PhotoProject, target: CameraRawTarget, presets: CardPreset[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ids = presets.map((p) => p.id).join(",");
  useEffect(() => {
    let stopped = false;
    const made: string[] = [];
    void (async () => {
      for (const p of presets) {
        if (stopped) return;
        const doc = targetDoc(cameraRawEdit(target, presetSettings(p.params))(baseDoc), target, true);
        const blob = doc ? await thumbnail(doc, 160).catch(() => null) : null;
        if (stopped || !blob) continue;
        const url = URL.createObjectURL(blob);
        made.push(url);
        setUrls((u) => ({ ...u, [p.id]: url }));
      }
    })();
    return () => {
      stopped = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
    // The presets by id: a new list with the same ones needs no new pictures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDoc, target, ids]);
  return urls;
}
