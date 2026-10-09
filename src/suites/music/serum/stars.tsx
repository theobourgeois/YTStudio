import { useState } from "react";
import { PiStar, PiStarFill } from "react-icons/pi";
import { cn } from "cn";

/**
 * Serum's stars for a preset, 0 to 5: a click sets them (on the stars it has, takes them away). The pointer over
 * them shows what a click would give. `quiet`: unrated ones show only while the row is hovered.
 */
export function Stars({ rating, onRate, size = 12, quiet = false, label }: { rating: number; onRate: (rating: number) => void; size?: number; quiet?: boolean; label: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating;
  return (
    <span
      role="group"
      aria-label={`${label}: ${rating ? `${rating} star${rating === 1 ? "" : "s"}` : "not rated"}`}
      className={cn("flex shrink-0 items-center", quiet && !rating && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}
      onPointerLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          aria-pressed={rating >= n}
          title={n === rating ? "Take the stars away" : `${n} star${n === 1 ? "" : "s"}`}
          className={cn("px-px", shown >= n ? "text-brand" : "text-muted-foreground/50 hover:text-muted-foreground")}
          onPointerEnter={() => setHover(n)}
          onClick={(e) => {
            // A row's click loads its preset: a star's doesn't.
            e.stopPropagation();
            onRate(n === rating ? 0 : n);
          }}
        >
          {shown >= n ? <PiStarFill style={{ width: size, height: size }} /> : <PiStar style={{ width: size, height: size }} />}
        </button>
      ))}
    </span>
  );
}
