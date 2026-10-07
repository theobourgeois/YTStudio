/**
 * Where filters are found (docs/photo/foundations-prototype.md, "F5"): Photoshop's Filter menu in the header (Last
 * Filter, the Filter Gallery, then each category's filters and their looks) and the Filter Gallery, a window of every
 * look as a card (a picture of it on a sample scene), one picked at a time and previewed on this photo (the active
 * layer filtered, or a generator added) with its settings beside the grid, applied by Apply.
 * Both are built from the catalogue (`shared/photo/effects/catalog.ts`): a new filter needs no UI of its own.
 */
import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
import { cn } from "cn";
import { PiArrowCounterClockwise, PiCaretDown, PiCursorClick, PiMagnifyingGlass, PiSparkle, PiSunHorizon } from "react-icons/pi";
import { type FilterEntry, FILTER_ENTRIES, filterCategories, filterEntry, searchFilters } from "@shared/photo/effects/catalog";
import { type FilterCategory, effectDefinition } from "@shared/photo/effects/index";
import { specShows } from "@shared/photo/effects/params";
import { type EffectParamValue, hasContent } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FloatingWindow, WindowBody, WindowFooter, centredOnDesktop } from "@/components/windows/floating-window";
import { isHtmlElement, ownerDocument } from "@/lib/window-events";
import { type FilterPreview, startingPreview } from "./filter-preview";
import { layerActions } from "./layer-actions";
import { cameraRawActions } from "./camera-raw/actions";
import { ParamField } from "./panels/params";
import { SceneModelNote } from "./scene-model-dialog";
import { currentDoc, usePhotoDoc } from "./store";
import { usePhotoUi } from "./ui";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Each definition's icon (the menus' and the gallery's sections). */
const ICONS: Record<string, typeof PiSparkle> = { glow: PiSunHorizon, "lens-flare": PiSparkle };

/** The definitions the catalogue lists, in its order, each once, with their entries. */
function byDefinition(entries: readonly FilterEntry[]): { def: FilterEntry["def"]; entries: FilterEntry[] }[] {
  const groups: { def: FilterEntry["def"]; entries: FilterEntry[] }[] = [];
  for (const e of entries) {
    const group = groups.find((g) => g.def === e.def);
    if (group) group.entries.push(e);
    else groups.push({ def: e.def, entries: [e] });
  }
  return groups;
}

/** Whether a filter can go on the active layer now (a generator always can: it's a new layer), or why not. */
function useTarget(): { name: string | null; canFilter: boolean } {
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const active = usePhotoDoc((d) => d.layers.find((l) => l.id === activeId));
  return { name: active?.name ?? null, canFilter: !!active && hasContent(active) };
}

const unavailable = (name: string | null) =>
  name ? `"${name}" is an adjustment layer: filters work on a layer's own pixels.` : "Select an image, pixel or generator layer to filter it.";

