import type { EqShape } from "@shared/music/types";

/** Each shape's curve, drawn small (Pro-Q's shape button and menu): a path in a 16 by 12 box. */
const PATHS: Record<EqShape, string> = {
  bell: "M1 10 C5 10 6 2 8 2 C10 2 11 10 15 10",
  lowShelf: "M1 3 C5 3 7 3 8 6.5 C9 10 11 10 15 10",
  lowCut: "M2 11 C3 5 5 3 8 3 L15 3",
  highShelf: "M1 10 C5 10 7 10 8 6.5 C9 3 11 3 15 3",
  highCut: "M1 3 L8 3 C11 3 13 5 14 11",
  notch: "M1 3 L6 3 C7 3 7.5 11 8 11 C8.5 11 9 3 10 3 L15 3",
  bandPass: "M2 11 C5 11 6 3 8 3 C10 3 11 11 14 11",
  tiltShelf: "M1 9 C5 9 6 9 8 6.5 C10 4 11 4 15 4",
  flatTilt: "M1 10 L15 3",
};

export function ShapeIcon({ shape, className }: { shape: EqShape; className?: string }) {
  return (
    <svg viewBox="0 0 16 12" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[shape]} />
    </svg>
  );
}
