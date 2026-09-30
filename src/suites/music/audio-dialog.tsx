import { useEffect, useState } from "react";
import { PiSpeakerHigh } from "react-icons/pi";
import { errorMessage } from "@shared/errors";
import type { EngineDevices, SetDeviceRequest } from "@shared/music/engine";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { musicApi } from "./api";
import { EnginePanel } from "./engine-panel";
import { useTransport } from "./transport";

/** Audio settings: the output device and its buffer, and the plugin bench (scan, load, play a plugin). */
export function AudioDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Audio settings" title="Audio settings">
          <PiSpeakerHigh />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audio engine</DialogTitle>
          <DialogDescription>Where the sound goes, and your plugins on a test bench.</DialogDescription>
        </DialogHeader>
        {open && (
          <div className="flex flex-col gap-4">
            <DeviceSettings />
            <EnginePanel />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeviceSettings() {
  const [devices, setDevices] = useState<EngineDevices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    musicApi.devices().then(setDevices, (err) => setError(errorMessage(err)));
  }, []);

  const change = async (body: SetDeviceRequest) => {
    try {
      const next = await musicApi.setDevice(body);
      setDevices(next);
      setError(null);
      useTransport.setState({ latencyMs: next.status.outputLatencyMs });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!devices) return error ? <p className="text-sm text-destructive">{error}</p> : null;
  const { status } = devices;
  // Core Audio offers every size in steps of 32: the powers of two are the ones anyone picks.
  const bufferSizes = devices.bufferSizes.filter((size) => (size & (size - 1)) === 0 || size === status.bufferSize);
  const bufferMs = status.sampleRate > 0 ? (status.bufferSize / status.sampleRate) * 1000 : 0;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="device-settings">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3">
        <div className="grid gap-1.5">
          <Label>Output</Label>
          <Select value={devices.output ?? ""} onValueChange={(output) => void change({ output })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Output device">
              <SelectValue placeholder="No output device" />
            </SelectTrigger>
            <SelectContent>
              {devices.outputs.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Buffer</Label>
          <Select value={String(status.bufferSize)} onValueChange={(size) => void change({ bufferSize: Number(size) })}>
            <SelectTrigger size="sm" className="w-32" aria-label="Buffer size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bufferSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} samples
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Sample rate</Label>
          <Select value={String(status.sampleRate)} onValueChange={(rate) => void change({ sampleRate: Number(rate) })}>
            <SelectTrigger size="sm" className="w-28" aria-label="Sample rate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {devices.sampleRates.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate / 1000} kHz
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A smaller buffer answers faster but works the computer harder: {bufferMs.toFixed(1)} ms of buffer, {status.outputLatencyMs.toFixed(0)} ms until a sound is heard on this
        device.
      </p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
