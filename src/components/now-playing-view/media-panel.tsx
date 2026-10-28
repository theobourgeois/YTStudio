import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowBendUpRight,
  PiArrowLeft,
  PiArrowSquareOut,
  PiCheck,
  PiCube,
  PiFilmStrip,
  PiGlobe,
  PiImage,
  PiKey,
  PiMagnifyingGlass,
  PiMonitor,
  PiPackage,
  PiPencilSimple,
  PiPersonSimpleRun,
  PiPlus,
  PiShuffle,
  PiSpinnerGap,
  PiTrash,
  PiUploadSimple,
  PiX,
  PiXCircleFill,
} from "react-icons/pi";
import { formatDuration } from "@shared/format";
import { MODEL_SITES, MODEL_SOURCES, STARTER_MODELS, modelOrigin } from "@shared/model-search";
import type { MediaAsset, ModelResult, ModelSearchStatus, ModelSource, WebClip, WebDownloadProgress } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { cn } from "cn";
import { useEndOfList, useWebSearch } from "@/components/media/use-web-search";
import { api } from "@/lib/api";
import { LONG_TAKES, LONG_VIDEO, MEDIA_FOLDER, useVisualizerMedia } from "./media-library";
import { newSetName } from "./media-sets";
import { useVisualizerPrefs } from "./prefs";
import { useVisualizerScreen } from "./screen";
import { useModelSearch } from "./use-model-search";
import { desktopScreens } from "@/lib/desktop";

/**
 * The panel's pages: the set's sources, and the three ways in that need one of their own (files go straight to the
 * system's picker). The view keeps which: G opens it on Screen.
 */
export type MediaTab = "sources" | "online" | "models" | "screen";

/**
 * The user's media for the visualizer (docs/now-playing.md, "Your media"): sets up top (one in use at a time, K the
 * next), then every source in the set in use, whatever it is (a clip, a picture, a 3D model, the screen shared), the
 * one on screen marked; one Add for all of them: files (or dropped anywhere on the visualizer), a video found online,
 * a 3D model found on Poly Pizza or Sketchfab, a screen or window. Kept in the Library's Visualizer folder, a folder a set.
 */
export function MediaPanel({ milkdrop, tab, onTab: setTab }: { milkdrop: boolean; tab: MediaTab; onTab: (tab: MediaTab) => void }) {
  const media = useVisualizerMedia((s) => s.media);
  const on = useVisualizerPrefs((s) => s.media);
  const screen = useVisualizerScreen((s) => s.shared);
  const back = () => setTab("sources");
  return (
    <div
      data-media-panel
      data-page={tab}
      className="pointer-events-auto absolute top-16 right-4 bottom-36 flex w-[22rem] flex-col overflow-hidden rounded-xl bg-black/75 ring-1 ring-white/10 backdrop-blur-md"
    >
      {tab === "sources" ? (
        <Sources onTab={setTab} />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
            <button
              type="button"
              aria-label="Back to your media"
              title="Back to your media"
              onClick={back}
              className="grid size-7 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white [&_svg]:size-4"
            >
              <PiArrowLeft />
            </button>
            <h2 className="text-[13px] font-medium text-white">{tab === "online" ? "Online video" : tab === "models" ? "3D models" : "Screen or window"}</h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
            {tab === "online" ? <Online onAdded={back} /> : tab === "models" ? <Models /> : <Screen />}
          </div>
        </>
      )}
      {((on && media.length > 0) || screen) && !milkdrop && (
        <p data-media-note className="mx-4 mb-3 rounded-md bg-white/10 px-3 py-2 text-[11px] leading-4 text-white/80">
          This look isn't one of MilkDrop's, so it shows none: the next MilkDrop look will (↑ ↓ to MilkDrop, or the looks menu).
        </p>
      )}
    </div>
  );
}

