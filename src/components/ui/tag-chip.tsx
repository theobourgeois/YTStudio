import { cn } from "cn";

/** A pill-shaped filter option; put a row of them in a `role="radiogroup"`. */
export function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-transparent bg-foreground text-background"
          : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
