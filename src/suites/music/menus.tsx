/**
 * The music editor's menus, in the tab strip (`SuiteMenuBar`): FL Studio's commands in the app's menus, Patterns
 * and Tools its own. Every item runs what its key does (`run`: the workspace's `runKey`), so the two never differ.
 */
import { createId } from "@shared/ids";
import { addPattern, clonePattern, nextPatternName } from "@shared/music/edits";
import { useShallow } from "zustand/react/shallow";
import { SuiteMenuBar } from "@/components/home/menu-bar";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { IS_MAC } from "@/lib/key-labels";
import { useBrowser } from "./browser/store";
import type { MusicKeyAction } from "./keys";
import { useMidi } from "./midi";
import { useMusicPreferences } from "./preferences";
import { useRecording } from "./recording";
import { useSongExport } from "./export/store";
import { useCurrentPattern, useMusic } from "./store";
import { useTransport } from "./transport";
import { useMusicUi } from "./ui";
import { useVisualizer } from "./visualizer/store";
import { useVocalMix } from "./vocal-mix/store";

/** The Edit menu's clipboard commands, on the window in front (the workspace's `runEdit`). */
export type MusicEdit = "cut" | "copy" | "paste" | "delete" | "selectAll";

const key = (mac: string, other: string) => (IS_MAC ? mac : other);

function newPattern() {
  const { commit, selectPattern, history } = useMusic.getState();
  const id = createId("pat");
  const name = nextPatternName(history!.doc);
  commit((song) => addPattern(song, { id, name }));
  selectPattern(id);
}

function clonePatternShown(patternId: string) {
  const { commit, selectPattern } = useMusic.getState();
  const id = createId("pat");
  commit((song) => clonePattern(song, patternId, id));
  selectPattern(id);
}

export function MusicMenus({ run, edit }: { run: (action: MusicKeyAction) => void; edit: (command: MusicEdit) => void }) {
  const canUndo = useMusic((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = useMusic((s) => (s.history?.future.length ?? 0) > 0);
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const mode = useTransport((s) => s.mode);
  const metronome = useTransport((s) => s.metronome);
  const recording = useRecording((s) => s.on);
  const typing = useMidi((s) => s.typing);
  const ui = useMusicUi(
    useShallow((s) => ({
      playlistOpen: s.playlistOpen,
      rackOpen: s.rackOpen,
      pianoOpen: s.pianoOpen,
      mixerOpen: s.mixerOpen,
      graphOpen: s.graphOpen,
      trackSelectorsShown: s.trackSelectorsShown,
    })),
  );
  const browser = useBrowser((s) => s.open);

  return (
    <SuiteMenuBar
      file={
        <>
          <DropdownMenuItem onSelect={() => void useSongExport.getState().begin()}>Export…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run({ type: "exportWav" })}>
            Export WAV… <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run({ type: "exportMp3" })}>
            Export MP3… <DropdownMenuShortcut>⇧⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useVisualizer.getState().open()}>Make Visualizer…</DropdownMenuItem>
        </>
      }
      edit={
        <>
          <DropdownMenuItem disabled={!canUndo} onSelect={() => run({ type: "undo" })}>
            Undo <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canRedo} onSelect={() => run({ type: "redo" })}>
            Redo <DropdownMenuShortcut>{key("⇧⌘Z", "Ctrl+Y")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => edit("cut")}>
            Cut <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => edit("copy")}>
            Copy <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => edit("paste")}>
            Paste <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => edit("delete")}>
            Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => edit("selectAll")}>
            Select All <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
          </DropdownMenuItem>
        </>
      }
      view={
        <>
          <DropdownMenuRadioGroup value={mode} onValueChange={(next) => next !== mode && run({ type: "toggleMode" })}>
            <DropdownMenuRadioItem value="pattern">
              Pattern Mode <DropdownMenuShortcut>L</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="song">
              Song Mode <DropdownMenuShortcut>L</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={metronome}
            onCheckedChange={(on) => useTransport.getState().setMetronome(on, useMusicPreferences.getState().metronomeSound)}
          >
            Metronome
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={typing} onCheckedChange={() => run({ type: "toggleTyping" })}>
            Typing Keyboard to Piano
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={ui.trackSelectorsShown} onCheckedChange={() => run({ type: "toggleTrackSelectors" })}>
            Track Selectors
          </DropdownMenuCheckboxItem>
        </>
      }
      menus={[
        {
          label: "Patterns",
          items: (
            <>
              <DropdownMenuItem onSelect={newPattern}>New Pattern</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => clonePatternShown(patternId)}>Clone Pattern</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => useMusic.getState().stepPattern(-1)}>Previous Pattern</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useMusic.getState().stepPattern(1)}>Next Pattern</DropdownMenuItem>
            </>
          ),
        },
        {
          label: "Tools",
          items: (
            <>
              <DropdownMenuCheckboxItem checked={recording} onCheckedChange={() => run({ type: "toggleRecord" })}>
                Record
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => run({ type: "assignFreeTracks" })}>Assign Free Mixer Tracks</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  const id = useMusic.getState().projectId;
                  if (id) useVocalMix.getState().show(id);
                }}
              >
                Vocal Mix Comparison…
              </DropdownMenuItem>
            </>
          ),
        },
      ]}
      window={
        <>
          <DropdownMenuCheckboxItem checked={ui.playlistOpen} onCheckedChange={() => run({ type: "togglePlaylist" })}>
            Playlist <DropdownMenuShortcut>{key("⌥1", "F5")}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={ui.rackOpen} onCheckedChange={() => run({ type: "toggleRack" })}>
            Channel Rack <DropdownMenuShortcut>{key("⌥2", "F6")}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={ui.pianoOpen} onCheckedChange={() => run({ type: "togglePiano" })}>
            Piano Roll <DropdownMenuShortcut>{key("⌥3", "F7")}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={ui.mixerOpen} onCheckedChange={() => run({ type: "toggleMixer" })}>
            Mixer <DropdownMenuShortcut>{key("⌥4", "F9")}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={browser} onCheckedChange={() => run({ type: "toggleBrowser" })}>
            Browser <DropdownMenuShortcut>{key("⌥5", "Alt+F8")}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={ui.graphOpen} onCheckedChange={() => run({ type: "toggleGraph" })}>
            Graph Editor
          </DropdownMenuCheckboxItem>
        </>
      }
    />
  );
}