/** The sets, then what's in the one in use (and the screen, shared), Add and Another. */
function Sources({ onTab }: { onTab: (tab: MediaTab) => void }) {
  const media = useVisualizerMedia((s) => s.media);
  const sets = useVisualizerMedia((s) => s.sets);
  const loaded = useVisualizerMedia((s) => s.loaded);
  const adding = useVisualizerMedia((s) => s.adding);
  const starter = useVisualizerMedia((s) => s.starter);
  const shared = useVisualizerScreen((s) => s.shared);
  const on = useVisualizerPrefs((s) => s.media);
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  // A source being moved into another set (its item).
  const [moving, setMoving] = useState<string | null>(null);
  const moved = media.find((m) => m.itemId === moving);
  const pick = () => input.current?.click();
  const ways = { files: pick, online: () => onTab("online"), models: () => onTab("models"), screen: () => onTab("screen") };
  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 className="mr-auto text-[13px] font-medium text-white">Your media</h2>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="In the looks (⇧N)"
          title={on ? "In MilkDrop's looks: ⇧N takes them out" : "Out of the looks: ⇧N brings them back"}
          onClick={() => useVisualizerPrefs.getState().setMedia(!on)}
          className="flex h-6 items-center gap-1.5 rounded-full bg-white/5 pr-1 pl-2 text-[11px] text-white/75 ring-1 ring-white/15 hover:bg-white/10"
        >
          {on ? "In the looks" : "Off"}
          <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", on ? "bg-white" : "bg-white/20")}>
            <span className={cn("absolute top-0.5 size-2.5 rounded-full transition-all", on ? "left-3 bg-black" : "left-0.5 bg-white/70")} />
          </span>
        </button>
      </div>
      <div className="px-4">
        <Sets />
      </div>
      {moved && (
        <div data-moving className="mx-4 mb-2 rounded-md bg-white/10 px-3 py-2 ring-1 ring-white/15">
          <p className="mb-2 truncate text-[11px] text-white/75">Move {moved.asset.name} to</p>
          <div className="flex flex-wrap gap-1">
            {sets
              .filter((s) => !s.media.some((m) => m.itemId === moved.itemId))
              .map((s) => (
                <Chip
                  key={s.id}
                  on={false}
                  onClick={() => {
                    setMoving(null);
                    void useVisualizerMedia.getState().move(moved.itemId, s.id);
                  }}
                >
                  {s.name}
                </Chip>
              ))}
            <Chip on={false} onClick={() => setMoving(null)}>
              Cancel
            </Chip>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shared && <ScreenRow name={shared.name} onOpen={() => onTab("screen")} />}
        {media.length ? (
          <ul aria-label="Sources" className="flex flex-col gap-0.5">
            {media.map(({ itemId, asset }) => (
              <SourceRow key={itemId} asset={asset} canMove={sets.length > 1} onMove={() => setMoving(itemId)} onRemove={() => void useVisualizerMedia.getState().remove(itemId)} />
            ))}
          </ul>
        ) : (
          loaded && !starter && (
            <div className="mx-2 mt-1 rounded-lg bg-white/5 px-3 py-4 text-center ring-1 ring-white/10">
              <p className="text-[12px] text-white/70">{sets.length ? "Nothing in this set yet." : "Nothing yet."}</p>
              <p className="mt-1 text-[11px] leading-4 text-white/50">
                Clips, pictures and 3D models melt into MilkDrop's looks, one at a time, punching on the kicks with trails streaming off them.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <Way icon={<PiUploadSimple />} name="Files" onClick={ways.files} />
                <Way icon={<PiCube />} name="3D models" onClick={ways.models} />
                <Way icon={<PiGlobe />} name="Online video" onClick={ways.online} />
                <Way icon={<PiMonitor />} name="Screen" onClick={ways.screen} />
              </div>
            </div>
          )
        )}
        {starter && <StarterProgress done={starter.done} total={starter.total} />}
      </div>
      {adding > 0 && <p className="px-4 pb-1 text-[11px] text-white/60">Adding {adding}…</p>}
      <div className="relative grid grid-cols-[1fr_auto] gap-1.5 border-t border-white/10 px-4 py-3">
        {menu && <AddMenu ways={ways} onClose={() => setMenu(false)} />}
        <button
          type="button"
          aria-expanded={menu}
          aria-haspopup="menu"
          onClick={() => setMenu((m) => !m)}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white text-[12px] font-medium text-black hover:bg-white/90 [&_svg]:size-3.5"
        >
          <PiPlus />
          Add
        </button>
        <Button disabled={!media.length || !on} onClick={() => useVisualizerPrefs.getState().requestNextMedia()}>
          <PiShuffle />
          Another (N)
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,image/*,.glb,model/gltf-binary"
        aria-label="Add files: clips, pictures or 3D models"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void useVisualizerMedia.getState().add(files);
        }}
      />
    </>
  );
}

/** Add's menu: the four ways in, over the footer (Escape or a click elsewhere closes it). */
function AddMenu({ ways, onClose }: { ways: Record<"files" | "online" | "models" | "screen", () => void>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const item = (way: keyof typeof ways, icon: React.ReactNode, name: string, line: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        ways[way]();
      }}
      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-white/10"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10 text-white [&_svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] text-white">{name}</span>
        <span className="block truncate text-[11px] text-white/50">{line}</span>
      </span>
    </button>
  );
  return (
    <div ref={ref} role="menu" aria-label="Add" className="absolute right-4 bottom-full left-4 mb-1 rounded-lg bg-neutral-900/95 p-1 shadow-2xl ring-1 ring-white/15 backdrop-blur-md">
      {item("files", <PiUploadSimple />, "Files…", "Videos, pictures, .glb models (or drop them)")}
      {item("online", <PiGlobe />, "Online video", "YouTube, or a link from TikTok, X…")}
      {item("models", <PiCube />, "3D models", "Characters, animals, things: Poly Pizza, Sketchfab")}
      {item("screen", <PiMonitor />, "Screen or window", "A program as you work in it, a game…")}
    </div>
  );
}

function Way({ icon, name, onClick }: { icon: React.ReactNode; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/10 text-[11px] text-white/85 ring-1 ring-white/15 hover:bg-white/15 [&_svg]:size-3.5"
    >
      {icon}
      {name}
    </button>
  );
}

/** What a source is, in a word or two (a model: whether it moves). */
function kindOf(asset: MediaAsset): { icon: React.ReactNode; label: string } {
  if (asset.kind === "model") {
    const moves = (asset.model?.animations.length ?? 0) > 0;
    return { icon: moves ? <PiPersonSimpleRun /> : <PiCube />, label: moves ? "3D · animated" : "3D" };
  }
  if (asset.kind === "video") return { icon: <PiFilmStrip />, label: asset.duration > 0 ? `Video · ${formatDuration(asset.duration)}` : "Video" };
  return { icon: <PiImage />, label: "Picture" };
}

/** One of the set's sources: its picture, its name, what it is (a model's credit), on screen or not; moved, taken out. */
function SourceRow({ asset, canMove, onMove, onRemove }: { asset: MediaAsset; canMove: boolean; onMove: () => void; onRemove: () => void }) {
  const feeding = useVisualizerMedia((s) => s.feeding.includes(asset.id));
  const picture = asset.poster ?? (asset.kind === "image" ? asset.src : null);
  const kind = kindOf(asset);
  const credit = asset.model?.credit;
  return (
    <li
      data-media={asset.id}
      data-kind={asset.kind}
      data-feeding={feeding || undefined}
      className={cn("group flex min-w-0 items-center gap-2.5 rounded-lg p-1.5 hover:bg-white/5", feeding && "bg-white/10 hover:bg-white/10")}
    >
      <span
        className={cn(
          "relative grid aspect-video w-16 shrink-0 place-items-center overflow-hidden rounded-md ring-1",
          asset.kind === "model" ? "bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_70%)]" : "bg-white/5",
          feeding ? "ring-white" : "ring-white/10",
        )}
      >
        {picture ? (
          <img src={picture} alt="" draggable={false} className={cn("size-full", asset.kind === "model" ? "object-contain p-0.5" : "object-cover")} />
        ) : (
          <span className="text-white/40 [&_svg]:size-4">{kind.icon}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-4 text-white/90" title={asset.name}>
          {asset.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px] leading-4 text-white/50">
          <span className="flex shrink-0 items-center gap-1 rounded bg-white/10 px-1 text-white/70 [&_svg]:size-2.5">
            {kind.icon}
            {kind.label}
          </span>
          {credit && (
            <span className="truncate" title={`${credit.title} by ${credit.author}, ${credit.licence} (${credit.url})`}>
              {credit.author} · {credit.licence}
            </span>
          )}
        </span>
      </span>
      {feeding && (
        <span title="In the look now" className="mr-1 flex shrink-0 items-center gap-1 text-[10px] font-medium tracking-wide text-white uppercase group-hover:hidden">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
          On
        </span>
      )}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
        {canMove && (
          <RowButton label={`Move ${asset.name} to another set`} onClick={onMove}>
            <PiArrowBendUpRight />
          </RowButton>
        )}
        <RowButton label={`Take ${asset.name} out`} title="Take it out (it's deleted from the Library)" onClick={onRemove}>
          <PiX />
        </RowButton>
      </span>
    </li>
  );
}

/** The screen shared, as a source above the set's (its page has the picture and Stop). */
function ScreenRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" data-screen-row onClick={onOpen} className="mb-0.5 flex w-full min-w-0 items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-white/5">
      <span className="grid aspect-video w-16 shrink-0 place-items-center rounded-md bg-red-500/15 text-red-300 ring-1 ring-red-400/40 [&_svg]:size-4">
        <PiMonitor />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-4 text-white/90">{name}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-4 text-white/50">
          <span className="rounded bg-red-500/25 px-1 text-red-200">Screen · live</span>
          shown whole, your media over it now and then
        </span>
      </span>
      <span className="mr-1 size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
    </button>
  );
}

function StarterProgress({ done, total }: { done: number; total: number }) {
  return (
    <div data-starter className="mx-2 mt-2 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
      <p className="flex items-center gap-1.5 text-[11px] text-white/75 [&_svg]:size-3.5">
        <PiPackage />
        <span className="mr-auto">The starter pack is coming in</span>
        <span className="font-mono text-[10px] text-white/55 tabular-nums">
          {done}/{total}
        </span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
      </div>
    </div>
  );
}

function RowButton({ label, title, onClick, children }: { label: string; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-white/65 hover:bg-white/15 hover:text-white [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/**
 * 3D models (`server/model-search.ts`): Poly Pizza's (low-poly, mostly CC0: Quaternius's animated characters and
 * animals) or Sketchfab's (free to download, under Creative Commons), searched as typed, those that move marked;
 * before anything's typed, the starter pack. Each comes into the set in use with its credit, and is shown next.
 */
function Models() {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<ModelSource>("poly-pizza");
  const [animated, setAnimated] = useState(false);
  const [status, setStatus] = useState<ModelSearchStatus | null>(null);
  // Searched again once a key's saved.
  const [generation, setGeneration] = useState(0);
  const sets = useVisualizerMedia((s) => s.sets);
  const media = useVisualizerMedia((s) => s.media);
  const adding = useVisualizerMedia((s) => s.modelsAdding);
  const starter = useVisualizerMedia((s) => s.starter);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    api.getModelSearch().then(setStatus, () => {});
  }, []);
  const site = status?.sources.find((s) => s.source === source);
  const search = useModelSearch(site?.searchable === false ? "" : query, source, animated, generation);
  // What's in any set already (by where it came from: the starter pack's left to add), and in the one in use (its item).
  const have = useMemo(() => new Set(sets.flatMap((s) => s.media.map((m) => m.asset.origin))), [sets]);
  const here = useMemo(() => new Map(media.map((m) => [m.asset.origin, m.itemId])), [media]);
  const results = search.status === "loading" || search.status === "done" ? search.results : [];
  const end = useEndOfList(search.loadMore, search.status === "done" && search.more && !search.loadingMore && !search.moreError, results.length);
  const needsKey = site && (!site.searchable || !site.downloadable);
  const starters = STARTER_MODELS.filter((m) => !animated || m.animated);
  const starterLeft = STARTER_MODELS.filter((m) => !have.has(modelOrigin(m.source, m.id))).length;
  const card = (result: ModelResult) => {
    const origin = modelOrigin(result.source, result.id);
    const itemId = here.get(origin);
    return (
      <ModelCard
        key={origin}
        result={result}
        adding={!!adding[origin]}
        added={!!itemId}
        onClick={() => (itemId ? void useVisualizerMedia.getState().remove(itemId) : void useVisualizerMedia.getState().addModel(result))}
      />
    );
  };
  return (
    <>
      <div className="mb-2 flex items-center gap-1">
        <div role="radiogroup" aria-label="Where to search" className="flex flex-1 gap-1">
          {MODEL_SOURCES.map((s) => (
            <Chip key={s} role="radio" on={s === source} onClick={() => setSource(s)}>
              {MODEL_SITES[s].name}
            </Chip>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={animated}
          title="Only models that move (characters and animals, dancing, flying, running)"
          onClick={() => setAnimated((a) => !a)}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-2 text-[11px] ring-1 ring-white/15 [&_svg]:size-3",
            animated ? "bg-white text-black" : "bg-white/5 text-white/75 hover:bg-white/10",
          )}
        >
          <PiPersonSimpleRun />
          Animated
        </button>
      </div>
      <div className="relative mb-3">
        <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/50" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${MODEL_SITES[source].name}: a robot, a donut, a cat…`}
          aria-label="Search for 3D models"
          spellCheck={false}
          className="h-8 w-full rounded-md bg-white/10 pr-8 pl-8 text-[13px] text-white ring-1 ring-white/15 outline-none placeholder:text-white/40 focus:ring-white/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {search.status === "loading" ? (
          <PiSpinnerGap className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-white/60" />
        ) : (
          query && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-white/50 hover:text-white"
            >
              <PiXCircleFill className="size-4" />
            </button>
          )
        )}
      </div>
      {needsKey && site && (
        <KeyField
          source={source}
          why={site.searchable ? "to download its models" : "to search"}
          onSaved={(next) => {
            setStatus(next);
            setGeneration((g) => g + 1);
          }}
        />
      )}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {!query.trim() || site?.searchable === false ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <p className="mr-auto text-[11px] text-white/55">
                The starter pack <span className="text-white/35">· free, CC licensed</span>
              </p>
              {starter ? (
                <span className="flex items-center gap-1 text-[11px] text-white/60">
                  <PiSpinnerGap className="size-3 animate-spin" />
                  {starter.done}/{starter.total}
                </span>
              ) : (
                starterLeft > 0 && (
                  <button type="button" onClick={() => void useVisualizerMedia.getState().addStarter()} className="text-[11px] text-white/75 underline-offset-2 hover:text-white hover:underline">
                    Add all {starterLeft} as a set
                  </button>
                )
              )}
            </div>
            <ul aria-label="The starter pack" className="grid grid-cols-3 gap-1.5">
              {starters.map(card)}
            </ul>
          </>
        ) : search.status === "error" ? (
          <Hint>{search.message}</Hint>
        ) : search.status === "done" && results.length === 0 ? (
          <Hint>
            Nothing on {MODEL_SITES[source].name} matched “{query.trim()}”{animated ? " that moves" : ""}. Try other words
            {source === "poly-pizza" ? ", or Sketchfab" : ""}.
          </Hint>
        ) : (
          <ul aria-label="Results" aria-busy={search.status === "loading"} className={cn("grid grid-cols-3 gap-1.5 transition-opacity", search.status === "loading" && "opacity-60")}>
            {results.map(card)}
          </ul>
        )}
        {search.status === "done" && query.trim() && (search.more || search.moreError) && (
          <div ref={end} className="flex h-9 items-center justify-center gap-1.5 text-[11px] text-white/55">
            {search.moreError ? (
              <button type="button" className="underline hover:text-white" onClick={search.loadMore}>
                Couldn't load more: try again
              </button>
            ) : (
              <>
                <PiSpinnerGap className="size-3.5 animate-spin" />
                Loading more…
              </>
            )}
          </div>
        )}
        <p className="mt-3 text-[10.5px] leading-4 text-white/40">
          Each comes with its maker's name and licence, kept beside it. A .glb of your own goes in through Files.
        </p>
      </div>
    </>
  );
}

