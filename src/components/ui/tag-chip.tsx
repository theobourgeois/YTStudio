import { cn } from "cn";

/** A filter option, pushed in when it's the one chosen; put a row of them in a `role="radiogroup"`. */
export function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-sm px-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active ? "pressed text-brand" : "raised text-muted-foreground hover:raised-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
