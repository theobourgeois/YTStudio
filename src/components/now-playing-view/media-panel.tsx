import { useEffect, useRef, useState } from "react";
import { PiCheck, PiFilmStrip, PiGlobe, PiImage, PiMagnifyingGlass, PiPlus, PiShuffle, PiSpinnerGap, PiX, PiXCircleFill } from "react-icons/pi";
import { formatDuration } from "@shared/format";
import type { WebClip, WebDownloadProgress } from "@shared/types";
import { cn } from "cn";
import { useEndOfList, useWebSearch } from "@/components/media/use-web-search";
import { LONG_TAKES, LONG_VIDEO, MEDIA_FOLDER, useVisualizerMedia } from "./media-library";
import { useVisualizerPrefs } from "./prefs";

type Tab = "yours" | "online";

/**
 * The user's clips and pictures for the visualizer (docs/now-playing.md, "Your media"): what's in the Library's
 * Visualizer folder, the one in the look now marked; added from here (files, or found online: the video editor's Online
 * search, its picture downloaded into the folder) or dropped on the visualizer, taken out, turned on or off, another
 * one asked for.
 */
export function MediaPanel({ milkdrop }: { milkdrop: boolean }) {
  const [tab, setTab] = useState<Tab>("yours");
  const media = useVisualizerMedia((s) => s.media);
  const on = useVisualizerPrefs((s) => s.media);
  return (
    <div
      data-media-panel
      className="pointer-events-auto absolute top-16 right-4 bottom-36 flex w-80 flex-col rounded-lg bg-black/75 px-5 py-4 ring-1 ring-white/10 backdrop-blur-md"
    >
      <div role="tablist" aria-label="Your media" className="mb-3 grid grid-cols-2 gap-1">
        <Choice role="tab" on={tab === "yours"} onClick={() => setTab("yours")}>
          Yours{media.length ? ` (${media.length})` : ""}
        </Choice>
        <Choice role="tab" on={tab === "online"} onClick={() => setTab("online")}>
          Online
        </Choice>
      </div>
      {on && media.length > 0 && !milkdrop && (
        <p data-media-note className="mb-3 rounded-md bg-white/10 px-3 py-2 text-[11px] leading-4 text-white/80">
          This look isn't one of MilkDrop's, so it shows none: the next MilkDrop look will (↑ ↓ to MilkDrop, or the looks menu).
        </p>
      )}
      {tab === "yours" ? <Yours /> : <Online onAdded={() => setTab("yours")} />}
    </div>
  );
}

/** What's in the folder: on or off, each clip (the one in the look marked), add, another. */
function Yours() {
  const media = useVisualizerMedia((s) => s.media);
  const feeding = useVisualizerMedia((s) => s.feeding);
  const adding = useVisualizerMedia((s) => s.adding);
  const on = useVisualizerPrefs((s) => s.media);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <p className="mb-3 text-[11px] leading-4 text-white/55">
        Clips and pictures in MilkDrop's looks: shown in the look (a plain background, white or black or a colour, taken out), punching on the kicks, and
        painted into its feedback, so its trails stream off them. One at a time, another each look. Drop them anywhere on the visualizer, or find them
        online. They're kept in the Library's {MEDIA_FOLDER} folder.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-1">
        <Choice on={on} onClick={() => useVisualizerPrefs.getState().setMedia(true)}>
          In the looks
        </Choice>
        <Choice on={!on} onClick={() => useVisualizerPrefs.getState().setMedia(false)}>
          Off (⇧N)
        </Choice>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {media.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {media.map(({ itemId, asset }) => (
              <div
                key={itemId}
                data-media={asset.id}
                data-feeding={asset.id === feeding || undefined}
                title={asset.name}
                className={cn("group relative aspect-video overflow-hidden rounded bg-white/5 ring-1", asset.id === feeding ? "ring-white" : "ring-white/10")}
              >
                {(asset.poster ?? (asset.kind === "image" ? asset.src : null)) && (
                  <img src={asset.poster ?? asset.src} alt="" draggable={false} className="size-full object-cover" />
                )}
                <span className="absolute bottom-0.5 left-1 text-white/80 drop-shadow [&_svg]:size-3">{asset.kind === "video" ? <PiFilmStrip /> : <PiImage />}</span>
                <button
                  type="button"
                  aria-label={`Take ${asset.name} out`}
                  title="Take it out (it's deleted from the Library)"
                  onClick={() => void useVisualizerMedia.getState().remove(itemId)}
                  className="absolute top-0.5 right-0.5 hidden size-5 place-items-center rounded bg-black/70 text-white/85 group-hover:grid hover:bg-black [&_svg]:size-3"
                >
                  <PiX />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-white/5 px-3 py-4 text-center text-[12px] text-white/60 ring-1 ring-white/10">Nothing yet: add a few clips or pictures.</p>
        )}
      </div>
      {adding > 0 && <p className="mt-2 text-[11px] text-white/60">Adding {adding}…</p>}
      <div className="mt-3 grid grid-cols-2 gap-1">
        <Button onClick={() => input.current?.click()}>
          <PiPlus />
          Add files
        </Button>
        <Button disabled={!media.length || !on} onClick={() => useVisualizerPrefs.getState().requestNextMedia()}>
          <PiShuffle />
          Another (N)
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,image/*"
        aria-label="Add clips or pictures"
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

function Choice({ on, onClick, role, children }: { on: boolean; onClick: () => void; role?: "tab"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : on}
      aria-selected={role ? on : undefined}
      onClick={onClick}
      className={cn("h-7 rounded text-[11px] ring-1 ring-white/15", on ? "bg-white text-black" : "bg-white/5 text-white/75 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}
