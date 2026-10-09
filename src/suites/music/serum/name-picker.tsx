import { type ReactNode, useMemo, useState } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Every word of the query in the name, in any order and case. */
export function matchNames(options: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((o) => words.every((w) => o.toLowerCase().includes(w)));
}

/**
 * A searchable list of names in a popover, for a mod route's source or destination (`docs/serum/player.md` §3.4:
 * picked from a list, not a tree): type to narrow it, Enter takes the first.
 */
export function NamePicker({
  options,
  value,
  label,
  onPick,
  onOpen,
  children,
}: {
  /** Null while they're being asked for. */
  options: readonly string[] | null;
  value?: string | null;
  label: string;
  onPick: (name: string) => void;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => matchNames(options ?? [], query).slice(0, 400), [options, query]);
  const pick = (name: string) => {
    setOpen(false);
    if (name !== value) onPick(name);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          onOpen?.();
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 border-black/60 bg-[var(--serum-panel)] p-1.5 text-[var(--serum-text)]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Input
          autoFocus
          aria-label={`Find: ${label}`}
          placeholder="Type to find…"
          className="h-7 border-black/60 bg-[var(--serum-display)] text-xs text-[var(--serum-text)]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && shown.length) pick(shown[0]);
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <div role="listbox" aria-label={label} className="mt-1 max-h-64 overflow-y-auto">
          {options === null ? (
            <p className="p-2 text-[11px] text-[var(--serum-text-dim)]">Asking Serum…</p>
          ) : !shown.length ? (
            <p className="p-2 text-[11px] text-[var(--serum-text-dim)]">Nothing called that.</p>
          ) : (
            shown.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={name === value}
                className={cn("block w-full truncate rounded-sm px-2 py-1 text-left text-[12px]", name === value ? "bg-[var(--serum-row-on)] text-white" : "hover:bg-white/5")}
                onClick={() => pick(name)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
