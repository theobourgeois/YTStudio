/**
 * The project search (⌘P, and the Home screen's), pure: which projects match what's typed, best first. Every
 * word typed must be in the project's name (or its suite's); a name starting with the words, then one with a
 * word starting so, comes before one that only has them inside. Then the latest edited first, and
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

/** The projects matching `query`, best first (`suiteName`: what each project's suite is called, searched too). */
export function searchProjects(projects: readonly ProjectSummary[], query: string, suiteName: (project: ProjectSummary) => string = () => ""): ProjectSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return projects
    .flatMap((project) => {
      const score = rank(project, words, suiteName(project).toLowerCase());
      return score === null ? [] : [{ project, score }];
    })
    .sort((a, b) => a.score - b.score || Number(!!a.project.missing) - Number(!!b.project.missing) || b.project.updatedAt - a.project.updatedAt)
    .map((r) => r.project);
}

/** The sheet's groups: when each project was last edited, by calendar day (local time), the latest first. */
export type WhenGroup = "Today" | "Yesterday" | "This week" | "This month" | "Earlier";

/** Projects in their `WhenGroup`s, in the order given; groups with none are left out. */
export function groupByWhen<T extends ProjectSummary>(projects: readonly T[], now: number): { label: WhenGroup; projects: T[] }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groupOf = (then: number): WhenGroup => {
    if (then >= midnight.getTime()) return "Today";
    const daysAgo = Math.ceil((midnight.getTime() - then) / day);
    if (daysAgo <= 1) return "Yesterday";
    if (daysAgo < 7) return "This week";
    if (daysAgo < 31) return "This month";
    return "Earlier";
  };
  const order: WhenGroup[] = ["Today", "Yesterday", "This week", "This month", "Earlier"];
  const groups = new Map<WhenGroup, T[]>();
  for (const project of projects) {
    const label = groupOf(project.updatedAt);
    const group = groups.get(label);
    if (group) group.push(project);
    else groups.set(label, [project]);
  }
  return order.filter((label) => groups.has(label)).map((label) => ({ label, projects: groups.get(label)! }));
}