/** Photoshop's Filter menu, in the header. */
export function FilterMenu() {
  const { name, canFilter } = useTarget();
  const last = usePhotoUi((s) => s.lastFilter);
  const lastLabel = last ? effectDefinition(last.type)?.label : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-filter-menu>
          Filter <PiCaretDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem disabled={!last || !canFilter} onSelect={() => layerActions.repeatLastFilter()}>
          {lastLabel ? `Last Filter: ${lastLabel}` : "Last Filter"}
          <DropdownMenuShortcut>{MAC ? "⌃⌘F" : "Ctrl+Alt+F"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => usePhotoUi.getState().setFilterGalleryOpen(true)}>Filter Gallery…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => cameraRawActions.filter()} data-camera-raw-item>
          Camera Raw Filter…
          <DropdownMenuShortcut>{MAC ? "⇧⌘A" : "Shift+Ctrl+A"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {filterCategories().map((category) => (
          <div key={category}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{category}</DropdownMenuLabel>
            {byDefinition(FILTER_ENTRIES.filter((e) => e.def.category === category)).map(({ def, entries }) => {
              const Icon = ICONS[def.type] ?? PiSparkle;
              const blocked = def.kind === "filter" && !canFilter;
              return (
                <DropdownMenuSub key={def.type}>
                  <DropdownMenuSubTrigger disabled={blocked} title={blocked ? unavailable(name) : undefined}>
                    <Icon /> {def.label}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {entries.map((e) => (
                      <DropdownMenuItem key={e.key} onSelect={() => layerActions.applyFilter(e.key)} data-filter-item={e.key}>
                        {e.preset.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A look's card picture: its preset rendered once on a sample scene (`scripts/photo-sheet.ts --thumbnails`), not this photo. */
export const thumbnailUrl = (key: string) => `/photo-filters/${key.replace("/", "--")}.jpg`;

/** One look: its picture, name and what it does; a click picks it (previewed on the photo), a double-click applies it. */
export function FilterCard({ entry, picked, disabled, reason, onPick, onApply }: { entry: FilterEntry; picked?: boolean; disabled?: boolean; reason?: string; onPick: () => void; onApply: () => void }) {
  const [missing, setMissing] = useState(false);
  const Icon = ICONS[entry.def.type] ?? PiSparkle;
  return (
    <button
      type="button"
      className={cn(
        "group flex flex-col gap-1.5 rounded-md p-1.5 text-left outline-none",
        disabled ? "cursor-not-allowed opacity-50" : picked ? "bg-brand/15 ring-2 ring-brand" : "hover:bg-surface-2",
      )}
      aria-label={`${entry.def.label}: ${entry.preset.label}`}
      aria-pressed={picked || undefined}
      aria-disabled={disabled || undefined}
      title={disabled ? reason : entry.preset.description}
      onClick={() => !disabled && onPick()}
      onDoubleClick={() => !disabled && onApply()}
      data-filter-card={entry.key}
      data-picked={picked || undefined}
    >
      <span className="sunken grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-sm bg-surface-2">
        {missing ? (
          <Icon className="size-6 text-muted-foreground" />
        ) : (
          <img src={thumbnailUrl(entry.key)} alt="" loading="lazy" className="size-full object-cover" draggable={false} onError={() => setMissing(true)} />
        )}
      </span>
      <span className="flex flex-col px-0.5">
        <span className="truncate text-[13px] font-medium">{entry.preset.label}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.preset.description}</span>
      </span>
    </button>
  );
}

/** The picked look's settings, changed before it's applied (the canvas follows them). */
function LookSettings({ entry, preview }: { entry: FilterEntry; preview: FilterPreview }) {
  const set = (key: string, value: EffectParamValue) => {
    // The latest settings (a slider's values come faster than renders).
    const now = usePhotoUi.getState().filterPreview;
    if (now?.key === preview.key) usePhotoUi.getState().setFilterPreview({ ...now, params: { ...now.params, [key]: value } });
  };
  return (
    <div className="flex flex-col gap-3" data-filter-settings={entry.key}>
      <SceneModelNote def={entry.def} params={preview.params} />
      {entry.def.params
        .filter((spec) => specShows(spec, preview.params))
        .map((spec) => (
          <ParamField key={spec.key} spec={spec} value={preview.params[spec.key]} change={(v) => set(spec.key, v)} />
        ))}
    </div>
  );
}

/**
 * The Filter Gallery: every look, searchable, by category, each a picture of it on a sample scene. A click shows the
 * look on the photo (nothing changes in the document); its settings can be changed beside the grid; Apply adds it
 * (one undo step) and closes the gallery, Cancel or another look puts it back. Enter applies, Escape cancels.
 */
export function FilterGalleryWindow() {
  const [initial] = useState(() => ({ ...centredOnDesktop(980, 640, "photo"), width: 980, height: 640 }));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilterCategory | null>(null);
  const { name, canFilter } = useTarget();
  const preview = usePhotoUi((s) => s.filterPreview);
  const entries = useMemo(() => searchFilters(query, category), [query, category]);
  const categories = filterCategories();
  const picked = preview ? filterEntry(preview.key) : undefined;
  const blockedLook = picked?.def.kind === "filter" && !canFilter;
  const ui = usePhotoUi.getState;
  const close = () => ui().setFilterGalleryOpen(false);
  const pick = (entry: FilterEntry) => {
    const doc = currentDoc();
    if (doc && ui().filterPreview?.key !== entry.key) ui().setFilterPreview(startingPreview(entry, doc));
  };
  const cancel = () => ui().setFilterPreview(null);
  const apply = (look = ui().filterPreview) => {
    if (!look) return;
    const entry = filterEntry(look.key);
    if (!entry || (entry.def.kind === "filter" && !canFilter)) return;
    ui().setFilterPreview(null);
    layerActions.applyFilter(look.key, look.params);
    close();
  };
  const reset = () => {
    const doc = currentDoc();
    if (doc && picked) ui().setFilterPreview(startingPreview(picked, doc));
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    // An open menu or popover (a colour, a gradient) has its own keys.
    if (ownerDocument(e.currentTarget).querySelector("[data-radix-popper-content-wrapper] [data-state=open]")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (ui().filterPreview) cancel();
      else close();
    } else if (e.key === "Enter" && ui().filterPreview && !isTextField(e.target)) {
      e.preventDefault();
      apply();
    }
  };
  return (
    <FloatingWindow id="filters" title="Filter Gallery" initial={initial} resizable={{ minWidth: 640, minHeight: 360 }} keepsKeys escapeCloses={false} onClose={close}>
      <div className="flex h-full min-h-0" onKeyDown={onKeyDown} data-filter-gallery>
        <WindowBody className="h-full flex-1 gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-7" placeholder="Search filters" aria-label="Search filters" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
            </label>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Category">
              {[null, ...categories].map((c) => (
                <Button key={c ?? "all"} size="sm" variant={category === c ? "secondary" : "outline"} role="radio" aria-checked={category === c} onClick={() => setCategory(c)}>
                  {c ?? "All"}
                </Button>
              ))}
            </div>
          </div>
          {entries.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No filter matches "{query}".</p>}
          {byDefinition(entries).map(({ def, entries: looks }) => {
            const Icon = ICONS[def.type] ?? PiSparkle;
            const blocked = def.kind === "filter" && !canFilter;
            return (
              <section key={def.type} className="flex flex-col gap-2" data-filter-section={def.type}>
                <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="size-3.5" /> {def.label}
                  <span className="font-normal normal-case tracking-normal">· {def.kind === "filter" ? "a filter on the layer" : "a new layer"}</span>
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
                  {looks.map((e) => (
                    <FilterCard key={e.key} entry={e} picked={preview?.key === e.key} disabled={blocked} reason={unavailable(name)} onPick={() => pick(e)} onApply={() => apply(ui().filterPreview?.key === e.key ? ui().filterPreview : startingPreview(e, currentDoc()!))} />
                  ))}
                </div>
              </section>
            );
          })}
        </WindowBody>
        <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface-1" data-filter-look>
          {picked && preview ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">
                    {picked.def.label} · {picked.preset.label}
                  </h3>
                  <p className="text-xs text-muted-foreground">{picked.preset.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {blockedLook ? unavailable(name) : picked.def.kind === "filter" ? `Previewing on "${name}".` : "Previewing as a new layer."}
                  </p>
                </div>
                <LookSettings entry={picked} preview={preview} />
              </div>
              <WindowFooter className="border-t border-line p-3 sm:justify-between">
                <Button size="sm" variant="ghost" onClick={reset}>
                  <PiArrowCounterClockwise /> Reset
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={cancel} data-filter-cancel>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={blockedLook} onClick={() => apply()} data-filter-apply>
                    Apply
                  </Button>
                </div>
              </WindowFooter>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <PiCursorClick className="size-6" />
              <p>Click a look to preview it on the photo{canFilter ? ` (filters go on "${name}")` : ""}, change its settings here, then Apply.</p>
              <p>Double-click applies one straight away.</p>
              {!canFilter && <p>{unavailable(name)} Generators add a layer.</p>}
            </div>
          )}
        </aside>
      </div>
    </FloatingWindow>
  );
}

/** Whether a key press is typing (a text field's own Enter). */
const isTextField = (target: EventTarget | null) => isHtmlElement(target) && (target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox"));
