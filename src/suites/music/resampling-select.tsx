import { RESAMPLING, RESAMPLING_NAMES, type Resampling } from "@shared/music/engine";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A choice of resampling method (Settings, and the export window). */
export function ResamplingSelect({ value, onChange, label }: { value: Resampling; onChange: (value: Resampling) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Resampling)}>
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RESAMPLING.map((method) => (
          <SelectItem key={method} value={method}>
            {RESAMPLING_NAMES[method]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
