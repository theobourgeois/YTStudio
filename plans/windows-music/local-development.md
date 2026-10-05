# Local development on Windows

Windows is the intended target of this plan. The browser UI can be developed before the native audio port is complete; music playback and recording need a working native engine. These instructions are provisional until verified during implementation.

## Prerequisites

- Node.js compatible with the repository dependencies, and pnpm. Node is already visible in this session; pnpm is not.
- FFmpeg and FFprobe on PATH for media processing and exports, or absolute `FFMPEG_PATH` and `FFPROBE_PATH` environment variables.
- For the native engine: Git, CMake, Visual Studio C++ build tools with a Windows SDK, and Ninja if using the repository's current `pnpm engine:build` script. Use a developer terminal with the compiler environment loaded for Ninja builds.
- Windows VST3 editions of any external plugins you want to use.

## Browser UI development now

After installing pnpm, open PowerShell in the repository:

```powershell
cd C:\Users\goali\code\editor
pnpm install
pnpm dev:server
```

In a second PowerShell terminal in the same folder:

```powershell
pnpm dev:web
```

Open the URL printed by Vite (normally http://localhost:5310). The server normally uses port 5311. Use matching `EDITOR_WEB_PORT` and `EDITOR_SERVER_PORT` values in both terminals if the defaults are occupied. These direct scripts avoid the combined launcher's unverified Windows child-process behavior. Startup itself still needs a smoke check on this machine.

Without the engine, expect music audio functionality to be unavailable. The default engine path currently points to a Mac app bundle.

## Native engine development

The existing build command is:

```powershell
pnpm engine:build
```

Do not assume it succeeds on Windows yet. Phase 3 will establish the supported compiler/configuration and executable path. Once a Windows engine has been built, set its actual absolute path before starting the server:

```powershell
$env:EDITOR_ENGINE_PATH = 'C:\absolute\path\to\Vaudio Engine.exe'
```

This is a placeholder path, not an existing binary. The plan will remove the need for this override in ordinary development.

## Desktop development after launcher fixes

```powershell
pnpm dev:desktop
```

This is the intended hot-reload desktop command. It has known Windows launch/path assumptions to fix before calling it supported. Run desktop mode separately from browser mode, since both start the server.

## Verification and packaging

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e music
pnpm build:desktop
pnpm package:desktop
```

Packaging commands become supported after the Windows engine/resource changes. Record the final executable and installer locations here once verified. The existing music window smoke script is macOS-oriented and needs a Windows counterpart.
