/**
 * The project search (⌘P, and the Home screen's), pure: which projects match what's typed, best first. Every
 * word typed must be in the project's name (or its suite's); a name starting with the words, then one with a
 * word starting so, comes before one that only has them inside. Then the latest opened or saved first, and
 * the ones that aren't where they were last.
 */
import type { ProjectSummary } from "@shared/types";

const rank = (project: ProjectSummary, words: string[], suiteName: string): number | null => {
  const name = project.name.toLowerCase();
  const text = `${name} ${suiteName}`;
  if (!words.every((w) => text.includes(w))) return null;
  if (!words.length) return 0;
  const first = words[0];
  if (name.startsWith(first)) return 0;
  if (name.split(/[\s\-_.]+/).some((part) => part.startsWith(first))) return 1;
  return name.includes(first) ? 2 : 3;
};

const lastTouched = (p: ProjectSummary) => Math.max(p.openedAt, p.updatedAt);

/** The projects matching `query`, best first (`suiteName`: what each project's suite is called, searched too). */
export function searchProjects(projects: readonly ProjectSummary[], query: string, suiteName: (project: ProjectSummary) => string = () => ""): ProjectSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return projects
    .flatMap((project) => {
      const score = rank(project, words, suiteName(project).toLowerCase());
      return score === null ? [] : [{ project, score }];
    })
    .sort((a, b) => a.score - b.score || Number(!!a.project.missing) - Number(!!b.project.missing) || lastTouched(b.project) - lastTouched(a.project))
    .map((r) => r.project);
}
