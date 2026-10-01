import { cn } from "cn";

/**
 * A light, FL Studio's mixer's: a grey bezel round a glossy lens, lit in the accent (`--mixer-led`) or
 * dark when off. Only its look: the button round it is its owner's.
 */
export function Led({ on, size = 11, className }: { on: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none relative inline-block shrink-0 rounded-full transition-[filter] group-hover:brightness-125", className)}
      style={{
        width: size,
        height: size,
        // The bezel.
        background: "linear-gradient(to bottom, var(--led-bezel-light), var(--led-bezel-dark))",
        boxShadow: "0 1px 1px rgb(0 0 0 / 0.4)",
      }}
    >
      <span
        className="absolute rounded-full"
        style={{
          inset: Math.max(1.5, size * 0.16),
          background: on
            ? "radial-gradient(circle at 50% 30%, color-mix(in oklab, var(--mixer-led) 35%, #fff) 0%, var(--mixer-led) 55%, color-mix(in oklab, var(--mixer-led) 60%, #000) 100%)"
            : "radial-gradient(circle at 50% 30%, var(--led-off-light) 0%, var(--led-off-dark) 100%)",
          boxShadow: on ? "0 0 4px var(--mixer-led), inset 0 0 0 0.5px rgb(0 0 0 / 0.5)" : "inset 0 1px 1px rgb(0 0 0 / 0.5)",
        }}
      >
        {/* Its gloss: a highlight across the top of the lens. */}
        <span className="absolute inset-x-[22%] top-[10%] h-[34%] rounded-full bg-white/45" />
      </span>
    </span>
  );
}
