/**
 * Properties for light (docs/photo/f4-light.md, "UI"; research/light-effects.md): a filter of a layer (the glow) and a
 * generator layer (the Lens Flare: its parameters, its preset, how it blends, and its elements, Optical Flares' way:
 * a list with an eye each, added from a menu, dragged to reorder, the selected one's parameters below). Everything
 * is rendered from the definitions' specs, and every change is one undo step.
 */
import { useRef } from "react";
import { cn } from "cn";
import { PiArrowCounterClockwise, PiCaretDown, PiCircle, PiEye, PiEyeSlash, PiHexagon, PiLineSegment, PiPlus, PiSun, PiTrash, PiWarningCircle } from "react-icons/pi";
import { createId } from "@shared/ids";
import { addElement, moveElement, removeElement, setEffectParams, setElement, setFilter, setGeneratorBlend } from "@shared/photo/edits";
import { FLARE_PRESETS, flarePreset } from "@shared/photo/effects/flare";
import { effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import { type ElementsParam, defaultParams } from "@shared/photo/effects/params";
import type { ContentLayer, EffectElement, GeneratorLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startPointerDrag } from "@/lib/pointer-drag";
import { layerActions } from "../layer-actions";
import { usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { ParamField } from "./params";

/** Each element type's icon. */
const ELEMENT_ICONS: Record<string, typeof PiSun> = { glow: PiSun, halo: PiCircle, ghost: PiHexagon, streak: PiLineSegment };

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A filter of a layer: on or bypassed, its parameters, reset, delete. */
export function FilterProperties({ layer, filterId }: { layer: ContentLayer; filterId: string }) {
  const commit = usePhoto((s) => s.commit);
  const filter = (layer.filters ?? []).find((f) => f.id === filterId);
  if (!filter) return null;
  const def = effectDefinition(filter.type);
  const reason = unavailableReason(filter, "filter");
  return (
    <Section
      title={`${def?.label ?? filter.type} · ${layer.name}`}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label={filter.enabled ? "Bypass the filter" : "Turn the filter on"} aria-pressed={!filter.enabled} onClick={() => commit((d) => setFilter(d, layer.id, filter.id, { enabled: !filter.enabled }))}>
          {filter.enabled ? <PiEye /> : <PiEyeSlash />}
        </Button>
      }
    >
      {!def || reason ? (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <PiWarningCircle className="mt-0.5 shrink-0 text-destructive" />
          {reason} It's kept as it is, and changes nothing here.
        </p>
      ) : (
        <div className={cn("flex flex-col gap-3", !filter.enabled && "opacity-60")} data-filter-properties={filter.type}>
          {def.params.map((spec) => (
            <ParamField key={spec.key} spec={spec} value={filter.params[spec.key]} edit={(v) => (d) => setFilter(d, layer.id, filter.id, { params: { [spec.key]: v } })} />
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        {def && !reason && (
          <Button size="sm" variant="outline" onClick={() => commit((d) => setFilter(d, layer.id, filter.id, { params: defaultParams(def.params) }))}>
            <PiArrowCounterClockwise /> Reset
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => layerActions.delete()}>
          <PiTrash /> Delete filter
        </Button>
      </div>
    </Section>
  );
}

/** A generator layer: its parameters (but its elements), its preset, how it blends, then its elements. */
export function GeneratorProperties({ layer }: { layer: GeneratorLayer }) {
  const commit = usePhoto((s) => s.commit);
  const canvas = usePhoto((s) => s.history?.doc.doc.canvas) ?? { width: 1080, height: 1920 };
  const def = effectDefinition(layer.effect.type);
  const reason = unavailableReason(layer.effect, "generator");
  if (!def || reason) {
    return (
      <Section title={layer.name}>
        <p className="flex gap-2 text-xs text-muted-foreground">
          <PiWarningCircle className="mt-0.5 shrink-0 text-destructive" />
          {reason} It's kept as it is, and draws nothing here.
        </p>
      </Section>
    );
  }
  const elements = def.params.find((p): p is ElementsParam => p.kind === "elements");
  // Add or Normal here; any other mode is the Layers panel's (then neither is pressed).
  const blend = layer.blend === "linear-dodge" ? "add" : (layer.blend ?? "normal") === "normal" ? "normal" : "";
  return (
    <>
      <Section
        title={layer.name}
        actions={
          def.type === "lens-flare" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
                  Preset <PiCaretDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Replace the elements with</DropdownMenuLabel>
                {FLARE_PRESETS.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => commit((d) => setEffectParams(d, layer.id, { elements: flarePreset(p.id, canvas.width, canvas.height) }))}>
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3" data-generator-properties={def.type}>
          {def.params
            .filter((p) => p.kind !== "elements")
            .map((spec) => (
              <ParamField key={spec.key} spec={spec} value={layer.effect.params[spec.key]} edit={(v) => (d) => setEffectParams(d, layer.id, { [spec.key]: v })} />
            ))}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs">Blend</span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={blend}
              onValueChange={(v) => v && commit((d) => setGeneratorBlend(d, layer.id, v === "add" ? "linear-dodge" : "normal", v === "add" ? "linear" : "document"))}
              aria-label="Blend"
            >
              <ToggleGroupItem value="add" className="px-2.5 text-xs" title="Linear Dodge (Add) in linear light: its light adds to what's below, as light does">
                Add
              </ToggleGroupItem>
              <ToggleGroupItem value="normal" className="px-2.5 text-xs">
                Normal
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </Section>
      {elements && <ElementsList layer={layer} spec={elements} />}
    </>
  );
}

/** A generator's elements: an eye each, the selected one's parameters below; drag to reorder, the menu adds. */
function ElementsList({ layer, spec }: { layer: GeneratorLayer; spec: ElementsParam }) {
  const commit = usePhoto((s) => s.commit);
  const selectedId = usePhotoUi((s) => s.selectedElementId);
  const list = (layer.effect.params[spec.key] as EffectElement[]) ?? [];
  const rows = useRef<HTMLUListElement>(null);
  const selected = list.find((e) => e.id === selectedId);
  const type = selected ? spec.types.find((t) => t.type === selected.type) : undefined;
  // Numbered by type, as Photoshop numbers several of a kind ("Ghost 3").
  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const e of list) {
    const n = (counts.get(e.type) ?? 0) + 1;
    counts.set(e.type, n);
    const label = spec.types.find((t) => t.type === e.type)?.label ?? e.type;
    names.set(e.id, list.filter((x) => x.type === e.type).length > 1 ? `${label} ${n}` : label);
  }
  const press = (e: React.PointerEvent, element: EffectElement) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    usePhotoUi.getState().selectElement(element.id);
    let to: number | null = null;
    startPointerDrag(e, {
      threshold: 4,
      cursor: "grabbing",
      onMove: (ev) => {
        const boxes = [...(rows.current?.querySelectorAll<HTMLElement>("[data-element]") ?? [])].map((r) => r.getBoundingClientRect());
        // The gap it's over, from the top; the list shows the last drawn first, so places count from the end.
        let gap = boxes.findIndex((b) => ev.clientY < b.top + b.height / 2);
        if (gap < 0) gap = boxes.length;
        const shown = list.length - 1 - list.indexOf(element);
        to = list.length - 1 - (gap > shown ? gap - 1 : gap);
      },
      onEnd: () => {
        if (to !== null) commit((d) => moveElement(d, layer.id, spec.key, element.id, to!));
      },
    });
  };
  return (
    <Section
      title={spec.label}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Add an element" disabled={list.length >= spec.max}>
              <PiPlus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {spec.types.map((t) => {
              const Icon = ELEMENT_ICONS[t.type] ?? PiSun;
              return (
                <DropdownMenuItem
                  key={t.type}
                  onSelect={() => {
                    const id = createId("el");
                    commit((d) => addElement(d, layer.id, spec.key, t.type, id));
                    usePhotoUi.getState().selectElement(id);
                  }}
                >
                  <Icon /> {t.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <ul ref={rows} className="flex flex-col overflow-hidden rounded border border-line" aria-label={spec.label} data-elements={list.length}>
        {[...list].reverse().map((element) => {
          const Icon = ELEMENT_ICONS[element.type] ?? PiSun;
          return (
            <li
              key={element.id}
              className={cn("flex h-7 cursor-default items-center gap-1.5 px-1 text-xs", element.id === selectedId ? "bg-accent" : "hover:bg-surface-2", !element.enabled && "text-muted-foreground")}
              onPointerDown={(e) => press(e, element)}
              data-element={element.id}
              aria-selected={element.id === selectedId}
            >
              <button
                type="button"
                className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
                aria-label={element.enabled ? "Hide the element" : "Show the element"}
                aria-pressed={element.enabled}
                onClick={() => commit((d) => setElement(d, layer.id, spec.key, element.id, { enabled: !element.enabled }))}
              >
                {element.enabled ? <PiEye /> : <PiEyeSlash />}
              </button>
              <Icon className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{names.get(element.id)}</span>
              <button
                type="button"
                className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground [li:hover_&]:opacity-100"
                aria-label="Delete the element"
                onClick={() => {
                  commit((d) => removeElement(d, layer.id, spec.key, element.id));
                  if (element.id === selectedId) usePhotoUi.getState().selectElement(null);
                }}
              >
                <PiTrash />
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No elements: add one.</li>}
      </ul>
      {selected && type && (
        <div className="flex flex-col gap-3 rounded border border-line p-2" data-element-properties={selected.type}>
          <span className="text-xs font-medium">{names.get(selected.id)}</span>
          {type.params.map((p) => (
            <ParamField key={p.key} spec={p} value={selected[p.key]} edit={(v) => (d) => setElement(d, layer.id, spec.key, selected.id, { [p.key]: v })} />
          ))}
        </div>
      )}
    </Section>
  );
}
