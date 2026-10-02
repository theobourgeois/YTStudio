import { useState } from "react";
import { PiCaretLeft, PiCaretRight, PiTrash } from "react-icons/pi";
import { cn } from "cn";
import type { Channel } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePluginPresets } from "./plugin-presets";
import { useTransport } from "./transport";

/**
 * A plugin channel's settings (FL Studio's plugin wrapper, `docs/fl-studio/plugin-window.md`): the
 * plugin and its window, then its presets: its own programs (when it has several) and the user's,
 * saved from it for every song.
 */
export function PluginTab({ channel }: { channel: Channel }) {
  const id = channel.id;
  const loaded = useTransport((s) => s.channels.loaded.find((c) => c.channel === id) ?? null);
  const loading = useTransport((s) => s.channels.loading.includes(id));
  const failed = useTransport((s) => s.channels.failed.find((c) => c.channel === id)?.error ?? null);
  const { presets, run } = usePluginPresets("channel", id, loaded !== null);
  const [name, setName] = useState("");
  const plugin = channel.plugin;
  const save = () => {
    const wanted = name.trim() || presets?.preset || channel.name;
    void run({ action: "savePreset", name: wanted });
    setName("");
  };
  const step = (direction: -1 | 1) => {
    if (!presets?.programs.length) return;
    const count = presets.programs.length;
    void run({ action: "setProgram", index: (((presets.program + direction) % count) + count) % count });
  };

  return (
    <div className="flex flex-col gap-2.5 p-3" data-testid="plugin-tab">
      <section className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{plugin?.name ?? "No plugin"}</div>
          <div className={cn("truncate text-[11px]", failed ? "text-destructive" : "text-muted-foreground")}>
            {failed ?? (loading ? "Loading…" : loaded ? `${plugin?.format ?? ""}${loaded.latency ? ` · ${loaded.latency} samples late, compensated` : ""}` : "Not loaded")}
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={!loaded} onClick={() => useTransport.getState().showPlugin(id, !loaded?.editorOpen)}>
          {loaded?.editorOpen ? "Hide plugin" : "Show plugin"}
        </Button>
      </section>

      <section className="rounded-md border bg-muted/30" aria-label="Presets">
        <h3 className="border-b px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Presets</h3>
        <div className="flex flex-col gap-2 p-2.5">
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Its presets show once the plugin has loaded.</p>
          ) : (
            <>
              {presets && presets.programs.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-xs" aria-label="Previous program" onClick={() => step(-1)}>
                    <PiCaretLeft />
                  </Button>
                  <Select value={String(presets.program)} onValueChange={(value) => void run({ action: "setProgram", index: Number(value) })}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Program">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.programs.map((program, index) => (
                        <SelectItem key={index} value={String(index)}>
                          {program || `Program ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-xs" aria-label="Next program" onClick={() => step(1)}>
                    <PiCaretRight />
                  </Button>
                </div>
              )}
              {presets && presets.presets.length > 0 ? (
                <ul className="flex max-h-40 flex-col overflow-y-auto" aria-label="Your presets">
                  {presets.presets.map((preset) => (
                    <li key={preset} className="group flex items-center">
                      <button
                        type="button"
                        aria-current={preset === presets.preset || undefined}
                        className={cn("min-w-0 flex-1 truncate rounded-sm px-1.5 py-0.5 text-left text-[13px] hover:bg-accent/60", preset === presets.preset && "text-brand")}
                        title={`Load ${preset}`}
                        onClick={() => void run({ action: "loadPreset", name: preset })}
                      >
                        {preset}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${preset}`}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => void run({ action: "deletePreset", name: preset })}
                      >
                        <PiTrash />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Your presets for {plugin?.name ?? "it"} go here, in every song: name one and save it.</p>
              )}
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={presets?.preset || channel.name} aria-label="Preset name" className="h-7 text-[13px]" />
                <Button type="submit" variant="outline" size="sm">
                  Save preset
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
