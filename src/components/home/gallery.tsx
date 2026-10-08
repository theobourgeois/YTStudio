import type { ProjectSummary } from "@shared/types";
import { appIconUrl } from "@shared/app-icons";
import type { GallerySection } from "@/gallery/types";
import { NewTile, OpenTile } from "./home";
import { LIST_COLUMNS, ProjectCard } from "./project-card";

const NOW = Date.now();
const base = { createdAt: NOW - 86_400_000, updatedAt: NOW - 3_600_000, openedAt: NOW - 3_600_000, duration: 12.5 };

/** Projects in the states a recent shows: with a picture, a song's Playlist, missing, damaged. */
const SAMPLES: ProjectSummary[] = [
  { ...base, id: "project_000000000001", suite: "video", name: "Launch teaser", path: "/Users/me/Documents/YTStudio/Launch teaser.yt", thumbnail: appIconUrl("banner-blue"), aspectRatio: "9:16", clipCount: 7 },
  { ...base, id: "project_000000000002", suite: "music", name: "Night drive beat", path: "/Users/me/Documents/YTStudio/Night drive beat.yt", thumbnail: null, tempo: 92, outline: {
    kind: "playlist", rows: 4, bars: 8,
    blocks: [[0, 0, 250, 0], [0, 250, 250, 0], [0, 500, 250, 0], [0, 750, 250, 0], [1, 250, 500, 1], [2, 500, 250, 2], [2, 750, 250, 2], [3, 0, 1000, 3]],
    styles: [{ kind: "pattern", color: null }, { kind: "pattern", color: "#4f9c6c" }, { kind: "pattern", color: "#c27a35" }, { kind: "automation", color: null }],
  }, updatedAt: NOW - 172_800_000, openedAt: NOW - 172_800_000 },
  { ...base, id: "project_000000000003", suite: "video", name: "Old vlog", path: "/Volumes/Backup/Old vlog.yt", thumbnail: null, aspectRatio: "16:9", clipCount: 3, missing: true },
  { ...base, id: "project_000000000004", suite: "music", name: "Demo", path: "/Users/me/Documents/YTStudio/Demo.yt", thumbnail: null, tempo: 120, damaged: "\"Demo\" can't be opened: its document (project.json) is damaged: it isn't valid JSON. Nothing in it was changed." },
];

function HomeParts() {
  return (
    <div className="flex flex-col gap-5 bg-surface-1 p-4">
      <div className="flex w-60 flex-col gap-1.5 bg-surface-0 p-3.5">
        <NewTile suite="video" index={0} />
        <NewTile suite="music" index={1} />
        <OpenTile />
      </div>
      <div role="list" className="flex flex-col">
        <div className={`${LIST_COLUMNS} px-2 py-2 text-[11px] font-semibold text-muted-foreground`}>
          <span /><span>Name</span><span>Kind</span><span>Details</span><span>Opened</span><span>Where</span><span />
        </div>
        {SAMPLES.map((p, i) => (
          <div role="listitem" key={p.id} data-gallery-target={i === 0 ? "row" : undefined}>
            <ProjectCard project={p} now={NOW} view="list" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3.5">
        {SAMPLES.map((p, i) => (
          <div key={p.id} data-gallery-target={i === 0 ? "card" : undefined}>
            <ProjectCard project={p} now={NOW} view="cards" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {SAMPLES.map((p) => (
          <ProjectCard key={p.id} project={p} now={NOW} view="sheet" />
        ))}
      </div>
    </div>
  );
}

export const HOME_SECTIONS: GallerySection[] = [
  {
    id: "home",
    title: "Home: New buttons, recents as a list, cards and a sheet",
    source: "components/home/",
    render: () => <HomeParts />,
    shots: [{ name: "card-menu", rightClick: "card" }],
  },
];
