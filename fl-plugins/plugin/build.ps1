# Builds the YT-Mix and YT-Fill plugins and installs them (install.py): Common Files\VST3, each with its worker inside it.
#   powershell -ExecutionPolicy Bypass -File plugin\build.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vs = if (Test-Path -LiteralPath $vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
    if (-not $vs) { $vs = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools' }
    $devShell = Join-Path $vs 'Common7\Tools\Launch-VsDevShell.ps1'
    if (-not (Test-Path -LiteralPath $devShell)) { throw 'Install Visual Studio C++ Build Tools with a Windows SDK first.' }
    & $devShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
}

cmake -S $here -B "$here\build" -G Ninja -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build "$here\build" --parallel 8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$py = Join-Path $here '..\..\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $py)) { $py = 'python' }
& $py (Join-Path $here 'install.py')
exit $LASTEXITCODE
