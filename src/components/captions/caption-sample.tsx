/** A caption style drawn by CSS at a small size, for the style pickers. */
import type { CSSProperties } from "react";
import type { CaptionStyle } from "@shared/captions";
import { APPEARANCE, TEXT } from "@shared/effects";
import { sanitizeParams } from "@shared/params";
import { cn } from "cn";
import { resolveFace } from "@/stores/fonts";

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS for text in a caption style, `px` tall. */
export function captionCss(style: CaptionStyle, px: number): CSSProperties {
  const t = sanitizeParams(TEXT.params, style.text);
  const a = sanitizeParams(APPEARANCE.params, style.appearance);
  const k = px / (t.size as number);
  const face = resolveFace(t.font as string, t.fontStyle as string);
  const css: CSSProperties = {
    fontFamily: `"${String(t.font).replace(/["\\]/g, "\\$&")}", sans-serif`,
    fontWeight: face.weight,
    fontStyle: face.italic ? "italic" : "normal",
    fontStretch: face.stretch,
    fontSize: px,
    lineHeight: 1.15,
    letterSpacing: `${(t.tracking as number) / 1000}em`,
    textTransform: t.textCase === "upper" ? "uppercase" : t.textCase === "lower" ? "lowercase" : "none",
    color: a.fill as string,
    whiteSpace: "nowrap",
  };
  const stroke = a.strokeWidth as number;
  if (stroke > 0) {
    css.WebkitTextStroke = `${Math.max(0.75, 2 * stroke * k)}px ${a.strokeColor}`;
    css.paintOrder = "stroke fill";
  }
  if ((a.shadow as number) > 0) {
    const d = (a.shadowDistance as number) * k * Math.SQRT1_2;
    css.textShadow = `${d}px ${d}px ${(a.shadowBlur as number) * k}px ${rgba(a.shadowColor as string, a.shadow as number)}`;
  }
  if ((a.background as number) > 0) {
    css.backgroundColor = rgba(a.backgroundColor as string, a.background as number);
    css.padding = "0.08em 0.3em";
    css.borderRadius = "0.15em";
  }
  return css;
}

/** A small "video frame" showing a caption style. */
export function CaptionSample({ style, text = "Caption", px = 20, className }: { style: CaptionStyle; text?: string; px?: number; className?: string }) {
  return (
    <span
      className={cn(
        "grid place-items-center overflow-hidden rounded-md bg-[linear-gradient(140deg,#4a5261_0%,#2a2f38_55%,#1c2027_100%)]",
        className,
      )}
    >
      <span style={captionCss(style, px)}>{text}</span>
    </span>
  );
}
