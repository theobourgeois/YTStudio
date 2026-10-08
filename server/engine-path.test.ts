import path from "node:path";
import { describe, expect, it } from "vitest";
import { engineArtifactName, engineExecutable } from "./engine-path.ts";

describe("JUCE engine artifacts", () => {
  it("resolves Windows executables and macOS bundle executables for the same resource directory", () => {
    expect(engineArtifactName("win32")).toBe("YTStudio Engine.exe");
    expect(engineExecutable("resources", "win32")).toBe(path.join("resources", "YTStudio Engine.exe"));
    expect(engineExecutable("resources", "darwin")).toBe(path.join("resources", "YTStudio Engine.app", "Contents", "MacOS", "YTStudio Engine"));
    expect(engineExecutable("resources", "linux")).toBe(path.join("resources", "YTStudio Engine"));
  });
});
