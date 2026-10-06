/**
 * Where filters are found (docs/photo/foundations-prototype.md, "F5"): Photoshop's Filter menu in the header (Last
 * Filter, the Filter Gallery, then each category's filters and their looks) and the Filter Gallery, a window of every
 * look as a card, each previewed on this photo (the active layer filtered, or a generator added), applied by a click.
 * Both are built from the catalogue (`shared/photo/effects/catalog.ts`): a new filter needs no UI of its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { PiCaretDown, PiMagnifyingGlass, PiSparkle, PiSunHorizon } from "react-icons/pi";
import { addFilter, addGeneratorLayer, findLayer } from "@shared/photo/edits";
import { type FilterEntry, FILTER_ENTRIES, entryParams, filterCategories, searchFilters } from "@shared/photo/effects/catalog";
import { type FilterCategory, effectDefinition } from "@shared/photo/effects/index";
import { type PhotoProject, hasContent } from "@shared/photo/types";
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
import { FloatingWindow, WindowBody, centredOnDesktop } from "@/components/windows/floating-window";
import { layerActions } from "./layer-actions";
import { liveRenderer } from "./live";
import { usePhoto, usePhotoDoc } from "./store";
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

/** The width previews are rendered at (shown at half on a 2× screen). */
const PREVIEW_WIDTH = 320;
/** Previews wait this long after the photo last changed. */
const PREVIEW_DELAY_MS = 400;
/** Fixed ids for what a preview adds: never the document's (theirs are random). */
const PREVIEW_FILTER = "fx_000000000000";
const PREVIEW_LAYER = "layer_000000000000";

/** The photo with an entry applied as a click would (null when it can't be: a filter with no layer to go on). */
export function previewDoc(doc: PhotoProject, entry: FilterEntry, layerId: string | null): PhotoProject | null {
  const params = entryParams(entry, doc.canvas);
  if (entry.def.kind === "generator") return addGeneratorLayer(doc, { id: PREVIEW_LAYER, type: entry.def.type, params }, layerId);
  const layer = layerId ? findLayer(doc, layerId) : undefined;
  if (!layer || !hasContent(layer)) return null;
  return addFilter(doc, layer.id, { id: PREVIEW_FILTER, type: entry.def.type, params });
}

/**
 * Object URLs of each entry's preview (and `base`, the photo as it is, for entries that have never been able to
 * apply), rendered one after another by the photo's renderer a moment after the photo or the active layer last
 * changed. The previous ones stay shown until they're replaced (an entry that can't apply now keeps its last one).
 */
function usePreviews(entries: readonly FilterEntry[]): Record<string, string> {
  const doc = usePhoto((s) => s.history?.doc.doc ?? null);
  const layerId = usePhotoUi((s) => s.selectedLayerId);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const made = useRef<string[]>([]);
  const keys = entries.map((e) => e.key).join(" ");
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const pending = liveRenderer();
      if (!pending) return;
      const renderer = await pending;
      const render = async (key: string, shown: PhotoProject) => {
        try {
          const blob = await renderer.picture(shown, PREVIEW_WIDTH);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          made.current.push(url);
          setUrls((prev) => {
            const old = prev[key];
            // Let go of the one replaced once the new one has been drawn.
            if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
            return { ...prev, [key]: url };
          });
        } catch {
          // A preview is a nicety: the card keeps its last one.
        }
      };
      if (entries.some((e) => !previewDoc(doc, e, layerId))) await render("base", doc);
      for (const entry of entries) {
        if (cancelled) return;
        const shown = previewDoc(doc, entry, layerId);
        if (shown) await render(entry.key, shown);
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, layerId, keys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => made.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return urls;
}

/** One look: its preview on this photo, its name and filter; a click applies it. */
export function FilterCard({ entry, preview, disabled, reason, onApply }: { entry: FilterEntry; preview: string | null; disabled?: boolean; reason?: string; onApply: () => void }) {
  return (
    <button
      type="button"
      className={cn("group flex flex-col gap-1.5 rounded-md p-1.5 text-left", disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface-2")}
      aria-label={`${entry.def.label}: ${entry.preset.label}`}
      aria-disabled={disabled || undefined}
      title={disabled ? reason : entry.preset.description}
      onClick={() => !disabled && onApply()}
      data-filter-card={entry.key}
      data-preview={preview ? "ready" : "pending"}
    >
      <span className="sunken grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-sm bg-surface-2">
        {preview ? <img src={preview} alt="" className="size-full object-contain" draggable={false} /> : <span className="size-full animate-pulse bg-surface-2" />}
      </span>
      <span className="flex flex-col px-0.5">
        <span className="truncate text-[13px] font-medium">{entry.preset.label}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.preset.description}</span>
      </span>
    </button>
  );
}

/** The Filter Gallery: every look, searchable, by category, previewed on this photo. */
export function FilterGalleryWindow() {
  const [initial] = useState(() => ({ ...centredOnDesktop(720, 560, "photo"), width: 720, height: 560 }));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilterCategory | null>(null);
  const { name, canFilter } = useTarget();
  const entries = useMemo(() => searchFilters(query, category), [query, category]);
  const previews = usePreviews(FILTER_ENTRIES);
  const categories = filterCategories();
  const close = () => usePhotoUi.getState().setFilterGalleryOpen(false);
  return (
    <FloatingWindow id="filters" title="Filter Gallery" initial={initial} resizable={{ minWidth: 420, minHeight: 320 }} keepsKeys onClose={close}>
      <WindowBody className="h-full gap-4">
        <div className="flex flex-wrap items-center gap-2" data-filter-gallery>
          <label className="relative min-w-48 flex-1">
            <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7" placeholder="Search filters" aria-label="Search filters" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
          </label>
          <div className="flex gap-1" role="radiogroup" aria-label="Category">
            {[null, ...categories].map((c) => (
              <Button key={c ?? "all"} size="sm" variant={category === c ? "secondary" : "outline"} role="radio" aria-checked={category === c} onClick={() => setCategory(c)}>
                {c ?? "All"}
              </Button>
            ))}
          </div>
        </div>
        <p className="-mt-1 text-[13px] text-muted-foreground">{canFilter ? `Filters go on "${name}"; generators add a layer above it. A click applies a look; change it after in Properties.` : `${unavailable(name)} Generators add a layer.`}</p>
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
                {looks.map((e) => (
                  <FilterCard key={e.key} entry={e} preview={previews[e.key] ?? previews.base ?? null} disabled={blocked} reason={unavailable(name)} onApply={() => layerActions.applyFilter(e.key)} />
                ))}
              </div>
            </section>
          );
        })}
      </WindowBody>
    </FloatingWindow>
  );
}
