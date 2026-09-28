import { Stage } from "./stage";
import { Transport } from "./transport";

/** Centre column: the letterboxed canvas and the transport bar. */
export function Preview() {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-stage" aria-label="Preview">
      <Stage />
      <Transport />
    </section>
  );
}
