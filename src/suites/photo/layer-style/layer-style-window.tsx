/**
 * The Layer Style window (docs/photo/layer-style/README.md, phases L1 to L3), opened by Blending Options… or an
 * effect: Photoshop's dialog. Its list on the left (Blending Options, then the effects top of the drawing first,
 * each with its checkbox, + for the five that can be added again, Bevel's Contour under it, ↑ ↓ and the bin under
 * it), the page in the middle, OK / Cancel / Preview on the right.
 *
 * The whole window is one gesture: every change shows on the canvas at once and none is an undo step; OK makes them
 * one ("Layer Style"), Cancel (or Escape) puts the layer back as it was, Global Light included; ⌥ turns Cancel into
 * Reset. Preview off shows the layer as it was meanwhile. While a shadow's, Satin's or the gradient overlay's page
 * shows, a drag on the canvas moves it (Photoshop's). An edit made elsewhere ends the gesture (keeping what was shown), and
 * the window closes with it.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { PiArrowDown, PiArrowUp, PiPlus, PiTrash } from "react-icons/pi";
import { createId } from "@shared/ids";
import { BLEND_IF_CHANNELS, type BlendIfEntry, FULL_RANGE, blendingOf } from "@shared/photo/blending";
import { findLayer, setLayerBlending } from "@shared/photo/edits";
import type { ParamSpec } from "@shared/photo/effects/params";
import { shadowOffset } from "@shared/photo/reference/style";
import { STYLE_LIST, styleDefinition } from "@shared/photo/style/definitions";
import { addStyleEffect, globalLightOf, moveStyleEffect, removeStyleEffect, replaceStyle, setGlobalLight, setStyleEffect } from "@shared/photo/style/style";
import type { BlendIf, BlendMode, BlendRange, Contour, EffectInstance, EffectParamValue, GlobalLight, Gradient, LayerStyle, PhotoLayer, PhotoProject } from "@shared/photo/types";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { FloatingWindow, centredOnDesktop } from "@/components/windows/floating-window";
import { BlendModeMenu } from "../panels/blend-mode-menu";
import { photoGesture, usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { BlendIfSlider } from "./blend-if-slider";
import { useStyleCanvasDrag } from "./canvas-drag";
import { AngleDial } from "./controls/angle-dial";
import { ContourPicker } from "./controls/contour-picker";
import { GradientPicker } from "./controls/gradient-picker";
import { makeDefault, styleDefaults } from "./defaults";

/** What the window edits: the layer's Blending Options, its style and the document's Global Light, all given. */
interface Draft {
  blend: BlendMode;
  opacity: number;
  fill: number;
  channels: { r: boolean; g: boolean; b: boolean };
  blendIf: BlendIf;
  interiorAsGroup: boolean;
  maskHidesEffects: boolean;
  style: LayerStyle;
  globalLight: GlobalLight;
}

const draftOf = (layer: PhotoLayer, doc: PhotoProject): Draft => {
  const b = blendingOf(layer);
  return {
    blend: b.mode,
    opacity: layer.opacity,
    fill: b.fill,
    channels: b.channels,
    blendIf: b.blendIf,
    interiorAsGroup: layer.blending?.interiorAsGroup === true,
    maskHidesEffects: layer.blending?.maskHidesEffects === true,
    style: layer.style ? structuredClone(layer.style) : { enabled: true, effects: [] },
    globalLight: globalLightOf(doc),
  };
};

/** A mode shown instead of the draft's while it's hovered in a menu: the layer's (no id) or an effect's. */
type Hovered = { effectId: string | null; mode: BlendMode } | null;

/** The edit that makes the layer and the document what the draft says (with a hovered mode shown). */
const applyDraft = (layerId: string, d: Draft, hovered: Hovered = null) => (doc: PhotoProject) => {
  let next = setLayerBlending(doc, [layerId], {
    blend: hovered && hovered.effectId === null ? hovered.mode : d.blend,
    opacity: d.opacity,
    fill: d.fill,
    channels: d.channels,
    blendIf: Object.fromEntries(BLEND_IF_CHANNELS.map((e) => [e, d.blendIf[e] ?? null])),
    interiorAsGroup: d.interiorAsGroup,
    maskHidesEffects: d.maskHidesEffects,
  });
  const style = hovered?.effectId ? { ...d.style, effects: d.style.effects.map((e) => (e.id === hovered.effectId ? { ...e, params: { ...e.params, mode: hovered.mode } } : e)) } : d.style;
  next = replaceStyle(next, layerId, style.effects.length ? style : undefined);
  return setGlobalLight(next, d.globalLight);
};

