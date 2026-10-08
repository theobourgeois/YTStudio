import type { ProjectSummary } from "@shared/types";
import { appIconUrl } from "@shared/app-icons";
import type { GallerySection } from "@/gallery/types";
import { NewTile, OpenTile } from "./home";
import { ProjectCard } from "./project-card";

const NOW = Date.now();
const base = { createdAt: NOW - 86_400_000, updatedAt: NOW - 3_600_000, openedAt: NOW - 3_600_000, duration: 12.5 };

/** Projects in the states a card shows: with a picture, without one, missing, damaged. */
const SAMPLES: ProjectSummary[] = [
  { ...base, id: "project_000000000001", suite: "video", name: "Launch teaser", path: "/Users/me/Documents/YTStudio/Launch teaser.yt", thumbnail: appIconUrl("banner-blue"), aspectRatio: "9:16", clipCount: 7 },
  { ...base, id: "project_000000000002", suite: "music", name: "Night drive beat", path: "/Users/me/Documents/YTStudio/Night drive beat.yt", thumbnail: null, tempo: 92, updatedAt: NOW - 172_800_000, openedAt: NOW - 172_800_000 },
  { ...base, id: "project_000000000003", suite: "video", name: "Old vlog", path: "/Volumes/Backup/Old vlog.yt", thumbnail: null, aspectRatio: "16:9", clipCount: 3, missing: true },
  { ...base, id: "project_000000000004", suite: "music", name: "Demo", path: "/Users/me/Documents/YTStudio/Demo.yt", thumbnail: null, tempo: 120, damaged: "\"Demo\" can't be opened: its document (project.json) is damaged: it isn't valid JSON. Nothing in it was changed." },
];

function HomeParts() {
  return (
    <div className="flex flex-col gap-5 bg-surface-0 p-4">
      <div className="grid grid-cols-3 gap-3">
        <NewTile suite="video" index={0} />
        <NewTile suite="music" index={1} />
        <OpenTile />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {SAMPLES.map((p, i) => (
          <div key={p.id} data-gallery-target={i === 0 ? "card" : undefined}>
            <ProjectCard project={p} now={NOW} />
          </div>
        ))}
      </div>
    </div>
  );
}

export const HOME_SECTIONS: GallerySection[] = [
  {
    id: "home",
    title: "Home: new tiles, project cards",
    source: "components/home/",
    render: () => <HomeParts />,
    shots: [{ name: "card-menu", rightClick: "card" }],
  },
];
