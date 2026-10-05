import path from "node:path";

/** JUCE's application artifact: a bundle on macOS, an executable elsewhere. */
export function engineArtifactName(platform = process.platform): string {
  return platform === "darwin" ? "Vaudio Engine.app" : platform === "win32" ? "Vaudio Engine.exe" : "Vaudio Engine";
}

export function engineExecutable(artifactDir: string, platform = process.platform): string {
  const artifact = path.join(artifactDir, engineArtifactName(platform));
  return platform === "darwin" ? path.join(artifact, "Contents", "MacOS", "Vaudio Engine") : artifact;
}