/** A style edit from `style/style.ts` run on the draft's style (a layer of one, so ordering and limits are theirs). */
function editStyle(style: LayerStyle, edit: (doc: PhotoProject) => PhotoProject): LayerStyle {
  const doc = { layers: [{ id: "x", kind: "pixel", name: "x", visible: true, opacity: 1, surface: null, size: { width: 1, height: 1 }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, style }] } as unknown as PhotoProject;
  return edit(doc).layers[0].style ?? { enabled: style.enabled, effects: [] };
}

/** A new effect of `type` at this computer's defaults. */
const newEffect = (type: string): EffectInstance => ({ id: createId("fx"), type, version: styleDefinition(type)!.version, enabled: true, params: styleDefaults(type) });

const ENTRY_LABELS: Record<BlendIfEntry, string> = { gray: "Gray", red: "Red", green: "Green", blue: "Blue" };
const ENTRY_COLOURS: Record<BlendIfEntry, string> = { gray: "#fff", red: "#f00", green: "#0f0", blue: "#00f" };

export function LayerStyleWindow({ layerId, page: asked }: { layerId: string; page: string }) {
  const [initial] = useState(() => centredOnDesktop(780, 560, "photo"));
  const close = () => usePhotoUi.getState().setLayerStyle(null);
  const [session] = useState(() => {
    const doc = usePhoto.getState().history!.doc.doc;
    return { gesture: photoGesture(), base: findLayer(doc, layerId)!, baseDoc: doc };
  });
  // The page asked for when it opens: Blending Options, an effect, or an effect type (its topmost, added when the
  // layer has none: Photoshop ticks it). Worked out once, without side effects (React may call this twice).
  const [opening] = useState(() => {
    const d = draftOf(session.base, session.baseDoc);
    if (asked === "blending" || d.style.effects.some((e) => e.id === asked)) return { draft: d, page: asked };
    if (!styleDefinition(asked)) return { draft: d, page: "blending" };
    const have = [...d.style.effects].reverse().find((e) => e.type === asked);
    if (have) return { draft: d, page: have.id };
    const e = newEffect(asked);
    return { draft: { ...d, style: editStyle(d.style, (doc) => addStyleEffect(doc, "x", e)) }, page: e.id };
  });
  const [draft, setDraft] = useState<Draft>(opening.draft);
  const [page, setPage] = useState(opening.page);
  const asking = useRef(asked);
  const [preview, setPreview] = useState(true);
  const [hovered, setHovered] = useState<Hovered>(null);
  const [entry, setEntry] = useState<BlendIfEntry>("gray");
  const [alt, setAlt] = useState(false);
  const finished = useRef(false);

  /** A new effect of `type` (with `params` over its defaults), shown (on a sub-page of it). */
  const add = (type: string, params: Record<string, EffectParamValue> = {}, sub?: string) => {
    const e = newEffect(type);
    e.params = { ...e.params, ...params };
    setDraft((d) => ({ ...d, style: editStyle(d.style, (doc) => addStyleEffect(doc, "x", e)) }));
    setPage(sub ? `${e.id}:${sub}` : e.id);
  };

  // Another page asked for while it's open (an effect double-clicked in Layers, the fx menu).
  useEffect(() => {
    if (asked === asking.current) return;
    asking.current = asked;
    if (asked === "blending") return setPage("blending");
    const d = draft.style.effects;
    if (d.some((e) => e.id === asked)) return setPage(asked);
    if (!styleDefinition(asked)) return;
    const have = [...d].reverse().find((e) => e.type === asked);
    if (have) setPage(have.id);
    else add(asked);
    // Only when the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

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
    session.gesture.apply(preview ? applyDraft(layerId, draft, hovered) : applyDraft(layerId, draftOf(session.base, session.baseDoc)));
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

  // A sub-page is "<effect id>:<group>" (Bevel's Contour).
  const [pageId, subPage] = page.split(":") as [string, string | undefined];
  const selected = draft.style.effects.find((e) => e.id === pageId);

  // A drag on the canvas moves the shown shadow (Distance and Angle), or the gradient overlay's centre (its offset).
  useEffect(() => {
    if (!selected || !["drop-shadow", "inner-shadow", "satin", "gradient-overlay"].includes(selected.type)) return;
    const id = selected.id;
    let start: { x: number; y: number } | null = null;
    useStyleCanvasDrag.getState().set((dx, dy, done) => {
      setDraft((d) => {
        const e = d.style.effects.find((x) => x.id === id);
        if (!e) return d;
        if (e.type === "gradient-overlay") {
          const canvas = usePhoto.getState().history!.doc.doc.canvas;
          start ??= { x: e.params.offsetX as number, y: e.params.offsetY as number };
          const offsetX = Math.round(Math.max(-100, Math.min(100, start.x + (dx / canvas.width) * 100)));
          const offsetY = Math.round(Math.max(-100, Math.min(100, start.y + (dy / canvas.height) * 100)));
          return { ...d, style: editStyle(d.style, (doc) => setStyleEffect(doc, "x", id, { params: { offsetX, offsetY } })) };
        }
        const global = e.params.globalLight === true;
        const angle = global ? d.globalLight.angle : (e.params.angle as number);
        start ??= shadowOffset(angle, e.params.distance as number);
        const ox = start.x + dx;
        const oy = start.y + dy;
        const distance = Math.round(Math.hypot(ox, oy));
        const a = distance > 0 ? Math.round((Math.atan2(oy, -ox) * 180) / Math.PI) : angle;
        const style = editStyle(d.style, (doc) => setStyleEffect(doc, "x", id, { params: global ? { distance } : { distance, angle: a } }));
        return { ...d, style, globalLight: global ? { ...d.globalLight, angle: a } : d.globalLight };
      });
      if (done) start = null;
    });
    return () => useStyleCanvasDrag.getState().set(null);
  }, [selected?.id, selected?.type]);

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
  const reset = () => {
    setDraft(draftOf(session.base, session.baseDoc));
    setPage("blending");
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setRange = (side: "layer" | "underlying", range: BlendRange) =>
    setDraft((d) => {
      const now = d.blendIf[entry] ?? { layer: FULL_RANGE, underlying: FULL_RANGE };
      return { ...d, blendIf: { ...d.blendIf, [entry]: { ...now, [side]: range } } };
    });
  const range = (side: "layer" | "underlying") => draft.blendIf[entry]?.[side] ?? FULL_RANGE;
  const style = (edit: (doc: PhotoProject) => PhotoProject) => setDraft((d) => ({ ...d, style: editStyle(d.style, edit) }));
  const sameType = selected ? draft.style.effects.filter((e) => e.type === selected.type) : [];
  // Adjustment layers have Blending Options but no effects (Photoshop's).
  const effects = session.base.kind !== "adjustment";

  return (
    <FloatingWindow id="layer-style" title="Layer Style" initial={initial} keepsKeys escapeCloses onClose={cancel} className="w-[780px] max-w-full">
      <div
        className="flex min-h-0 gap-3 p-3 text-sm"
        data-layer-style
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(e.target as Element).closest("input, select, textarea, [role=slider], [role=menuitem], [contenteditable]")) ok();
        }}
      >
        <div className="flex w-48 shrink-0 flex-col rounded border border-line bg-surface-0">
          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1" aria-label="Layer Style pages">
            <ListRow label="Blending Options" page="blending" selected={page === "blending"} onSelect={() => setPage("blending")} />
            {effects &&
              STYLE_LIST.map((type) => {
                const def = styleDefinition(type)!;
                // Top of the drawing first, as Photoshop lists them.
                const instances = draft.style.effects.filter((e) => e.type === type).reverse();
                const rows = instances.length ? instances : [null];
                return (
                  <Fragment key={type}>
                    {rows.map((e, i) => (
                      <Fragment key={e?.id ?? type}>
                        <ListRow
                          label={def.label}
                          page={e?.id ?? type}
                          checked={e ? e.enabled : false}
                          onCheck={(checked) => (e ? style((doc) => setStyleEffect(doc, "x", e.id, { enabled: checked })) : add(type))}
                          selected={!!e && page === e.id}
                          onSelect={() => (e ? setPage(e.id) : add(type))}
                          onAdd={def.max > 1 && i === 0 && instances.length > 0 && instances.length < def.max ? () => add(type) : undefined}
                        />
                        {def.subPages?.map((sub) => (
                          <ListRow
                            key={sub.group}
                            label={sub.label}
                            page={`${e?.id ?? type}:${sub.group}`}
                            indent
                            checked={e?.params[sub.toggle] === true}
                            onCheck={(checked) => (e ? style((doc) => setStyleEffect(doc, "x", e.id, { params: { [sub.toggle]: checked } })) : add(type, { [sub.toggle]: checked }, sub.group))}
                            selected={!!e && page === `${e.id}:${sub.group}`}
                            onSelect={() => (e ? setPage(`${e.id}:${sub.group}`) : add(type, {}, sub.group))}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                );
              })}
          </nav>
          {effects && (
            <div className="flex items-center gap-0.5 border-t border-line p-1">
              <Button variant="ghost" size="icon-sm" aria-label="Move effect up" disabled={!selected || sameType.at(-1)?.id === selected.id} onClick={() => selected && style((doc) => moveStyleEffect(doc, "x", selected.id, 1))}>
                <PiArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move effect down" disabled={!selected || sameType[0]?.id === selected.id} onClick={() => selected && style((doc) => moveStyleEffect(doc, "x", selected.id, -1))}>
                <PiArrowDown />
              </Button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete effect"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  style((doc) => removeStyleEffect(doc, "x", selected.id));
                  setPage("blending");
                }}
              >
                <PiTrash />
              </Button>
            </div>
          )}
        </div>
        <div className="flex max-h-[30rem] min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" data-page={selected ? `${selected.type}${subPage ? `-${subPage.toLowerCase()}` : ""}` : "blending-options"}>
          {selected ? (
            <EffectPage
              key={page}
              effect={selected}
              subPage={subPage}
              globalLight={draft.globalLight}
              onParams={(params) => style((doc) => setStyleEffect(doc, "x", selected.id, { params }))}
              onGlobalLight={(patch) => set({ globalLight: { ...draft.globalLight, ...patch } })}
              onHoverMode={(mode) => setHovered(mode ? { effectId: selected.id, mode } : null)}
            />
          ) : (
            <>
              <Group title="General Blending">
                <Row label="Blend Mode:">
                  <BlendModeMenu
                    className="w-44"
                    value={draft.blend}
                    onPreview={(mode) => setHovered(mode ? { effectId: null, mode } : null)}
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
                {effects && (
                  <Row label="">
                    <span className="flex flex-col gap-1">
                      <Check label="Blend Interior Effects as Group" checked={draft.interiorAsGroup} onChange={(interiorAsGroup) => set({ interiorAsGroup })} />
                      <Check label="Layer Mask Hides Effects" checked={draft.maskHidesEffects} onChange={(maskHidesEffects) => set({ maskHidesEffects })} />
                    </span>
                  </Row>
                )}
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
            </>
          )}
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

/** A row of the list: Blending Options, or an effect with its checkbox (and + for another of its type), or a sub-page of one (indented). */
function ListRow({ label, page, selected, onSelect, checked, onCheck, onAdd, indent }: { label: string; page: string; selected: boolean; onSelect: () => void; checked?: boolean; onCheck?: (checked: boolean) => void; onAdd?: () => void; indent?: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1", indent && "pl-6", selected ? "bg-accent" : "hover:bg-surface-2")} data-style-row={page} aria-current={selected ? "page" : undefined}>
      {onCheck && <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`${label} on`} className="accent-[var(--brand)]" />}
      <button type="button" className={cn("min-w-0 flex-1 truncate text-left", selected && "font-medium")} onClick={onSelect}>
        {label}
      </button>
      {onAdd && (
        <button type="button" className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-surface-3 hover:text-foreground" aria-label={`Add another ${label}`} onClick={onAdd}>
          <PiPlus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * An effect's page, from its definition's specs in their groups (Structure, Elements, Quality…), with Make Default
 * and Reset to Default; or one of its sub-pages (a group of its own, whose toggle is the list's checkbox). An angle
 * or altitude with Use Global Light on shows and sets the document's.
 */
function EffectPage({
  effect,
  subPage,
  globalLight,
  onParams,
  onGlobalLight,
  onHoverMode,
}: {
  effect: EffectInstance;
  subPage?: string;
  globalLight: GlobalLight;
  onParams: (params: Record<string, EffectParamValue>) => void;
  onGlobalLight: (patch: Partial<GlobalLight>) => void;
  onHoverMode: (mode: BlendMode | null) => void;
}) {
  const def = styleDefinition(effect.type)!;
  const p = effect.params;
  const sub = def.subPages?.find((s) => s.group === subPage);
  const groups: { name: string; specs: ParamSpec[] }[] = [];
  for (const spec of def.params) {
    if (spec.showIf && p[spec.showIf.key] !== spec.showIf.is) continue;
    // A sub-page's group shows on it alone, its toggle in the list.
    if (sub ? spec.group !== sub.group || spec.key === sub.toggle : def.subPages?.some((s) => s.group === spec.group)) continue;
    const name = spec.group ?? "";
    const g = groups.find((x) => x.name === name);
    if (g) g.specs.push(spec);
    else groups.push({ name, specs: [spec] });
  }
  const control = (spec: ParamSpec) => {
    const value = p[spec.key];
    switch (spec.kind) {
      case "number": {
        const global = p.globalLight === true;
        if (spec.key === "angle") return <AngleDial value={global ? globalLight.angle : (value as number)} onChange={(a) => (global ? onGlobalLight({ angle: a }) : onParams({ angle: a }))} />;
        // Bevel's altitude is the Global Light's too.
        const shown = spec.key === "altitude" && global ? globalLight.altitude : (value as number);
        const change = (v: number) => (spec.key === "altitude" && global ? onGlobalLight({ altitude: v }) : onParams({ [spec.key]: v }));
        return (
          <span className="flex flex-1 items-center gap-2">
            <Slider aria-label={`${spec.label} slider`} min={spec.min} max={spec.key === "distance" ? Math.max(200, shown) : spec.max} step={spec.step} value={[shown]} onValueChange={([v]) => change(v)} className="flex-1" />
            <span className="w-16 rounded border border-line bg-surface-0 px-1">
              <ScrubNumber label={spec.label} value={shown} display={{ min: spec.min, max: spec.max, step: spec.step, decimals: spec.decimals, unit: spec.unit }} onBegin={() => {}} onChange={change} onEnd={() => {}} />
            </span>
          </span>
        );
      }
      case "choice":
        return spec.radio ? (
          <span className="flex gap-3" role="radiogroup" aria-label={spec.label}>
            {spec.options.map((o) => (
              <label key={o.value} className="flex items-center gap-1">
                <input type="radio" name={`${effect.id}-${spec.key}`} checked={value === o.value} onChange={() => onParams({ [spec.key]: o.value })} className="accent-[var(--brand)]" />
                {o.label}
              </label>
            ))}
          </span>
        ) : (
          <select value={value as string} onChange={(e) => onParams({ [spec.key]: e.target.value })} className="h-7 rounded border border-line bg-surface-0 px-1.5" aria-label={spec.label}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "boolean":
        return <Check label={spec.label} checked={value === true} onChange={(v) => onParams({ [spec.key]: v })} />;
      case "colour":
        return <ColorSwatchPicker value={value as string} label={spec.label} edit={{ begin: () => {}, set: (c) => onParams({ [spec.key]: c }), end: () => {} }} className="h-6 w-10" />;
      case "blend":
        return (
          <BlendModeMenu
            className="w-44"
            value={value as BlendMode}
            onPreview={onHoverMode}
            onChoose={(mode) => {
              onHoverMode(null);
              onParams({ [spec.key]: mode });
            }}
          />
        );
      case "contour":
        return <ContourPicker value={value as Contour} onChange={(c) => onParams({ [spec.key]: c })} />;
      case "gradient":
        return <GradientPicker value={value as Gradient} onChange={(g) => onParams({ [spec.key]: g })} />;
      default:
        return null;
    }
  };
  return (
    <>
      <h3 className="text-sm font-medium">{sub ? sub.label : def.label}</h3>
      {groups.map((g) => (
        // (A sub-page's one group is Photoshop's "Elements".)
        <Group key={g.name} title={sub ? "Elements" : g.name}>
          {g.specs.map((spec) => (
            <Row key={spec.key} label={spec.kind === "boolean" ? "" : `${spec.label}:`}>
              {control(spec)}
            </Row>
          ))}
        </Group>
      ))}
      <div className="flex justify-center gap-2 pb-1">
        <Button size="sm" variant="outline" onClick={() => makeDefault(effect.type, p)}>
          Make Default
        </Button>
        <Button size="sm" variant="outline" onClick={() => onParams(styleDefaults(effect.type))}>
          Reset to Default
        </Button>
      </div>
    </>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--brand)]" />
      {label}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-line px-3 pt-1 pb-2.5">
      {title && <legend className="px-1 text-xs text-muted-foreground">{title}</legend>}
      {children}
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-28 shrink-0 text-right text-xs">{label}</span>
      {children}
    </div>
  );
}

/** A 0..1 value as Photoshop's percentage: a slider and its scrubby number. */
function PercentSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="flex flex-1 items-center gap-2">
      <Slider aria-label={`${label} slider`} min={0} max={100} step={1} value={[Math.round(value * 100)]} onValueChange={([v]) => onChange(v / 100)} className="flex-1" />
      <span className="w-14 rounded border border-line bg-surface-0 px-1">
        <ScrubNumber label={label} value={Math.round(value * 100)} display={{ min: 0, max: 100, step: 1, decimals: 0, unit: "%" }} onBegin={() => {}} onChange={(v) => onChange(v / 100)} onEnd={() => {}} />
      </span>
    </span>
  );
}
