/**
 * Properties (ux.md, "Workspace"): the selected image layer's place in numbers (position, size as a percentage,
 * angle) and fitting it to the canvas; an adjustment layer's parameters, rendered from its definition's specs
 * (sliders, Curves' graph); either's opacity. With nothing selected, the canvas's size, background and highlights. A typed
 * value is one undo step; a slider or graph drag is one too.
 */
import { useState } from "react";
import { PiArrowCounterClockwise, PiArrowsIn, PiArrowsOut, PiLink, PiLinkBreak, PiPaintBrush, PiStack, PiTrash, PiWarningCircle } from "react-icons/pi";
import { resetEffect, setCanvas, setEffectParams, setHighlights, setTransform, updateLayer } from "@shared/photo/edits";
import { effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import { type AdjustmentLayer, CANVAS_PRESETS, type PhotoLayer, type PlacedLayer, isPlaced } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fitted } from "../canvas/handles";
import { photoGesture, useLayerSize, usePhoto, usePhotoDoc, useSelection } from "../store";
import { layerActions } from "../layer-actions";
import { usePhotoUi } from "../ui";
import { CurvesEditor } from "./curves-editor";
import { NumberField, ParamSlider } from "./fields";

export function PropertiesPanel() {
  const selected = usePhotoUi((s) => s.selectedLayerId);
  const count = usePhotoUi((s) => s.selectedLayerIds.length);
  const layer = usePhotoDoc((d) => d.layers.find((l) => l.id === selected));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-sm">
      {count > 1 ? (
        <SeveralProperties count={count} />
      ) : layer && isPlaced(layer) ? (
        <LayerProperties layer={layer} />
      ) : layer?.kind === "adjustment" ? (
        <AdjustmentProperties layer={layer} />
      ) : (
        <CanvasProperties />
      )}
      {count === 1 && layer?.mask && <MaskProperties layer={layer} />}
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
      <Section title="Opacity">
        <OpacitySlider layer={layer} />
      </Section>
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

function LayerProperties({ layer }: { layer: PlacedLayer }) {
  const imageSize = useLayerSize(layer.kind === "image" ? layer.mediaId : undefined);
  const size = layer.kind === "pixel" ? layer.size : imageSize;
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
            {layer.kind === "pixel" ? "Pixels" : "Source"} {size.width} × {size.height} px · shown {Math.round(size.width * Math.abs(t.scaleX))} × {Math.round(size.height * Math.abs(t.scaleY))} px
          </p>
        )}
      </Section>
      <Section title="Opacity">
        <OpacitySlider layer={layer} />
      </Section>
    </>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
