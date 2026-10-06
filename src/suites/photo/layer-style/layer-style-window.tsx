/**
 * The Layer Style window (docs/photo/layer-style/README.md, phase L1), opened by Blending Options… : Photoshop's
 * dialog, its list on the left (the effects join it as they're built), the page in the middle, OK / Cancel /
 * Preview on the right. Phase L1's page is Blending Options: the blend mode (previewed while hovered), Opacity,
 * Fill, the channels and Blend If.
 *
 * The whole window is one gesture: every change shows on the canvas at once and none is an undo step; OK makes them
 * one ("Layer Style"), Cancel (or Escape) puts the layer back as it was, ⌥ turns Cancel into Reset (back to how it
 * opened, still open). Preview off shows the layer as it was meanwhile. An edit made elsewhere ends the gesture
 * (keeping what was shown, as one undo step), and the window closes with it.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { BLEND_IF_CHANNELS, type BlendIfEntry, FULL_RANGE, blendingOf } from "@shared/photo/blending";
import { findLayer, setLayerBlending } from "@shared/photo/edits";
import type { BlendIf, BlendMode, BlendRange, PhotoLayer, PhotoProject } from "@shared/photo/types";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { FloatingWindow, centredOnDesktop } from "@/components/windows/floating-window";
import { BlendModeMenu } from "../panels/blend-mode-menu";
import { photoGesture, usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { BlendIfSlider } from "./blend-if-slider";

/** What the window edits: a layer's Blending Options, every one given (so applying it sets them all). */
interface Draft {
  blend: BlendMode;
  opacity: number;
  fill: number;
  channels: { r: boolean; g: boolean; b: boolean };
  blendIf: BlendIf;
}

const draftOf = (layer: PhotoLayer): Draft => {
  const b = blendingOf(layer);
  return { blend: b.mode, opacity: layer.opacity, fill: b.fill, channels: b.channels, blendIf: b.blendIf };
};

/** The edit that makes the layer's blending `d` (with `mode` shown instead of its own while one is hovered). */
const applyDraft = (layerId: string, d: Draft, mode: BlendMode | null = null) => (doc: PhotoProject) =>
  setLayerBlending(doc, [layerId], {
    blend: mode ?? d.blend,
    opacity: d.opacity,
    fill: d.fill,
    channels: d.channels,
    blendIf: Object.fromEntries(BLEND_IF_CHANNELS.map((e) => [e, d.blendIf[e] ?? null])),
  });

const ENTRY_LABELS: Record<BlendIfEntry, string> = { gray: "Gray", red: "Red", green: "Green", blue: "Blue" };
const ENTRY_COLOURS: Record<BlendIfEntry, string> = { gray: "#fff", red: "#f00", green: "#0f0", blue: "#00f" };

