/**
 * Properties (ux.md, "Workspace"): the selected image layer's place in numbers (position, size as a percentage,
 * angle) and fitting it to the canvas, then its Develop (Camera Raw in place: `develop-section.tsx`) and Effects
 * (its layer style in place: `effects-section.tsx`); an adjustment layer's parameters, rendered from its
 * definition's specs (sliders, Curves' graph); either's blending (mode, Opacity, Fill); a filter clicked in Layers (the glow), or a generator layer (the Lens
 * Flare: its parameters and elements: `light.tsx`). With nothing selected, the canvas's size, background and
 * highlights. A typed
 * value is one undo step; a slider or graph drag is one too.
 */
import { useState } from "react";
import { PiArrowClockwise, PiArrowCounterClockwise, PiArrowSquareOut, PiFlipHorizontal, PiFlipVertical, PiArrowsIn, PiArrowsOut, PiLink, PiLinkBreak, PiPaintBrush, PiStack, PiTrash, PiWarningCircle } from "react-icons/pi";
import { blendingOf, compositingOf } from "@shared/photo/blending";
import { resetEffect, setCanvas, setCompositing, setEffectParams, setHighlights, setLayerBlending, setTransform, updateLayer } from "@shared/photo/edits";
import { effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import { ORIENTATION_LABELS, type Orientation, orientLayers } from "@shared/photo/orient";
import { type AdjustmentLayer, CANVAS_PRESETS, type Compositing, type PhotoLayer, type PlacedLayer, hasContent, isPlaced } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fitted } from "../canvas/handles";
import { photoGesture, useLayerSize, usePhoto, usePhotoDoc, useSelection } from "../store";
import { layerActions } from "../layer-actions";
import { usePhotoUi } from "../ui";
import { BlendModeMenu, useBlendModePreview } from "./blend-mode-menu";
import { CurvesEditor } from "./curves-editor";
import { DevelopSection } from "./develop-section";
import { EffectsSection } from "./effects-section";
import { FilterProperties, GeneratorProperties } from "./light";
import { CameraRawProperties } from "../camera-raw/properties";
import { HueSaturationProperties } from "../hue-saturation/properties";
import { NumberField, ParamSlider } from "./fields";
import { TextProperties } from "../toolbox/type/text-properties";
import { ShapeSection } from "../toolbox/shapes/properties";

export function PropertiesPanel() {
  const selected = usePhotoUi((s) => s.selectedLayerId);
  const filterId = usePhotoUi((s) => s.selectedFilterId);
  const count = usePhotoUi((s) => s.selectedLayerIds.length);
  const layer = usePhotoDoc((d) => d.layers.find((l) => l.id === selected));
  const filter = layer && hasContent(layer) && filterId ? layer.filters?.find((f) => f.id === filterId) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-sm">
      {count > 1 ? (
        <SeveralProperties count={count} />
      ) : layer && filter && hasContent(layer) ? (
        filter.type === "camera-raw" && !unavailableReason(filter, "filter") ? (
          <Section title={`Camera Raw · ${layer.name}`}>
            <CameraRawProperties layerId={layer.id} filterId={filter.id} />
          </Section>
        ) : filter.type === "hue-saturation" && !unavailableReason(filter, "filter") ? (
          <Section title={`Hue/Saturation · ${layer.name}`}>
            <HueSaturationProperties layerId={layer.id} filterId={filter.id} />
          </Section>
        ) : (
          <FilterProperties layer={layer} filterId={filter.id} />
        )
      ) : layer?.kind === "shape" ? (
        <>
          <Section title={layer.name}>
            <ShapeSection layer={layer} />
          </Section>
          <BlendingSection layer={layer} />
          <EffectsSection layer={layer} />
        </>
      ) : layer && isPlaced(layer) ? (
        <LayerProperties layer={layer} />
      ) : layer?.kind === "generator" ? (
        <>
          <GeneratorProperties layer={layer} />
          <Section title="Opacity">
            <OpacitySlider layer={layer} />
          </Section>
        </>
      ) : layer?.kind === "adjustment" ? (
        <AdjustmentProperties layer={layer} />
      ) : (
        <CanvasProperties />
      )}
      {count === 1 && !filter && layer?.mask && <MaskProperties layer={layer} />}
    </div>
  );
}