/**
 * One model: its picture, whether it moves, who made it. + puts it in the set in use; one in it already has a tick,
 * which turns into a cross on hover: clicked, it's taken out of the set (another set's are added again: a model can be in several).
 */
function ModelCard({ result, adding, added, onClick }: { result: ModelResult; adding: boolean; added: boolean; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  const label = adding ? `Adding ${result.title}…` : added ? `${result.title}: in this set (click to take it out)` : `Add ${result.title}`;
  return (
    <li data-model={modelOrigin(result.source, result.id)} className="group relative min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={added}
        title={`${result.title} by ${result.author} (${result.licence})${added ? ": in this set, click to take it out" : ""}`}
        disabled={adding}
        onClick={onClick}
        className={cn(
          "group/card block w-full overflow-hidden rounded-lg bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.2),rgba(255,255,255,0.03)_72%)] text-left ring-1 transition hover:ring-white/50 disabled:cursor-default",
          added ? "ring-white/60" : "ring-white/10",
        )}
      >
        <span className="relative block aspect-square">
          {result.thumbnail && !broken ? (
            <img
              src={result.thumbnail}
              alt=""
              loading="lazy"
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              className="size-full object-contain p-1 transition-transform duration-300 group-hover:scale-110"
            />
          ) : (
            <span className="grid size-full place-items-center text-white/30">
              <PiCube className="size-6" />
            </span>
          )}
          {result.animated && (
            <span title="Animated" className="absolute top-1 left-1 flex items-center gap-0.5 rounded bg-black/65 px-1 py-px text-[9px] font-medium text-white [&_svg]:size-2.5">
              <PiPersonSimpleRun />
              Moves
            </span>
          )}
          <span
            className={cn(
              "absolute right-1 bottom-1 grid size-6 place-items-center rounded-full shadow-lg [&_svg]:size-3.5",
              added ? "bg-white text-black group-hover/card:bg-red-500 group-hover/card:text-white" : adding ? "bg-black/70 text-white" : "bg-black/70 text-white opacity-0 group-hover:opacity-100",
            )}
          >
            {adding ? (
              <PiSpinnerGap className="animate-spin" />
            ) : added ? (
              <>
                <PiCheck className="group-hover/card:hidden" />
                <PiX className="hidden group-hover/card:block" />
              </>
            ) : (
              <PiPlus />
            )}
          </span>
        </span>
        <span className="block px-1.5 pt-1 pb-1.5">
          <span className="block truncate text-[11px] leading-4 text-white/90">{result.title}</span>
          <span className="block truncate text-[9.5px] leading-3 text-white/45">{result.author}</span>
        </span>
      </button>
    </li>
  );
}

/** A site's key, pasted in: kept by the server (never sent back), searched with at once. */
function KeyField({ source, why, onSaved }: { source: ModelSource; why: string; onSaved: (status: ModelSearchStatus) => void }) {
  const site = MODEL_SITES[source];
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      data-model-key
      className="mb-3 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/15"
      onSubmit={(e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setSaving(true);
        api.setModelKey(source, key.trim()).then(
          (status) => {
            setSaving(false);
            setKey("");
            setError(null);
            onSaved(status);
          },
          (err) => {
            setSaving(false);
            setError(errorMessage(err));
          },
        );
      }}
    >
      <p className="mb-2 flex items-center gap-1.5 text-[11px] leading-4 text-white/75 [&_svg]:size-3.5">
        <PiKey className="shrink-0" />
        <span>
          {site.name} needs your {site.keyName} {why} (free).{" "}
          <a href={site.keyPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-white underline-offset-2 hover:underline [&_svg]:size-3">
            Get one
            <PiArrowSquareOut />
          </a>
        </span>
      </p>
      <div className="flex gap-1">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`Paste your ${site.keyName}`}
          aria-label={`${site.name}'s ${site.keyName}`}
          spellCheck={false}
          autoComplete="off"
          className="h-7 min-w-0 flex-1 rounded bg-white/10 px-2 font-mono text-[11px] text-white ring-1 ring-white/20 outline-none placeholder:font-sans placeholder:text-white/35 focus:ring-white/50"
        />
        <button type="submit" disabled={saving || !key.trim()} className="h-7 rounded bg-white px-2.5 text-[11px] font-medium text-black disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </form>
  );
}

