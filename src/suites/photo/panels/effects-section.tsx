/**
 * Properties' Effects (Figma's way): the layer's style as a list, top of the drawing first, each effect with its
 * eye and bin, unfolding to its settings in place; + adds one (at this computer's defaults, unfolded). Everything
 * here is the Layer Style window's too (the same controls, `StyleParam`); the window adds Blend If, styles, Make
 * Default and the canvas drags. A change is one undo step, a drag one too (`liveEdit`).
 */
import { useState } from "react";
import { cn } from "cn";
import { PiArrowSquareOut, PiCaretDown, PiCaretRight, PiEye, PiEyeSlash, PiPlus, PiTrash } from "react-icons/pi";
import { createId } from "@shared/ids";
import { type ParamSpec, specShows } from "@shared/photo/effects/params";
import { STYLE_LIST, styleDefinition } from "@shared/photo/style/definitions";
import { addStyleEffect, globalLightOf, removePattern, removeStyleEffect, setGlobalLight, setStyleEffect, setStyleEnabled } from "@shared/photo/style/style";
import type { EffectInstance, PhotoLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { styleDefaults } from "../layer-style/defaults";
import { Check, StyleParam } from "../layer-style/controls/style-param";
import { usePhoto, usePhotoDoc } from "../store";
import { usePhotoUi } from "../ui";
import { FoldSection } from "./fold-section";
import { liveEdit } from "./live-edit";

export function EffectsSection({ layer }: { layer: PhotoLayer }) {
  const commit = usePhoto((s) => s.commit);
  const inWindow = usePhotoUi((s) => s.layerStyle?.layerId === layer.id);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const style = layer.style;
  const effects = style ? [...style.effects].reverse() : [];
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const add = (type: string) => {
    const e: EffectInstance = { id: createId("fx"), type, version: styleDefinition(type)!.version, enabled: true, params: styleDefaults(type) };
    commit((d) => addStyleEffect(d, layer.id, e));
    setOpen((now) => new Set(now).add(e.id));
  };
  const summary = effects.length ? (style!.enabled ? effects.map((e) => styleDefinition(e.type)?.label ?? e.type).join(", ") : "hidden") : null;
  return (
    <FoldSection
      id="effects"
      title="Effects"
      summary={summary}
      active={effects.length > 0}
      actions={
        <span className="flex items-center">
          {style && effects.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={style.enabled ? "Hide all effects" : "Show all effects"}
              title={style.enabled ? "Hide all effects" : "Show all effects"}
              aria-pressed={!style.enabled}
              onClick={() => commit((d) => setStyleEnabled(d, [layer.id], !style.enabled))}
            >
              {style.enabled ? <PiEye /> : <PiEyeSlash />}
            </Button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Add an effect" title="Add an effect" disabled={inWindow}>
                <PiPlus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" data-add-effect-menu>
              {STYLE_LIST.map((type) => {
                const def = styleDefinition(type)!;
                const full = (style?.effects ?? []).filter((e) => e.type === type).length >= def.max;
                return (
                  <DropdownMenuItem key={type} disabled={full} onSelect={() => add(type)} data-add-effect={type}>
                    {def.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-xs" aria-label="Open in Layer Style" title="Open in Layer Style" onClick={() => usePhotoUi.getState().setLayerStyle({ layerId: layer.id, page: effects[0]?.id ?? "blending" })}>
            <PiArrowSquareOut />
          </Button>
        </span>
      }
    >
      {inWindow ? (
        <p className="text-xs text-muted-foreground">Editing in the Layer Style window.</p>
      ) : effects.length === 0 ? (
        <p className="text-xs text-muted-foreground">No effects. + adds a shadow, a glow, a stroke…</p>
      ) : (
        <ul className="flex flex-col" data-effects-list>
          {effects.map((e) => (
            <EffectRow key={e.id} layerId={layer.id} effect={e} dimmed={!style!.enabled} open={open.has(e.id)} onToggle={() => toggle(e.id)} />
          ))}
        </ul>
      )}
    </FoldSection>
  );
}

function EffectRow({ layerId, effect, dimmed, open, onToggle }: { layerId: string; effect: EffectInstance; dimmed: boolean; open: boolean; onToggle: () => void }) {
  const commit = usePhoto((s) => s.commit);
  const def = styleDefinition(effect.type);
  const label = def?.label ?? effect.type;
  const usable = def !== undefined && effect.version <= def.version;
  return (
    <li className="flex flex-col border-b border-line last:border-b-0" data-properties-effect={effect.type} data-style-effect-id={effect.id}>
      <div className={cn("flex h-7 items-center gap-1", (dimmed || !effect.enabled) && "text-muted-foreground")}>
        <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open} disabled={!usable} onClick={onToggle}>
          {open ? <PiCaretDown className="size-3 shrink-0 text-muted-foreground" /> : <PiCaretRight className="size-3 shrink-0 text-muted-foreground" />}
          <span className="shrink-0">{label}</span>
          {!open && <span className="truncate text-xs text-muted-foreground/70">{usable ? def.summary(effect.params) : "unavailable"}</span>}
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={effect.enabled ? `Hide ${label}` : `Show ${label}`}
          title={effect.enabled ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={!effect.enabled}
          onClick={() => commit((d) => setStyleEffect(d, layerId, effect.id, { enabled: !effect.enabled }))}
        >
          {effect.enabled ? <PiEye /> : <PiEyeSlash />}
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`Delete ${label}`} title={`Delete ${label}`} onClick={() => commit((d) => removeStyleEffect(d, layerId, effect.id))}>
          <PiTrash />
        </Button>
      </div>
      {open && usable && <EffectControls layerId={layerId} effect={effect} />}
    </li>
  );
}

/** An effect's settings: its main page's, then each sub-page (Bevel's Contour, Texture) behind its checkbox. */
function EffectControls({ layerId, effect }: { layerId: string; effect: EffectInstance }) {
  const [live] = useState(liveEdit);
  const commit = usePhoto((s) => s.commit);
  const globalLight = usePhotoDoc(globalLightOf);
  const def = styleDefinition(effect.type)!;
  const p = effect.params;
  const subGroups = new Set(def.subPages?.map((s) => s.group));
  const shown = (group: string | undefined) => def.params.filter((spec) => specShows(spec, p) && spec.group === group && !def.subPages?.some((s) => s.toggle === spec.key));
  const groups = [...new Set(def.params.map((s) => s.group))].filter((g) => !subGroups.has(g ?? ""));
  const row = (spec: ParamSpec) => (
    <div key={spec.key} className="flex min-h-7 min-w-0 items-center gap-2" data-style-param={spec.key}>
      {spec.kind !== "boolean" && <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{spec.label}</span>}
      <StyleParam
        effect={effect}
        spec={spec}
        globalLight={globalLight}
        onParams={(params) => live((d) => setStyleEffect(d, layerId, effect.id, { params }))}
        onGlobalLight={(patch) => live((d) => setGlobalLight(d, patch))}
        onDeletePattern={(id) => commit((d) => removePattern(d, id))}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-1 pb-2.5 pl-4" data-effect-controls={effect.type}>
      {groups.map((g) => {
        const specs = shown(g);
        if (!specs.length) return null;
        return (
          <div key={g ?? ""} className="flex flex-col gap-1">
            {groups.length > 1 && g && <span className="pt-1 text-[11px] font-medium text-muted-foreground/80">{g}</span>}
            {specs.map(row)}
          </div>
        );
      })}
      {def.subPages?.map((sub) => (
        <div key={sub.group} className="flex flex-col gap-1 pt-1">
          <Check label={sub.label} checked={p[sub.toggle] === true} onChange={(on) => commit((d) => setStyleEffect(d, layerId, effect.id, { params: { [sub.toggle]: on } }))} />
          {p[sub.toggle] === true && <div className="flex flex-col gap-1 pl-4">{shown(sub.group).map(row)}</div>}
        </div>
      ))}
    </div>
  );
}