/** Several layers selected: what can be done with them together (Photoshop's Properties says as little). */
function SeveralProperties({ count }: { count: number }) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <Section title={`${count} layers`}>
      <p className="text-xs text-muted-foreground" data-several-layers={count}>
        Drag on the canvas to move them together, or their box's handles to scale and turn them. {mod}E merges them into one, {mod}J duplicates them, Delete removes them.
      </p>
      <Button size="sm" variant="outline" className="self-start" onClick={() => void layerActions.merge()}>
        <PiStack /> Merge layers
      </Button>
    </Section>
  );
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** An adjustment layer's parameters, from its definition, then its opacity. */
function AdjustmentProperties({ layer }: { layer: AdjustmentLayer }) {
  const commit = usePhoto((s) => s.commit);
  const def = effectDefinition(layer.effect.type);
  const reason = unavailableReason(layer.effect);
  if (def?.type === "camera-raw" && !reason)
    return (
      <>
        <Section title={layer.name}>
          <CameraRawProperties layerId={layer.id} filterId={null} />
        </Section>
        <BlendingSection layer={layer} />
      </>
    );
  if (def?.type === "hue-saturation" && !reason)
    return (
      <>
        <Section title={layer.name}>
          <HueSaturationProperties layerId={layer.id} filterId={null} />
        </Section>
        <BlendingSection layer={layer} />
      </>
    );
  return (
    <>
      <Section title={layer.name}>
        {!def || reason ? (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <PiWarningCircle className="mt-0.5 shrink-0 text-destructive" />
            {reason} It's kept as it is, and changes nothing here.
          </p>
        ) : (
          <div className="flex flex-col gap-3" data-adjustment={def.type}>
            {def.params.map((spec) =>
              spec.kind === "number" ? (
                <ParamSlider key={spec.key} spec={spec} value={layer.effect.params[spec.key] as number} edit={(v) => (d) => setEffectParams(d, layer.id, { [spec.key]: v })} />
              ) : (
                <CurvesEditor key={spec.key} layer={layer} />
              ),
            )}
            <Button size="sm" variant="outline" className="self-start" onClick={() => commit((d) => resetEffect(d, layer.id))}>
              <PiArrowCounterClockwise /> Reset
            </Button>
          </div>
        )}
      </Section>
      <BlendingSection layer={layer} />
    </>
  );
}

/**
 * A layer's mask: what it hides, whether the brush paints it (its thumbnail in Layers targets it too), and making
 * it again from the selection or deleting it.
 */
function MaskProperties({ layer }: { layer: PhotoLayer }) {
  const targeted = usePhotoUi((s) => s.target === "mask");
  const selection = useSelection();
  return (
    <Section title="Mask">
      <p className="text-xs text-muted-foreground" data-mask-state={layer.mask?.surface ? "painted" : "clear"}>
        {layer.mask?.surface ? "Painted: black hides the layer, white reveals it." : "Reveals everything: paint black on it to hide parts of the layer."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={targeted ? "secondary" : "outline"} aria-pressed={targeted} onClick={() => usePhotoUi.getState().setTarget(targeted ? "content" : "mask")}>
          <PiPaintBrush /> {targeted ? "Painting the mask" : "Paint the mask"}
        </Button>
        {selection && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void layerActions.addMask(layer.id, { replace: true })}
          >
            From selection
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => layerActions.deleteMask(layer.id)}>
          <PiTrash /> Delete mask
        </Button>
      </div>
    </Section>
  );
}

/** Edit › Transform's turns and flips, beside the angle. */
const ORIENT_BUTTONS: [Orientation, typeof PiFlipHorizontal][] = [
  ["rotate-90-ccw", PiArrowCounterClockwise],
  ["rotate-90-cw", PiArrowClockwise],
  ["flip-horizontal", PiFlipHorizontal],
  ["flip-vertical", PiFlipVertical],
];

