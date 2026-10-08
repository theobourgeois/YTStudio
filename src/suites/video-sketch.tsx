import type { AspectRatio } from "@shared/types";

/** "9:16" as a number (width over height). */
export function aspectOf(ratio: AspectRatio): number {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
}

/** An empty video's Home card: its frame, dashed, at its shape (`aspect`: a vertical one stands up). */
export function EmptyFrame({ aspect }: { aspect: number }) {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center bg-sunken">
      <div
        className="rounded-[3px] border border-dashed border-muted-foreground/40"
        style={aspect < 1.6 ? { height: "72%", aspectRatio: aspect } : { width: "72%", aspectRatio: aspect }}
      />
    </div>
  );
}
