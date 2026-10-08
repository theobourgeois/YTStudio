import type { SuiteProjectSummary } from "@shared/types";

/**
 * A photo's Home card before its cover is rendered (a blank one has none): its canvas at its shape, the
 * transparency checkerboard Photoshop shows, so a card says what size the photo is rather than showing an icon.
 */
export function photoSketch(project: SuiteProjectSummary<"photo">) {
  const aspect = project.width > 0 && project.height > 0 ? project.width / project.height : 1;
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center bg-sunken">
      <div
        className="shadow-[0_0_0_1px_var(--line),0_4px_12px_-4px_rgb(0_0_0/0.5)] [background:repeating-conic-gradient(#d9dde2_0_25%,#ffffff_0_50%)_0_0/12px_12px] opacity-90"
        style={aspect < 1.6 ? { height: "78%", aspectRatio: aspect } : { width: "78%", aspectRatio: aspect }}
      />
    </div>
  );
}