export function LayerStyleWindow({ layerId }: { layerId: string }) {
  const [initial] = useState(() => centredOnDesktop(720, 500, "photo"));
  const close = () => usePhotoUi.getState().setLayerStyle(null);
  // The layer as it was when the window opened, and the gesture everything previews in.
  const [session] = useState(() => ({ gesture: photoGesture(), base: findLayer(usePhoto.getState().history!.doc.doc, layerId)! }));
  const [draft, setDraft] = useState<Draft>(() => draftOf(session.base));
  const [preview, setPreview] = useState(true);
  const [hovered, setHovered] = useState<BlendMode | null>(null);
  const [entry, setEntry] = useState<BlendIfEntry>("gray");
  const [alt, setAlt] = useState(false);
  const finished = useRef(false);

  // Another edit ended the gesture (or the layer went): the window goes with it. Listening starts before the gesture
  // and stops before it's cancelled, so its own start and end (twice in development's StrictMode) don't count.
  useEffect(
    () =>
      usePhoto.subscribe((state) => {
        if (finished.current) return;
        if (!session.gesture.active || !state.history || !findLayer(state.history.doc.doc, layerId)) {
          finished.current = true;
          close();
        }
      }),
    [layerId, session],
  );

  // The gesture lasts while the window's open; closed any other way than OK, it's cancelled.
  useEffect(() => {
    session.gesture.begin();
    return () => {
      if (session.gesture.active) session.gesture.cancel();
    };
  }, [session]);

  // What the canvas shows follows the draft (or the layer as it was, with Preview off).
  useEffect(() => {
    if (!session.gesture.active) return;
    session.gesture.apply(preview ? applyDraft(layerId, draft, hovered) : applyDraft(layerId, draftOf(session.base)));
  }, [draft, preview, hovered, layerId, session]);

  // ⌥ turns Cancel into Reset, as Photoshop's.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => setAlt(e.altKey);
    const blur = () => setAlt(false);
    window.addEventListener("keydown", keys);
    window.addEventListener("keyup", keys);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keyup", keys);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const ok = () => {
    finished.current = true;
    session.gesture.apply(applyDraft(layerId, draft));
    session.gesture.end();
    close();
  };
  const cancel = () => {
    finished.current = true;
    session.gesture.cancel();
    close();
  };
  const reset = () => setDraft(draftOf(session.base));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setRange = (side: "layer" | "underlying", range: BlendRange) =>
    setDraft((d) => {
      const now = d.blendIf[entry] ?? { layer: FULL_RANGE, underlying: FULL_RANGE };
      return { ...d, blendIf: { ...d.blendIf, [entry]: { ...now, [side]: range } } };
    });
  const range = (side: "layer" | "underlying") => draft.blendIf[entry]?.[side] ?? FULL_RANGE;

  return (
    <FloatingWindow id="layer-style" title="Layer Style" initial={initial} keepsKeys escapeCloses onClose={cancel} className="w-[720px] max-w-full">
      <div
        className="flex min-h-0 gap-3 p-3 text-sm"
        data-layer-style
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(e.target as Element).closest("input, [role=slider], [role=menuitem]")) ok();
        }}
      >
        <nav className="flex w-40 shrink-0 flex-col rounded border border-line bg-surface-0 py-1" aria-label="Layer Style pages">
          <span className="bg-accent px-2.5 py-1.5 font-medium" aria-current="page">
            Blending Options
          </span>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3" data-page="blending-options">
          <Group title="General Blending">
            <Row label="Blend Mode:">
              <BlendModeMenu
                className="w-44"
                value={draft.blend}
                onPreview={setHovered}
                onChoose={(blend) => {
                  setHovered(null);
                  set({ blend });
                }}
              />
            </Row>
            <Row label="Opacity:">
              <PercentSlider label="Opacity" value={draft.opacity} onChange={(opacity) => set({ opacity })} />
            </Row>
          </Group>
          <Group title="Advanced Blending">
            <Row label="Fill Opacity:">
              <PercentSlider label="Fill Opacity" value={draft.fill} onChange={(fill) => set({ fill })} />
            </Row>
            <Row label="Channels:">
              <span className="flex gap-3">
                {(["r", "g", "b"] as const).map((c) => (
                  <label key={c} className="flex items-center gap-1">
                    <input type="checkbox" checked={draft.channels[c]} onChange={(e) => set({ channels: { ...draft.channels, [c]: e.target.checked } })} className="accent-[var(--brand)]" />
                    {c.toUpperCase()}
                  </label>
                ))}
              </span>
            </Row>
          </Group>
          <Group title="Blend If">
            <Row label="Blend If:">
              <select value={entry} onChange={(e) => setEntry(e.target.value as BlendIfEntry)} className="h-7 rounded border border-line bg-surface-0 px-1.5" aria-label="Blend If channel">
                {BLEND_IF_CHANNELS.map((e) => (
                  <option key={e} value={e}>
                    {ENTRY_LABELS[e]}
                  </option>
                ))}
              </select>
            </Row>
            <BlendIfSlider label="Current Layer" range={range("layer")} colour={ENTRY_COLOURS[entry]} onChange={(r) => setRange("layer", r)} />
            <BlendIfSlider label="Underlying Layer" range={range("underlying")} colour={ENTRY_COLOURS[entry]} onChange={(r) => setRange("underlying", r)} />
            <p className="text-xs text-muted-foreground">⌥-drag a handle to split it: the layer fades in between.</p>
          </Group>
        </div>
        <div className="flex w-28 shrink-0 flex-col gap-2">
          <Button onClick={ok} data-ok>
            OK
          </Button>
          <Button variant="outline" onClick={alt ? reset : cancel} data-cancel>
            {alt ? "Reset" : "Cancel"}
          </Button>
          <label className="mt-1 flex items-center gap-1.5">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--brand)]" />
            Preview
          </label>
        </div>
      </div>
    </FloatingWindow>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-line px-3 pt-1 pb-2.5">
      <legend className="px-1 text-xs text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-right text-xs">{label}</span>
      {children}
    </div>
  );
}

/** A 0..1 value as Photoshop's percentage: a slider and its scrubby number. */
function PercentSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className={cn("flex flex-1 items-center gap-2")}>
      <Slider aria-label={`${label} slider`} min={0} max={100} step={1} value={[Math.round(value * 100)]} onValueChange={([v]) => onChange(v / 100)} className="flex-1" />
      <span className="w-14 rounded border border-line bg-surface-0 px-1">
        <ScrubNumber label={label} value={Math.round(value * 100)} display={{ min: 0, max: 100, step: 1, decimals: 0, unit: "%" }} onBegin={() => {}} onChange={(v) => onChange(v / 100)} onEnd={() => {}} />
      </span>
    </span>
  );
}