function LayerProperties({ layer }: { layer: PlacedLayer }) {
  const imageSize = useLayerSize(layer.kind === "image" ? layer.mediaId : undefined);
  const size = layer.kind === "pixel" || layer.kind === "text" ? layer.size : imageSize;
  const canvas = usePhotoDoc((d) => d.canvas);
  const commit = usePhoto((s) => s.commit);
  const [linked, setLinked] = useState(true);
  const t = layer.transform;
  const set = (patch: Parameters<typeof setTransform>[2]) => commit((d) => setTransform(d, layer.id, patch));
  const setScale = (axis: "scaleX" | "scaleY", percent: number) => {
    const s = (percent / 100) * Math.sign(t[axis] || 1);
    if (!linked) return set({ [axis]: s });
    const factor = s / t[axis];
    set({ scaleX: t.scaleX * factor, scaleY: t.scaleY * factor });
  };
  return (
    <>
      <Section title={layer.name}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={round(t.x)} onCommit={(x) => set({ x })} suffix="px" />
          <NumberField label="Y" value={round(t.y)} onCommit={(y) => set({ y })} suffix="px" />
          <NumberField label="W" value={round(Math.abs(t.scaleX) * 100)} onCommit={(v) => setScale("scaleX", v)} suffix="%" />
          <div className="flex items-end gap-1">
            <NumberField label="H" value={round(Math.abs(t.scaleY) * 100)} onCommit={(v) => setScale("scaleY", v)} suffix="%" />
            <Button variant="ghost" size="icon-sm" aria-label={linked ? "Unlink width and height" : "Link width and height"} aria-pressed={linked} onClick={() => setLinked(!linked)}>
              {linked ? <PiLink /> : <PiLinkBreak />}
            </Button>
          </div>
          <NumberField label="Angle" value={round(t.rotation)} onCommit={(rotation) => set({ rotation })} suffix="°" />
          <div className="flex items-end gap-0.5">
            {ORIENT_BUTTONS.map(([o, Icon]) => (
              <Button key={o} variant="ghost" size="icon-sm" title={ORIENTATION_LABELS[o]} aria-label={ORIENTATION_LABELS[o]} onClick={() => commit((d) => orientLayers(d, [layer.id], o, () => size ?? null))} data-orient-button={o}>
                <Icon />
              </Button>
            ))}
          </div>
        </div>
        {size && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => set(fitted(t, size, canvas, "contain"))}>
              <PiArrowsIn /> Fit canvas
            </Button>
            <Button size="sm" variant="outline" onClick={() => set(fitted(t, size, canvas, "cover"))}>
              <PiArrowsOut /> Fill canvas
            </Button>
          </div>
        )}
        {size && (
          <p className="text-xs text-muted-foreground">
            {layer.kind === "pixel" ? "Pixels" : layer.kind === "text" ? "Frame" : "Source"} {size.width} × {size.height} px · shown {Math.round(size.width * Math.abs(t.scaleX))} × {Math.round(size.height * Math.abs(t.scaleY))} px
          </p>
        )}
      </Section>
      {layer.kind === "text" && <TextProperties layer={layer} />}
      <BlendingSection layer={layer} />
      {layer.kind !== "text" && <DevelopSection layer={layer} />}
      <EffectsSection layer={layer} />
    </>
  );
}

/**
 * A layer's blend mode (previewed while hovered, as in Layers), Opacity and Fill; Blend If and the rest are in
 * the Layer Style window, a click away.
 */
