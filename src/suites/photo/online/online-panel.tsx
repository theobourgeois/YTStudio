/**
 * The Online panel (docs/photo/online.md), Photoshop's Libraries for the whole internet: search open-source icons,
 * the web's images or free photos, or paste a link, and click a result to place it as a layer (or drag it onto the
 * canvas, to where it's dropped). Icons are drawn in the foreground colour at the size set here.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "cn";
import {
  PiArrowSquareOut,
  PiGlobe,
  PiImage,
  PiImages,
  PiMagnifyingGlass,
  PiScissors,
  PiShapes,
  PiSpinnerGap,
  PiWarningCircle,
  PiXCircleFill,
} from "react-icons/pi";
import { ICON_SIZES, type OnlineResult, WEB_FILTERS, type WebFilter, isLink } from "@shared/photo/online";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useColours } from "../colours";
import { usePhoto } from "../store";
import { type OnlineTab, iconSize, placeOnline, setOnlineDragData, useOnline } from "./online";

const TABS: { tab: OnlineTab; label: string; Icon: typeof PiShapes; placeholder: string }[] = [
  { tab: "icons", label: "Icons", Icon: PiShapes, placeholder: "Search 200,000 icons" },
  { tab: "web", label: "Web", Icon: PiGlobe, placeholder: "Search the web, or paste a link" },
  { tab: "photos", label: "Photos", Icon: PiImages, placeholder: "Search free photos, or paste a link" },
];

/** Transparency, as Photoshop shows it, in the theme's steps. */
const CHECKER = { background: "repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface-2) 0 50%) 0 0 / 10px 10px" };

const FILTER_LABELS: Record<WebFilter, string> = { any: "Any", transparent: "Transparent", clipart: "Clip art", line: "Line art", photo: "Photo" };

/** Typing searches once it pauses. */
const SEARCH_DELAY_MS = 350;

export function OnlinePanel() {
  const tab = useOnline((s) => s.tab);
  const query = useOnline((s) => s.query);
  const filter = useOnline((s) => s.filter);
  const loading = useOnline((s) => s.loading);
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder = TABS.find((t) => t.tab === tab)!.placeholder;

  // Searches what's typed (once it pauses), and again when the tab or the filter changes.
  useEffect(() => {
    const { searched } = useOnline.getState();
    const trimmed = query.trim();
    if (searched && searched.query === trimmed && searched.tab === tab && searched.filter === filter) return;
    const timer = setTimeout(() => void useOnline.getState().search(), trimmed ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [query, tab, filter]);

  useEffect(() => inputRef.current?.focus(), [tab]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-online-panel>
      <div className="flex shrink-0 flex-col gap-2 px-2.5 pt-2.5 pb-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={tab}
          onValueChange={(v) => v && useOnline.getState().set({ tab: v as OnlineTab })}
          aria-label="What to search"
          className="mb-1.5 grid w-full grid-cols-3 rounded-md bg-muted p-0.5"
        >
          {TABS.map(({ tab: t, label, Icon }) => (
            <ToggleGroupItem
              key={t}
              value={t}
              data-online-tab={t}
              className="h-6 min-w-0 gap-1.5 rounded-[5px]! text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs! dark:data-[state=on]:bg-accent [&_svg]:size-3.5!"
            >
              <Icon />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative">
          <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => useOnline.getState().set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void useOnline.getState().search();
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            spellCheck={false}
            className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
            data-online-search
          />
          {loading ? (
            <PiSpinnerGap className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            query && (
              <button
                type="button"
                onClick={() => {
                  useOnline.getState().set({ query: "" });
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-muted-foreground/70 hover:text-foreground"
              >
                <PiXCircleFill className="size-4" />
                <span className="sr-only">Clear search</span>
              </button>
            )
          )}
        </div>
        {tab === "icons" && !isLink(query) && <IconOptions />}
        {tab === "web" && !isLink(query) && <WebFilters />}
      </div>
      <Results />
    </div>
  );
}

/** An icon's colour (the foreground colour: the swatch is the tool strip's) and size. */
function IconOptions() {
  const foreground = useColours((s) => s.foreground);
  const size = useOnline((s) => s.iconSize);
  // The canvas's suggestion follows the photo until a size is typed.
  usePhoto((s) => s.history?.doc.doc.canvas);
  const shown = size ?? iconSize();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-icon-options>
      <ColorSwatchPicker
        value={foreground}
        label="Icon colour (the foreground colour)"
        side="left"
        edit={{ begin: () => {}, set: (hex) => useColours.getState().set({ foreground: hex }), end: () => {} }}
        className="size-5"
      />
      <span>Colour</span>
      <label className="ml-auto flex items-center gap-1.5">
        Size
        <Input
          type="number"
          min={ICON_SIZES.min}
          max={ICON_SIZES.max}
          value={shown}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n > 0) useOnline.getState().set({ iconSize: Math.min(ICON_SIZES.max, n) });
          }}
          onBlur={() => useOnline.getState().set({ iconSize: Math.max(ICON_SIZES.min, shown) })}
          className="h-6 w-16 px-1.5 text-right text-xs tabular-nums"
          aria-label="Icon size in pixels"
          data-icon-size
        />
        px
      </label>
    </div>
  );
}

function WebFilters() {
  const filter = useOnline((s) => s.filter);
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind of picture">
      {WEB_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={filter === f}
          onClick={() => useOnline.getState().set({ filter: f })}
          className={cn(
            "h-5.5 rounded-full border border-line px-2 text-[11px] text-muted-foreground hover:text-foreground",
            filter === f && "border-brand/60 bg-brand/15 text-foreground",
          )}
          data-web-filter={f}
        >
          {FILTER_LABELS[f]}
        </button>
      ))}
    </div>
  );
}

