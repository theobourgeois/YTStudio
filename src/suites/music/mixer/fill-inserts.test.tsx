// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addChannels } from "@shared/music/edits";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import type { MixerSetupResult } from "@shared/music/mixer-setup";
import { FillInsertsWindow } from "./fill-inserts";
import { musicApi } from "../api";

const state = vi.hoisted(() => ({ current: null as null | { projectId: string; history: { doc: MusicProject }; commit: (edit: (song: MusicProject) => MusicProject) => void } }));
vi.mock("../ui", () => ({ useMusicUi: { setState: vi.fn() }, useMusicWindows: { getState: () => ({ focus: vi.fn() }) } }));
vi.mock("../store", () => ({ useMusic: { getState: () => state.current } }));
vi.mock("../window", () => ({ MusicWindow: ({ children }: { children: ReactNode }) => <div>{children}</div>, centredOnDesktop: () => ({ x: 0, y: 0 }) }));
vi.mock("../api", () => ({ musicApi: { mixerSetupSettings: vi.fn(), classifyMixer: vi.fn(), mixerSetupEvidence: vi.fn(), setMixerSetupKey: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

let root: Root;
let host: HTMLDivElement;
let commit: ReturnType<typeof vi.fn<(edit: (song: MusicProject) => MusicProject) => void>>;
let result: MixerSetupResult;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const song = addChannels(createMusicProject("Review"), Array.from({ length: 4 }, (_, i) => ({ id: `chan_${i}`, name: `Sound ${i}`, sampleId: null })));
  commit = vi.fn();
  state.current = { projectId: "project_0123456789ab", history: { doc: song }, commit };
  result = { model: "jev-1.13.0", channels: song.channels.map((c) => ({ channelId: c.id, name: c.name, kind: c.kind, preset: null, category: null, filename: `${c.name}.wav`, supported: true, role: "instr", confidence: 1, source: "jev" })) };
  vi.mocked(musicApi.mixerSetupSettings).mockResolvedValue({ configured: true });
  vi.mocked(musicApi.classifyMixer).mockResolvedValue(result);
  vi.mocked(musicApi.mixerSetupEvidence).mockResolvedValue(result.channels);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const row = (i: number) => host.querySelector<HTMLElement>(`[data-grid-item="chan_${i}"]`)!;
const click = async (element: HTMLElement, modifiers = {}) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers })); });
const selected = () => [...host.querySelectorAll<HTMLElement>("[data-grid-item][aria-selected=true]")].map((e) => e.dataset.gridItem);
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;

it("reviews before applying, supports Cmd/Shift selection and bulk groups, and preserves corrections on reclassify", async () => {
  await act(async () => root.render(<FillInsertsWindow />));
  expect(commit).not.toHaveBeenCalled();
  expect(host.querySelector('input[type=password]')).toBeNull();
  await click(row(0)); await click(row(2), { metaKey: true });
  expect(selected()).toEqual(["chan_0", "chan_2"]);
  await click(host.querySelector('[aria-label="Make selected drums"]')!);
  expect(row(0).textContent).toContain("Drums"); expect(row(2).textContent).toContain("Drums");
  expect(row(1).textContent).toContain("Instruments");
  await click(row(3), { shiftKey: true });
  expect(selected()).toEqual(["chan_2", "chan_3"]);
  await click(host.querySelector('[aria-label="Make selected bass"]')!);
  await click(button("Reclassify"));
  expect(row(0).textContent).toContain("Drums"); expect(row(2).textContent).toContain("Bass");
  await click(button("Fill 4 inserts"));
  expect(commit).toHaveBeenCalledTimes(1);
  const applied = commit.mock.calls[0][0](state.current!.history.doc) as MusicProject;
  expect(applied.mixer.tracks.filter((t) => t.setupChannel).map((t) => t.setupRole)).toEqual(["instr", "bass", "bass", "drums"]);
});

it("selects unresolved sounds immediately and rejects a project changed before application", async () => {
  result.channels[1].role = "unknown";
  await act(async () => root.render(<FillInsertsWindow />));
  expect(selected()).toEqual(["chan_1"]);
  await click(host.querySelector('[aria-label="Make selected drums"]')!);
  state.current!.history.doc = { ...state.current!.history.doc, name: "Changed while reviewing" };
  await click(button("Fill 4 inserts"));
  expect(commit).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain("song changed");
});
