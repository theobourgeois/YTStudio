/** Isolated real-engine app for verifying assistant capture/render/measure and candidate playback. */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createApp } from "../server/app.ts";
import { createMusicProject } from "../shared/music/project.ts";
import { addAudioClips } from "../shared/music/playlist.ts";
import { addMixerTracks, updateMixerTrack } from "../shared/music/mixer.ts";
import type { MediaAsset } from "../shared/types.ts";

const root = path.resolve("data/vocal-mix-pilot");
const port = Number(process.env.EDITOR_SERVER_PORT || 56381);
const editor = await createApp({ dataDir: path.join(root, "app"),
  engine: { offline: true, onlyPluginPaths: true, pluginPaths: [] } });
const server = http.createServer(editor.app);
await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${port}`;
const request = async <T>(route: string, body?: unknown): Promise<T> => {
  const response = await fetch(url + route, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result as T;
};
const project = await request<{ id: string }>("/api/projects", { suite: "music", name: "Real vocal mix verification" });
const vocal = await request<MediaAsset>("/api/media/import-file", { projectId: project.id, path: path.join(root, "vocal.wav") });
const instrumental = await request<MediaAsset>("/api/media/import-file", { projectId: project.id, path: path.join(root, "instrumental.wav") });
let song = addAudioClips(addMixerTracks(createMusicProject("Real vocal mix verification", 120), null, 2, ["insert_vocal", "insert_instrumental"]),
  [{ channelId: "chan_realvocal", name: "Vocal", sampleId: vocal.id, seconds: 40 },
    { channelId: "chan_instrumental", name: "Instrumental", sampleId: instrumental.id, seconds: 40 }], { start: 0, track: 0 }).song;
song = { ...song, channels: song.channels.map(c => c.id === "chan_realvocal" ? { ...c, mixerTrack: "insert_vocal" } : c.id === "chan_instrumental" ? { ...c, mixerTrack: "insert_instrumental" } : c) };
song = updateMixerTrack(updateMixerTrack(song, "insert_vocal", { name: "Vocal" }), "insert_instrumental", { name: "Instrumental" });
const save = await fetch(`${url}/api/projects/${project.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) });
if (!save.ok) throw new Error(await save.text());
await fs.writeFile(path.join(root, "app-pilot.json"), JSON.stringify({ projectId: project.id, server: url, web: `http://localhost:${process.env.EDITOR_WEB_PORT || 56380}/p/${project.id}`, vocalMediaId: vocal.id, instrumentalMediaId: instrumental.id }, null, 2));
console.log(`Real audio ready: http://localhost:${process.env.EDITOR_WEB_PORT || 56380}/p/${project.id}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { editor.shutdown(); server.close(); server.closeAllConnections(); process.exit(0); });