function Results() {
  const results = useOnline((s) => s.results);
  const searched = useOnline((s) => s.searched);
  const loading = useOnline((s) => s.loading);
  const error = useOnline((s) => s.error);
  const next = useOnline((s) => s.next);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // More as the end scrolls into view.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || next === null) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void useOnline.getState().more(), { root: scroller.current, rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [next, results.length]);

  if (error) {
    return (
      <Hint icon={<PiWarningCircle className="size-5" />} title={searched && isLink(searched.query) ? "Couldn't read that link" : "Search failed"}>
        {error}
      </Hint>
    );
  }
  if (!searched) {
    return (
      <Hint icon={<PiImage className="size-5" />} title="Find a picture">
        Icons, the web&apos;s images and free photos, or paste a link to take the pictures on its page. Click one to place it as a layer, or drag it onto
        the canvas.
      </Hint>
    );
  }
  if (!loading && results.length === 0) {
    return (
      <Hint icon={<PiMagnifyingGlass className="size-5" />} title="Nothing found">
        Nothing matched “{searched.query}”. Try other words{searched.tab === "icons" ? " (icons have short names: bell, heart, arrow)" : ""}.
      </Hint>
    );
  }
  const icons = results.length > 0 && results.every((r) => r.source === "icons");
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5" data-online-results={searched.tab}>
      <div className={cn("grid gap-1.5", icons ? "grid-cols-[repeat(auto-fill,minmax(48px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(88px,1fr))]")} aria-busy={loading}>
        {results.map((result) => (
          <ResultCard key={result.id} result={result} />
        ))}
      </div>
      {next !== null && <div ref={sentinel} className="h-1" />}
      {loading && (
        <div className="flex justify-center py-3 text-muted-foreground">
          <PiSpinnerGap className="size-4 animate-spin" />
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: OnlineResult }) {
  const placing = useOnline((s) => s.placing.includes(result.id));
  const icon = result.source === "icons";
  const tip = [result.title, result.set, result.credit && `by ${result.credit}`, result.license, icon ? undefined : "Click to place, or drag onto the canvas"].filter(Boolean).join(" · ");
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(e) => setOnlineDragData(e.dataTransfer, result)}
          onClick={() => void placeOnline(result)}
          title={tip}
          aria-label={`Place ${result.title}`}
          className="group relative grid aspect-square min-w-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-2 hover:border-brand/70 hover:bg-surface-3"
          style={icon ? undefined : CHECKER}
          data-online-result={result.id}
        >
          <Thumb result={result} />
          {placing && (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <PiSpinnerGap className="size-4 animate-spin" />
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => void placeOnline(result)}>
          <PiImage /> Place
        </ContextMenuItem>
        {!icon && (
          <ContextMenuItem onSelect={() => void placeOnline(result, { cutOut: true })} data-place-cut-out>
            <PiScissors /> Place without background
          </ContextMenuItem>
        )}
        {result.page && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => window.open(result.page, "_blank", "noopener")}>
              <PiArrowSquareOut /> Open its page
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A result's picture. A one-colour icon is shown in the text's colour (its shape as a mask), so it reads in any
 * theme; it's placed in the foreground colour.
 */
function Thumb({ result }: { result: OnlineResult }) {
  if (result.source === "icons" && !result.palette) {
    return (
      <span
        className="size-6 bg-foreground"
        style={{ maskImage: `url("${result.thumb}")`, WebkitMaskImage: `url("${result.thumb}")`, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
      />
    );
  }
  return (
    <img
      src={result.thumb}
      alt=""
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      className={cn("pointer-events-none object-contain", result.source === "icons" ? "size-6" : "size-full")}
      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
    />
  );
}

function Hint({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
