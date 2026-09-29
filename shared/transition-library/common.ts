/** Parameter specs shared by transitions in several library files. */
import type { ChoiceSpec } from "../params.ts";

const DIRECTIONS = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

/**
 * Where the motion goes. The shader reads it as an int (the option's index)
 * and turns it into a vector with the prelude's `dirVec`, so the options are
 * always in that order: all four, or just left and right (`horizontalOnly`).
 */
export function directionParam(defaultValue = "left", horizontalOnly = false): ChoiceSpec {
  return {
    kind: "choice",
    key: "direction",
    label: "Direction",
    default: defaultValue,
    options: horizontalOnly ? DIRECTIONS.slice(0, 2) : DIRECTIONS,
  };
}
