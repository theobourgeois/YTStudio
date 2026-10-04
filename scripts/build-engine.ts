import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (process.platform === "win32") {
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(import.meta.dirname, "build-engine.ps1")]);
} else {
  await run("cmake", ["-S", "engine", "-B", "engine/build", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"]);
  await run("cmake", ["--build", "engine/build"]);
}