/**
 * The sets of clips (the Visualizer folder's folders: friends for a music video, nature for another vibe...): the one
 * in use marked, another picked, a new one made (what's added goes in it), the one in use renamed or deleted.
 */
function Sets() {
  const sets = useVisualizerMedia((s) => s.sets);
  const setId = useVisualizerMedia((s) => s.setId);
  const loaded = useVisualizerMedia((s) => s.loaded);
  // Naming a new set (null) or the one in use (its id).
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const current = sets.find((s) => s.id === setId);
  useEffect(() => setDeleting(false), [setId]);
  if (!loaded) return null;
  const store = useVisualizerMedia.getState();
  return (
    <div data-media-sets className="mb-3">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-white/55">
        <span className="mr-auto">Sets{sets.length > 1 ? " (K the next)" : ""}</span>
        {current && !naming && (
          <>
            <IconButton label={`Rename ${current.name}`} onClick={() => setNaming({ id: current.id, name: current.name })}>
              <PiPencilSimple />
            </IconButton>
            <IconButton label={`Delete ${current.name}`} onClick={() => setDeleting((d) => !d)}>
              <PiTrash />
            </IconButton>
          </>
        )}
      </div>
      {naming ? (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = naming.name.trim();
            setNaming(null);
            if (!name) return;
            if (naming.id) void store.renameSet(naming.id, name);
            else void store.createSet(name);
          }}
        >
          <input
            autoFocus
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
            onFocus={(e) => e.target.select()}
            // Escape (the visualizer blurs the field) or a click away: as it was.
            onBlur={() => setNaming(null)}
            aria-label={naming.id ? "The set's name" : "The new set's name"}
            spellCheck={false}
            className="h-7 min-w-0 flex-1 rounded bg-white/10 px-2 text-[12px] text-white ring-1 ring-white/25 outline-none focus:ring-white/50"
          />
          <button
            type="submit"
            aria-label={naming.id ? "Rename it" : "Make it"}
            onMouseDown={(e) => e.preventDefault()}
            className="grid h-7 w-8 place-items-center rounded bg-white text-black [&_svg]:size-3.5"
          >
            <PiCheck />
          </button>
        </form>
      ) : (
        <div role="radiogroup" aria-label="Sets of clips" className="flex flex-wrap gap-1">
          {sets.map((s) => (
            <Chip key={s.id} role="radio" on={s.id === setId} onClick={() => store.useSet(s.id)} data-set={s.name}>
              {s.name}
              <span className="ml-1 opacity-55">{s.media.length}</span>
            </Chip>
          ))}
          <Chip on={false} label="A new set" onClick={() => setNaming({ id: null, name: newSetName(sets) })}>
            <PiPlus />
            {sets.length ? null : "New set"}
          </Chip>
        </div>
      )}
      {deleting && current && (
        <div data-deleting className="mt-2 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1.5 ring-1 ring-white/15">
          <span className="mr-auto min-w-0 truncate text-[11px] text-white/80">
            Delete {current.name}
            {current.media.length ? ` and its ${current.media.length} clip${current.media.length === 1 ? "" : "s"}` : ""}?
          </span>
          <Chip
            on
            onClick={() => {
              setDeleting(false);
              void store.deleteSet(current.id);
            }}
          >
            Delete
          </Chip>
          <Chip on={false} onClick={() => setDeleting(false)}>
            Keep
          </Chip>
        </div>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  role,
  label,
  children,
  ...data
}: {
  on: boolean;
  onClick: () => void;
  role?: "radio";
  label?: string;
  children: React.ReactNode;
  "data-set"?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? on : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
      {...data}
      className={cn(
        "flex h-6 max-w-full items-center gap-1 truncate rounded px-2 text-[11px] ring-1 ring-white/15 [&_svg]:size-3",
        on ? "bg-white text-black" : "bg-white/5 text-white/75 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-5 place-items-center rounded text-white/60 hover:bg-white/10 hover:text-white [&_svg]:size-3">
      {children}
    </button>
  );
}

/**
 * Found online (the video editor's Online search: YouTube, or a link from TikTok, Instagram, X…): each result's
 * picture downloaded into the folder (no sound, up to 720p; a long video's first minutes), its progress where its +
 * was, shown in the look as soon as it's in.
 */
function Online({ onAdded }: { onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const search = useWebSearch(query);
  const downloads = useVisualizerMedia((s) => s.downloads);
  const fromWeb = useVisualizerMedia((s) => s.fromWeb);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const clips = search.status === "loading" || search.status === "done" ? search.clips : [];
  const loading = search.status === "loading";
  const end = useEndOfList(search.loadMore, search.status === "done" && search.more && !search.loadingMore && !search.moreError, clips.length);
  return (
    <>
      <div className="relative mb-3">
        <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/50" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube or paste a link"
          aria-label="Search YouTube or paste a link"
          spellCheck={false}
          className="h-8 w-full rounded-md bg-white/10 pr-8 pl-8 text-[13px] text-white ring-1 ring-white/15 outline-none placeholder:text-white/40 focus:ring-white/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? (
          <PiSpinnerGap className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-white/60" />
        ) : (
          query && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-white/50 hover:text-white"
            >
              <PiXCircleFill className="size-4" />
            </button>
          )
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.status === "idle" && (
          <Hint>
            <PiGlobe className="mx-auto mb-2 size-5 text-white/70" />
            Search YouTube, or paste a link from YouTube, TikTok, Instagram, X and more. Its picture comes into the {MEDIA_FOLDER} folder (no sound, up to 720p;
            a video over {LONG_VIDEO / 60} minutes, its first {LONG_TAKES / 60}) and shows in the look as soon as it's in.
          </Hint>
        )}
        {search.status === "error" && <Hint>{search.link ? `Couldn't open that link: ${search.message}` : `The search failed: ${search.message}`}</Hint>}
        {search.status === "done" && clips.length === 0 && <Hint>Nothing matched “{search.query}”. Try other words, or paste a link.</Hint>}
        {clips.length > 0 && (
          <ul aria-label="Results" aria-busy={loading} className={cn("flex flex-col gap-0.5 transition-opacity", loading && "opacity-60")}>
            {clips.map((clip) => (
              <Result
                key={clip.url}
                clip={clip}
                download={clip.url in downloads ? (downloads[clip.url] ?? { status: "waiting", progress: null }) : null}
                added={clip.url in fromWeb}
                onAdd={() => {
                  void useVisualizerMedia
                    .getState()
                    .addOnline(clip)
                    .then(() => clip.url in useVisualizerMedia.getState().fromWeb && onAdded());
                }}
              />
            ))}
          </ul>
        )}
        {search.status === "done" && (search.more || search.moreError) && (
          <div ref={end} className="flex h-9 items-center justify-center gap-1.5 text-[11px] text-white/55">
            {search.moreError ? (
              <button type="button" className="underline hover:text-white" onClick={search.loadMore}>
                Couldn't load more: try again
              </button>
            ) : (
              <>
                <PiSpinnerGap className="size-3.5 animate-spin" />
                Loading more…
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Result({ clip, download, added, onAdd }: { clip: WebClip; download: WebDownloadProgress | null; added: boolean; onAdd: () => void }) {
  const [broken, setBroken] = useState(false);
  const adding = download !== null;
  const label = adding
    ? download.status === "downloading" && download.progress !== null
      ? `Downloading, ${Math.round(download.progress * 100)}%`
      : download.status === "processing"
        ? "Almost in…"
        : "Starting…"
    : added
      ? "In the visualizer"
      : "Into the visualizer";
  return (
    <li data-url={clip.url} className="flex min-w-0 items-center gap-2.5 rounded-md p-1 hover:bg-white/5">
      <span className="relative aspect-video w-16 shrink-0 overflow-hidden rounded bg-white/5">
        {clip.thumbnail && !broken && (
          <img src={clip.thumbnail} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] leading-4 text-white/90" title={clip.title}>
          {clip.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-white/50">
          {clip.site !== "YouTube" && clip.site !== clip.channel ? `${clip.site} · ` : ""}
          {clip.channel}
          {clip.duration > 0 && ` · ${formatDuration(clip.duration)}`}
        </span>
      </span>
      <button
        type="button"
        aria-label={`${label}: ${clip.title}`}
        title={label}
        disabled={adding}
        onClick={onAdd}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md text-white/75 hover:bg-white/10 hover:text-white disabled:pointer-events-none [&_svg]:size-4",
          added && "text-white",
        )}
      >
        {adding ? (
          download.status === "downloading" && download.progress !== null ? (
            <span className="font-mono text-[10px] tabular-nums">{Math.round(download.progress * 100)}</span>
          ) : (
            <PiSpinnerGap className="animate-spin" />
          )
        ) : added ? (
          <PiCheck />
        ) : (
          <PiPlus />
        )}
      </button>
    </li>
  );
}

/**
 * A screen or window in the looks (`screen.ts`): the desktop app's screens and windows to pick from (its own left out),
 * a browser's picker otherwise; the one shared, live, and Stop.
 */
function Screen() {
  const shared = useVisualizerScreen((s) => s.shared);
  const asking = useVisualizerScreen((s) => s.asking);
  const sources = useVisualizerScreen((s) => s.sources);
  const access = useVisualizerScreen((s) => s.access);
  const desktop = !!desktopScreens();
  // What's there, now and every few seconds while the panel shows it (windows open and close).
  useEffect(() => {
    if (!desktop) return;
    void useVisualizerScreen.getState().list();
    const t = setInterval(() => void useVisualizerScreen.getState().list(), 4000);
    return () => clearInterval(t);
  }, [desktop]);
  const share = (id?: string) => void useVisualizerScreen.getState().share(id);
  return (
    <div data-screen-panel className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
      <p className="mb-3 text-[11px] leading-4 text-white/55">
        A screen or another program's window (FL Studio as you work in it, a game...) in MilkDrop's looks, the music driving them: shown whole, flashing up on
        the kicks, its trails streaming off it. Your clips come in over it now and then, a few bars at a time (N brings one in now); G again
        stops it.
      </p>
      {shared && <Live />}
      {access && access !== "granted" && (
        <p data-screen-access className="mb-3 rounded-md bg-white/10 px-3 py-2 text-[11px] leading-4 text-white/80">
          macOS hasn't let YTStudio record the screen: allow it in System Settings › Privacy &amp; Security › Screen &amp; System Audio Recording, then open it
          again.
        </p>
      )}
      {desktop ? (
        sources === null ? (
          <Hint>
            <PiSpinnerGap className="mx-auto size-4 animate-spin" />
          </Hint>
        ) : sources.length === 0 ? (
          <Hint>No screens or windows to share.</Hint>
        ) : (
          <div role="list" aria-label="Screens and windows" className="grid grid-cols-2 gap-2">
            {sources.map((source) => {
              const on = shared?.sourceId === source.id;
              return (
                <button
                  key={source.id}
                  type="button"
                  role="listitem"
                  data-screen-source={source.id}
                  aria-pressed={on}
                  title={source.name}
                  disabled={asking}
                  onClick={() => (on ? useVisualizerScreen.getState().stop() : share(source.id))}
                  className={cn("min-w-0 rounded-md p-1 text-left ring-1 hover:bg-white/10 disabled:opacity-50", on ? "bg-white/15 ring-white" : "ring-white/10")}
                >
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt="" className="aspect-video w-full rounded bg-black object-contain" />
                  ) : (
                    <div className="grid aspect-video w-full place-items-center rounded bg-black text-white/40">
                      <PiMonitor className="size-5" />
                    </div>
                  )}
                  <span className="mt-1 block truncate text-[11px] text-white/80">{source.name}</span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="grid">
          <Button disabled={asking} onClick={() => share()}>
            <PiMonitor />
            {shared ? "Another screen or window…" : "Choose a screen or window…"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The one shared, as the looks get it, and Stop. */
function Live() {
  const shared = useVisualizerScreen((s) => s.shared)!;
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = shared.stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [shared.stream]);
  return (
    <div data-screen-shared className="mb-3 rounded-md bg-white/10 p-2 ring-1 ring-white/15">
      <video ref={video} muted playsInline className="aspect-video w-full rounded bg-black object-contain" />
      <div className="mt-2 flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-red-500" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{shared.name}</span>
        <button
          type="button"
          onClick={() => useVisualizerScreen.getState().stop()}
          className="h-6 rounded bg-white/10 px-2 text-[11px] text-white/85 ring-1 ring-white/15 hover:bg-white/15"
        >
          Stop sharing
        </button>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-white/5 px-3 py-4 text-center text-[12px] leading-5 text-white/60 ring-1 ring-white/10">{children}</p>;
}

function Button({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/10 text-[12px] text-white/85 ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
