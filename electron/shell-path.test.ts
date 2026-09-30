import { describe, expect, it } from "vitest";
import { mergePaths, parseShellPath } from "./shell-path.ts";

describe("parseShellPath", () => {
  it("reads the PATH between the markers, ignoring what the shell prints around it", () => {
    expect(parseShellPath("Last login: today\n__EDITOR_PATH__/opt/homebrew/bin:/usr/bin__EDITOR_PATH__\nbye")).toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
  });

  it("gives null when the shell didn't print it", () => {
    expect(parseShellPath("")).toBeNull();
    expect(parseShellPath("__EDITOR_PATH__/usr/bin")).toBeNull();
    expect(parseShellPath("__EDITOR_PATH____EDITOR_PATH__")).toBeNull();
  });
});

describe("mergePaths", () => {
  it("keeps the first of each directory, in order, and expands ~", () => {
    expect(mergePaths(["/a:/b", null, "/usr/bin:/a::", "~/.local/bin"], "/Users/me")).toBe(
      "/a:/b:/usr/bin:/Users/me/.local/bin",
    );
  });
});