function BlendingSection({ layer }: { layer: PhotoLayer }) {
  const [gesture] = useState(() => photoGesture());
  const preview = useBlendModePreview(() => [layer.id], (ids, blend) => (d) => setLayerBlending(d, ids, { blend }));
  const b = blendingOf(layer);
  const percent = (label: string, value: number, key: "opacity" | "fill") => (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Slider
        aria-label={label}
        min={0}
        max={100}
        step={1}
        value={[Math.round(value * 100)]}
        onPointerDown={() => gesture.begin()}
        onValueChange={([v]) => gesture.apply((d) => setLayerBlending(d, [layer.id], { [key]: v / 100 }))}
        onValueCommit={() => gesture.end()}
      />
      <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
  return (
    <Section
      title="Blending"
      actions={
        <Button variant="ghost" size="icon-xs" aria-label="Blending Options" title="Blending Options…" onClick={() => usePhotoUi.getState().setLayerStyle({ layerId: layer.id, page: "blending" })}>
          <PiArrowSquareOut />
        </Button>
      }
    >
      <div className="flex flex-col gap-2" data-blending-properties>
        <BlendModeMenu className="w-full" value={b.mode} onOpenChange={(open, chosen) => preview.onOpenChange(open, chosen, b.mode)} onPreview={preview.onPreview} onChoose={preview.onChoose} />
        {percent("Opacity", layer.opacity, "opacity")}
        {percent("Fill", b.fill, "fill")}
      </div>
    </Section>
  );
}

function OpacitySlider({ layer }: { layer: PhotoLayer }) {
  const [gesture] = useState(() => photoGesture());
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label="Opacity"
        min={0}
        max={100}
        step={1}
        value={[Math.round(layer.opacity * 100)]}
        onPointerDown={() => gesture.begin()}
        onValueChange={([v]) => gesture.apply((d) => updateLayer(d, layer.id, { opacity: v / 100 }))}
        onValueCommit={() => gesture.end()}
      />
      <span className="w-10 text-right tabular-nums">{Math.round(layer.opacity * 100)}%</span>
    </div>
  );
}

function CanvasProperties() {
  const canvas = usePhotoDoc((d) => d.canvas);
  const compositing = usePhotoDoc((d) => compositingOf(d));
  const highlights = usePhotoDoc((d) => d.output.highlights);
  const commit = usePhoto((s) => s.commit);
  return (
    <Section title="Canvas">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Width" value={canvas.width} onCommit={(width) => commit((d) => setCanvas(d, { width: Math.round(width) }))} suffix="px" />
        <NumberField label="Height" value={canvas.height} onCommit={(height) => commit((d) => setCanvas(d, { height: Math.round(height) }))} suffix="px" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {CANVAS_PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant={canvas.width === p.width && canvas.height === p.height ? "secondary" : "outline"} onClick={() => commit((d) => setCanvas(d, { width: p.width, height: p.height }, "centre"))}>
            {p.label}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>Background</span>
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Background colour"
            value={canvas.background ?? "#ffffff"}
            disabled={canvas.background === null}
            onChange={(e) => commit((d) => setCanvas(d, { background: e.target.value }))}
            className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent disabled:opacity-40"
          />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={canvas.background === null} onChange={(e) => commit((d) => setCanvas(d, { background: e.target.checked ? null : "#ffffff" }))} />
            Transparent
          </label>
        </span>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Layers mix</span>
        <select
          aria-label="How layers mix"
          value={compositing}
          onChange={(e) => commit((d) => setCompositing(d, e.target.value as Compositing))}
          className="h-7 rounded border border-line bg-surface-0 px-1.5"
        >
          <option value="photoshop">As Photoshop</option>
          <option value="linear">In linear light</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground" data-compositing={compositing}>
        {compositing === "photoshop"
          ? "Blend modes, opacity and soft edges mix encoded values, as Photoshop's do."
          : "Layers mix linear light: physically, as light adds up (Photoshop's Blend RGB Colors Using Gamma 1.0)."}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>Highlights</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">How light brighter than white leaves the photo: Film rolls it towards white, so glows and flares bloom; Clip clips each colour on its own.</TooltipContent>
        </Tooltip>
        <ToggleGroup type="single" size="sm" variant="outline" value={highlights} onValueChange={(v) => v && commit((d) => setHighlights(d, v as typeof highlights))} aria-label="Highlights">
          <ToggleGroupItem value="film" className="px-2.5 text-xs">
            Film
          </ToggleGroupItem>
          <ToggleGroupItem value="clip" className="px-2.5 text-xs">
            Clip
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </Section>
  );
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex h-6 items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}
