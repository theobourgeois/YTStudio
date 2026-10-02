/**
 * Pro-C's side chain section (`docs/fabfilter/pro-c.md` 2.6, 8.3): the key's Level (and Audition, held),
 * the trigger (Internal, External: another mixer track, FL's way; Host Sync: pulses on the beat), Host
 * Sync's note, offset and length, the Stereo Link and its mode, and the side chain EQ filling the rest.
 * The Side Chain button that opens it glows when anything here is changed from its default.
 */
import { useMemo } from "react";
import { PiArrowLineRight, PiCaretDoubleDown, PiCaretDown, PiCaretDoubleUp, PiHeadphones, PiMusicNote, PiPlugsConnected, PiWarningFill } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { canSend } from "@shared/music/mixer";
import { setProCSidechain, sidechainConnected, updateProC } from "@shared/music/pro-c";
import { DEFAULT_PRO_C_SIDECHAIN } from "@shared/music/pro-c-presets";
import { PRO_C_LINK_MODES, PRO_C_SYNC_NOTES, type MusicProject, type ProC, type ProCLinkMode, type ProCTrigger } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMusic, useSong } from "../store";
import { audition, setProC } from "./actions";
import { Caption, SongBarSlider, SongCompKnob } from "./knob";
import { SidechainEq } from "./sidechain-eq";
import { controlProps } from "./specs";
import { useCompUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);

/** Whether the side chain does anything a default one wouldn't (its button glows): a trigger, a level, a link, bands. */
export function sidechainChanged(proC: ProC): boolean {
  const s = proC.sidechain;
  const d = DEFAULT_PRO_C_SIDECHAIN;
  return s.trigger !== d.trigger || s.level !== d.level || s.link !== d.link || s.bands.some((b) => b.enabled);
}

/** The Side Chain button, centred under the controls: shows or hides the section. */
export function SidechainToggle({ effectId, proC }: { effectId: string; proC: ProC }) {
  const open = proC.view.sidechain;
  const glow = sidechainChanged(proC);
  const trigger = proC.sidechain.trigger;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Hide the side chain" : "Show the side chain"}
      data-testid="pro-c-sidechain-toggle"
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] outline-none",
        glow ? "text-[var(--comp-arc)] [text-shadow:0_0_8px_var(--comp-arc)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]",
      )}
      onClick={() => setProC(effectId, { view: { sidechain: !open } })}
    >
      {open ? <PiCaretDoubleDown className="size-3" /> : <PiCaretDoubleUp className="size-3" />}
      SIDE CHAIN
      {trigger !== "internal" && <TriggerIcon trigger={trigger} className="size-3" />}
    </button>
  );
}

const TRIGGER_NAMES: Record<ProCTrigger, string> = { internal: "Internal", external: "External", sync: "Host Sync" };
function TriggerIcon({ trigger, className }: { trigger: ProCTrigger; className?: string }) {
  return trigger === "internal" ? <PiArrowLineRight className={className} /> : trigger === "external" ? <PiPlugsConnected className={className} /> : <PiMusicNote className={className} />;
}
const LINK_NAMES: Record<ProCLinkMode, string> = { mid: "MID", side: "SIDE", midToSide: "M>S", sideToMid: "S>M" };
const LINK_DETAILS: Record<ProCLinkMode, string> = {
  mid: "Mid: triggered by the mid, compresses the mid",
  side: "Side: triggered by the side, compresses the side",
  midToSide: "M>S: triggered by the mid, compresses the side",
  sideToMid: "S>M: triggered by the side, compresses the mid",
};

