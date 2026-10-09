import type { EngineChannelScope } from "@shared/music/engine";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { useSerumUi } from "./store";

/**
 * What each watched Serum channel sounded like last (`EngineChannelScope`, from the transport events), and when it
 * came: kept outside React, as the Reverb's tail is, for the player's display to draw at its own frame rate.
 */
const latest = new Map<string, { scope: EngineChannelScope; at: number }>();

/** The transport event's scopes (engine-sync.ts). */
export function takeScopes(scopes: Record<string, EngineChannelScope> | undefined) {
  if (!scopes) return;
  const now = performance.now();
  for (const [channel, scope] of Object.entries(scopes)) latest.set(channel, { scope, at: now });
}

/** A channel's last scope and when it came, or null if it hasn't sounded since its player opened. */
export const scopeOf = (channelId: string) => latest.get(channelId) ?? null;

let lastWatch = "";
/** Tell the engine which channels' sound to measure: the Serum players open. */
function syncWatch() {
  const channels = useSerumUi.getState().openIds;
  const key = JSON.stringify(channels);
  if (key === lastWatch) return;
  lastWatch = key;
  for (const channel of latest.keys()) if (!channels.includes(channel)) latest.delete(channel);
  void musicApi.engine("channelWatch", { channels }).catch(() => {
    lastWatch = "";
  });
}
/** A restarted engine watches nothing: told again. */
export function watchScopesAgain() {
  lastWatch = "";
  syncWatch();
}
useSerumUi.subscribe((state, prev) => {
  if (state.openIds !== prev.openIds) syncWatch();
});
// Another song (another engine song): told again.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    lastWatch = "";
    latest.clear();
  }
});
