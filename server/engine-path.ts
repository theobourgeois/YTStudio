import path from "node:path";

/** JUCE's application artifact: a bundle on macOS, an executable elsewhere. */
export function engineArtifactName(platform = process.platform): string {
  return platform === "darwin" ? "YTStudio Engine.app" : platform === "win32" ? "YTStudio Engine.exe" : "YTStudio Engine";
}

export function engineExecutable(artifactDir: string, platform = process.platform): string {
  const artifact = path.join(artifactDir, engineArtifactName(platform));
  return platform === "darwin" ? path.join(artifact, "Contents", "MacOS", "YTStudio Engine") : artifact;
}