export function SidechainSection({ effectId, proC }: { effectId: string; proC: ProC }) {
  const s = proC.sidechain;
  const auditioning = useCompUi((u) => u.audition?.effectId === effectId && u.audition.mode === "key");
  const level = controlProps(effectId, proC, "sidechainLevel");
  const set = (sidechain: Parameters<typeof updateProC>[2]["sidechain"]) => setProC(effectId, { sidechain });
  return (
    <div className="flex h-[176px] shrink-0 border-t border-black/60 bg-[var(--comp-section)]" data-testid="pro-c-sidechain">
      {/* The key's level, and Audition held. */}
      <div className="flex w-[58px] shrink-0 flex-col items-center gap-1.5 py-2">
        <button
          type="button"
          aria-pressed={auditioning}
          aria-label="Audition the side chain"
          title="Audition: hold to hear what the detector hears (the key, through its EQ and link)"
          disabled={s.trigger === "sync"}
          className={cn("grid size-6 place-items-center rounded-full outline-none disabled:opacity-30", auditioning ? "bg-[var(--comp-arc)]/20 text-[var(--comp-arc)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            audition(effectId, "key");
            const up = () => {
              audition(effectId, null);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
            };
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
          }}
        >
          <PiHeadphones className="size-3.5" />
        </button>
        <SongBarSlider {...level} vertical length={96} label="Side Chain Level" testId="pro-c-knob-sidechain-level" />
        <Caption>Level</Caption>
      </div>

      {/* The trigger, and the Stereo Link. */}
      <div className="flex w-[150px] shrink-0 flex-col items-center gap-1 border-r border-black/40 py-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Trigger">
          {(["internal", "external", "sync"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={s.trigger === t}
              aria-label={TRIGGER_NAMES[t]}
              title={TRIGGER_NAMES[t]}
              className={cn("grid size-6 place-items-center rounded-sm outline-none", s.trigger === t ? "text-[var(--comp-arc)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
              onClick={() => set({ trigger: t })}
            >
              <TriggerIcon trigger={t} className="size-3.5" />
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[var(--comp-text)]">{TRIGGER_NAMES[s.trigger]}</span>
        <div className="mt-auto flex items-end gap-1">
          <span className="mb-4 text-[9px] text-[var(--comp-label)]">0%</span>
          <div className="relative">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] text-[var(--comp-label)]">100%</span>
            <SongCompKnob
              label="Stereo Link"
              size={38}
              value={s.link / 2}
              defaultValue={0.5}
              format={(f) => (f <= 0.5 ? `${Math.round(f * 200)}% linked` : `100% + ${Math.round((f - 0.5) * 200)}% ${LINK_NAMES[s.linkMode].toLowerCase()}`)}
              typed={(f) => String(Math.round(f * 200))}
              parse={(t) => (Number.isFinite(Number.parseFloat(t)) ? Number.parseFloat(t) / 200 : null)}
              testId="pro-c-knob-stereo-link"
              edit={(song, f) => updateProC(song, effectId, { sidechain: { link: Math.round(f * 200) / 100 } })}
              caption={<Caption className="text-[9.5px]">Stereo Link</Caption>}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Link mode: ${LINK_DETAILS[s.linkMode]}`} title={LINK_DETAILS[s.linkMode]} className="mb-4 rounded-[4px] border border-[var(--comp-knob-edge)] bg-black/30 px-1 py-px text-[9px] font-semibold text-[var(--comp-text)] outline-none hover:bg-black/50">
                {LINK_NAMES[s.linkMode]}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Past 100%, towards</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={s.linkMode} onValueChange={(linkMode) => set({ linkMode: linkMode as ProCLinkMode })}>
                {PRO_C_LINK_MODES.map((m) => (
                  <DropdownMenuRadioItem key={m} value={m}>
                    {LINK_DETAILS[m]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* What the trigger needs: the source track, or the pulse. */}
      {s.trigger !== "internal" && (
        <div className="flex w-[168px] shrink-0 flex-col gap-2 border-r border-black/40 px-3 py-2.5" data-testid="pro-c-trigger-panel">
          {s.trigger === "external" ? <ExternalSource effectId={effectId} proC={proC} /> : <HostSync effectId={effectId} proC={proC} />}
        </div>
      )}

      <SidechainEq effectId={effectId} bands={s.bands} />
    </div>
  );
}

/** External: the track whose sound is the key (those sending here first; another gets a 0% send, FL's "sidechain only"). */
function ExternalSource({ effectId, proC }: { effectId: string; proC: ProC }) {
  const mixer = useSong((s) => s.mixer);
  const connected = useSong((s) => sidechainConnected(s, effectId));
  const choices = useMemo(() => {
    const song = { mixer } as MusicProject;
    const own = mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId));
    const others = mixer.tracks.filter((t, i) => i > 0 && t !== own);
    const sending = others.filter((t) => own && t.sends.some((s) => s.to === own.id));
    const rest = others.filter((t) => !sending.includes(t));
    return {
      own: own?.id ?? "",
      sending: sending.map((t) => ({ id: t.id, name: mixerTrackName(song, t.id), possible: true })),
      rest: rest.map((t) => ({ id: t.id, name: mixerTrackName(song, t.id), possible: !!own && canSend(song as MusicProject, t.id, own.id) })),
    };
  }, [mixer, effectId]);
  const source = proC.sidechain.track;
  const name = source ? mixerTrackName({ mixer }, source) : null;
  const pick = (id: string | null) => commit((s) => setProCSidechain(s, effectId, id));
  return (
    <>
      <Caption className="mt-0 justify-start text-[var(--comp-label)]">Key from</Caption>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="pro-c-sidechain-source" className="flex h-6 w-full items-center justify-between rounded-[5px] border border-[var(--comp-knob-edge)] bg-black/35 px-2 text-left text-[11.5px] text-[var(--comp-text)] outline-none hover:bg-black/50">
            <span className="truncate">{name ?? "Choose a track…"}</span>
            <PiCaretDown className="size-2.5 shrink-0 text-[var(--comp-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Tracks sending here</DropdownMenuLabel>
          {choices.sending.length === 0 && <div className="px-2 py-1 text-[11px] text-muted-foreground">None yet</div>}
          {choices.sending.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => pick(t.id)}>
              {source === t.id ? "✓ " : ""}
              {t.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Other tracks (a 0% send is made)</DropdownMenuLabel>
          {choices.rest.map((t) => (
            <DropdownMenuItem key={t.id} disabled={!t.possible} onSelect={() => pick(t.id)} title={t.possible ? undefined : "It hears this track already: a send back would make a loop"}>
              {source === t.id ? "✓ " : ""}
              {t.name}
            </DropdownMenuItem>
          ))}
          {source && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pick(null)}>No source</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {source && !connected && (
        <div className="flex items-start gap-1 text-[10.5px] leading-tight text-[var(--comp-ring-hot)]" data-testid="pro-c-sidechain-warning">
          <PiWarningFill className="mt-px size-3 shrink-0" />
          <span>
            {name} doesn't send here.{" "}
            <button type="button" className="underline outline-none hover:text-[var(--comp-text)]" onClick={() => pick(source)}>
              Send
            </button>
          </span>
        </div>
      )}
      {!source && <p className="text-[10.5px] leading-tight text-[var(--comp-label)]">Its sound (after its fader) is what triggers the compression: a kick to duck a bass.</p>}
    </>
  );
}

/** Host Sync: a pulse on the song's beat, a note value long, scaled for dotted and triplet feels. */
function HostSync({ effectId, proC }: { effectId: string; proC: ProC }) {
  const sync = proC.sidechain.sync;
  const set = (patch: Partial<typeof sync>) => setProC(effectId, { sidechain: { sync: patch } });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Sync note" className="flex items-center gap-1.5 text-[12px] text-[var(--comp-text)] outline-none hover:text-white">
            <PiMusicNote className="size-3.5 text-[var(--comp-label)]" /> 1/{sync.note} Note
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={String(sync.note)} onValueChange={(note) => set({ note: Number(note) as typeof sync.note })}>
            {PRO_C_SYNC_NOTES.map((n) => (
              <DropdownMenuRadioItem key={n} value={String(n)}>
                1/{n} Note
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex flex-col items-center gap-0.5">
        <SongBarSlider
          label="Offset"
          length={140}
          value={(sync.offset - 0.5) / 1.5}
          defaultValue={1 / 3}
          format={(f) => `${Math.round((0.5 + f * 1.5) * 100)}%`}
          typed={(f) => String(Math.round((0.5 + f * 1.5) * 100))}
          parse={(t) => (Number.isFinite(Number.parseFloat(t)) ? (Number.parseFloat(t) / 100 - 0.5) / 1.5 : null)}
          edit={(s, f) => updateProC(s, effectId, { sidechain: { sync: { offset: Math.round((0.5 + f * 1.5) * 100) / 100 } } })}
        />
        <Caption>Offset</Caption>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <SongBarSlider
          label="Length"
          length={140}
          value={(sync.length - 0.05) / 0.95}
          defaultValue={(0.5 - 0.05) / 0.95}
          format={(f) => `${Math.round((0.05 + f * 0.95) * 100)}%`}
          typed={(f) => String(Math.round((0.05 + f * 0.95) * 100))}
          parse={(t) => (Number.isFinite(Number.parseFloat(t)) ? (Number.parseFloat(t) / 100 - 0.05) / 0.95 : null)}
          edit={(s, f) => updateProC(s, effectId, { sidechain: { sync: { length: Math.round((0.05 + f * 0.95) * 100) / 100 } } })}
        />
        <Caption>Length</Caption>
      </div>
    </>
  );
}
