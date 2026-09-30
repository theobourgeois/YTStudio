import type { SVGProps } from "react";

/**
 * The Piano roll's tool icons, drawn after FL Studio's: bold glyphs, filled where FL's are (the brush,
 * the speakers, the knife's handle), in the text's colour so a pressed tool lights with the accent.
 * Their cursors (`cursors.ts`) are the same glyphs.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

/** A pencil, outlined, its point at the bottom right. */
export const DrawIcon = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 2.6 L17.4 14 L17.6 17.6 L14 17.4 L2.6 6 Z" />
    <path d="M14 17.4 L17.4 14" />
    <path d="M4.9 8.3 L8.3 4.9" />
  </Glyph>
);

/** A paint brush, filled: bristles up and left, a drip below, the handle down to the right. */
export const PaintIcon = (props: IconProps) => (
  <Glyph {...props} stroke="none" fill="currentColor">
    <path d="M2.2 2.2 Q7.5 2.4 10.6 5.3 L6.3 9.6 Q3.4 6.5 2.2 2.2 Z" />
    <path d="M11.4 6.1 L13.4 8.1 L8.1 13.4 L6.1 11.4 Z" />
    <path fillRule="evenodd" d="M11.3 12.5 L12.5 11.3 L17.4 15.4 Q18.9 16.9 17.9 17.9 Q16.9 18.9 15.4 17.4 Z M16.4 16.4 m-0.8 0 a0.8 0.8 0 1 0 1.6 0 a0.8 0.8 0 1 0 -1.6 0 Z" />
    <path d="M3.4 10.2 Q4.8 12 4.8 13.1 Q4.8 14.4 3.4 14.4 Q2 14.4 2 13.1 Q2 12 3.4 10.2 Z" />
  </Glyph>
);

/** FL's delete tool: a circle struck through. */
export const DeleteIcon = (props: IconProps) => (
  <Glyph {...props} strokeWidth={2}>
    <circle cx="10" cy="10" r="7" />
    <path d="M5.1 14.9 L14.9 5.1" />
  </Glyph>
);

const SPEAKER = "M2.4 7.2 H5.6 L10.2 3.2 V16.8 L5.6 12.8 H2.4 Z";

/** A speaker, filled, with a cross: muting. */
export const MuteIcon = (props: IconProps) => (
  <Glyph {...props} strokeWidth={2}>
    <path d={SPEAKER} fill="currentColor" stroke="none" />
    <path d="M13 7.6 L17.6 12.2 M17.6 7.6 L13 12.2" />
  </Glyph>
);

/** A cleaver: the blade's edge down from the top left, the handle at the right with its rivet. */
export const SliceIcon = (props: IconProps) => (
  <Glyph {...props} stroke="none" fill="currentColor">
    <path d="M1.8 2.8 H10.2 V17.2 Z" />
    <path fillRule="evenodd" d="M11.6 2.8 H14.6 Q17.8 2.8 17.8 6 V14.4 Q17.8 17.2 14.6 17.2 H11.6 Z M14.6 7.6 m-1.1 0 a1.1 1.1 0 1 0 2.2 0 a1.1 1.1 0 1 0 -2.2 0 Z" />
  </Glyph>
);

/** Corner brackets: the selection. */
export const SelectIcon = (props: IconProps) => (
  <Glyph {...props} strokeWidth={2}>
    <path d="M3 7.4 V3 H7.4 M12.6 3 H17 V7.4 M17 12.6 V17 H12.6 M7.4 17 H3 V12.6" />
  </Glyph>
);

/** A speaker, filled, with two bars: playing what's under the pointer. */
export const PlaybackIcon = (props: IconProps) => (
  <Glyph {...props} strokeWidth={2}>
    <path d={SPEAKER} fill="currentColor" stroke="none" />
    <path d="M13.6 6.6 V13.4 M16.8 5 V15" />
  </Glyph>
);
