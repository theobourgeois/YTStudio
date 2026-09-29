/**
 * Which engine turns speech into words, and setting it up right there: one
 * click installs the local one, a pasted key sets up a cloud one.
 */
import { useState, type FormEvent } from "react";
import { PiArrowSquareOut, PiCheckCircleFill, PiCloud, PiDesktop, PiSpinnerGap, PiWarningCircle } from "react-icons/pi";
import type { TranscriptionEngineId, TranscriptionEngineInfo } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "cn";
import { useCaptions } from "@/stores/captions";

export function EnginePicker({ value, onChange }: { value: TranscriptionEngineId; onChange: (id: TranscriptionEngineId) => void }) {
  const engines = useCaptions((s) => s.engines);
  const error = useCaptions((s) => s.enginesError);
  const selected = engines?.find((e) => e.id === value);

  if (!engines) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {error ? `Couldn't reach the editor server: ${error}` : <><PiSpinnerGap className="animate-spin" /> Checking what's set up…</>}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="Transcribe with" className="grid grid-cols-3 gap-1.5">
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={e.id === value}
            onClick={() => onChange(e.id)}
            className={cn(
              "flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-input px-2.5 text-left text-[13px] outline-none transition-colors",
              "hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
              e.id === value && "border-brand bg-brand/10 ring-1 ring-brand",
            )}
          >
            {e.kind === "local" ? <PiDesktop className="size-3.5 shrink-0 opacity-70" /> : <PiCloud className="size-3.5 shrink-0 opacity-70" />}
            <span className="min-w-0 flex-1 truncate font-medium">{e.label}</span>
            <StatusDot engine={e} />
          </button>
        ))}
      </div>
      {selected && <EngineDetails key={selected.id} engine={selected} />}
    </div>
  );
}

function StatusDot({ engine }: { engine: TranscriptionEngineInfo }) {
  if (engine.status === "ready") return <PiCheckCircleFill className="size-3.5 shrink-0 text-emerald-500" aria-label="Ready" />;
  if (engine.status === "installing") return <PiSpinnerGap className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Setting up" />;
  return <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Needs setting up" />;
}

function EngineDetails({ engine }: { engine: TranscriptionEngineInfo }) {
  return (
    <div className="grid gap-2 rounded-md bg-muted/60 px-3 py-2.5 text-xs">
      <p className="leading-relaxed text-muted-foreground">{engine.description}</p>
      {engine.kind === "local" ? <LocalSetup engine={engine} /> : <CloudSetup engine={engine} />}
    </div>
  );
}

function LocalSetup({ engine }: { engine: TranscriptionEngineInfo }) {
  const setUp = useCaptions((s) => s.setUpEngine);
  const [failed, setFailed] = useState<string | null>(null);
  if (engine.status === "ready") return null;
  if (engine.status === "installing") {
    return (
      <div className="grid gap-1.5">
        <p className="flex items-center gap-1.5 font-medium">
          <PiSpinnerGap className="animate-spin" />
          {engine.message}
          {engine.progress !== null && <span className="ml-auto font-normal text-muted-foreground tabular-nums">{Math.round(engine.progress * 100)}%</span>}
        </p>
        {engine.progress !== null && <Progress value={engine.progress * 100} className="h-1.5 [&>div]:bg-brand" />}
      </div>
    );
  }
  const start = () => {
    setFailed(null);
    setUp(engine.id).catch((err) => setFailed(errorMessage(err)));
  };
  return (
    <div className="flex items-center gap-3">
      <p className={cn("min-w-0 flex-1 leading-relaxed", engine.status === "error" ? "text-destructive" : "text-foreground")}>
        {failed ?? engine.message}
      </p>
      {engine.canSetUp && (
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" onClick={start}>
          {engine.status === "error" ? "Try again" : "Set up"}
        </Button>
      )}
    </div>
  );
}

function CloudSetup({ engine }: { engine: TranscriptionEngineInfo }) {
  const setUp = useCaptions((s) => s.setUpEngine);
  const forget = useCaptions((s) => s.forgetKey);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (engine.status === "ready") {
    if (engine.keyFromEnv) return <p className="text-muted-foreground">Using the API key from the environment.</p>;
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        API key saved on this computer.
        <button type="button" className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline" onClick={() => void forget(engine.id)}>
          Remove
        </button>
      </p>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await setUp(engine.id, key.trim());
      setKey("");
    } catch (err) {
      setFailed(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  // A form inside the dialog's form isn't allowed; this saves on Enter or the button.
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1.5">
        <Input
          type="password"
          aria-label={`${engine.label} API key`}
          placeholder={`Paste your ${engine.label} API key`}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save(e);
          }}
          className="h-8 bg-background text-xs"
        />
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" disabled={!key.trim() || busy} onClick={(e) => void save(e)}>
          {busy && <PiSpinnerGap className="animate-spin" />}
          Save
        </Button>
      </div>
      {failed && (
        <p className="flex items-center gap-1 text-destructive">
          <PiWarningCircle className="shrink-0" /> {failed}
        </p>
      )}
      {engine.keyUrl && (
        <a href={engine.keyUrl} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground">
          Get a key <PiArrowSquareOut />
        </a>
      )}
    </div>
  );
}
