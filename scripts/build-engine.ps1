$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vsInstall = if (Test-Path -LiteralPath $vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
    if (-not $vsInstall) {
        $vsInstall = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools'
    }
    $devShell = Join-Path $vsInstall 'Common7\Tools\Launch-VsDevShell.ps1'
    if (-not (Test-Path -LiteralPath $devShell)) { throw 'Install Visual Studio C++ Build Tools with a Windows SDK, then run pnpm engine:build again.' }
    & $devShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
}

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
cmake -S engine -B engine/build -G Ninja -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build engine/build --parallel 8
exit $LASTEXITCODE
