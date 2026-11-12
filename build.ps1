# Builds ParticleCraft from this repository and writes:
#   Windows\ParticleCraft\   the ready-to-run folder
#   public\ParticleCraft-<version>-windows-x64.zip
# Needs Node.js 20+ and Rust (stable). Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Build-Web([string] $app) {
    Write-Host "== Building the $app interface" -ForegroundColor Cyan
    Push-Location (Join-Path $root $app)
    try {
        if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "$app web build failed" }
    } finally { Pop-Location }
}
function Build-Rust([string[]] $crates) {
    Write-Host '== Compiling the desktop program' -ForegroundColor Cyan
    $a = @('build', '--release'); foreach ($c in $crates) { $a += @('-p', $c) }
    & cargo @a
    if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
}
function Copy-Dir($from, $to) { if (Test-Path $from) { robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP | Out-Null } }
function Add-BlenderAddon([string] $dir) {
    $stage = Join-Path $env:TEMP 'craft_export_addon'
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force (Join-Path $stage 'craft_export') | Out-Null
    Copy-Item (Join-Path $root 'Blender\craft_export\*.py') (Join-Path $stage 'craft_export')
    $zip = Join-Path $dir 'CraftExport-Blender-addon.zip'
    if (Test-Path $zip) { Remove-Item $zip -Force }
    & "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage craft_export
    Remove-Item $stage -Recurse -Force
}
function Zip-App([string] $app, [string] $folder) {
    $conf = Get-Content (Join-Path $root "$app\src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
    $name = "$app-$($conf.version)-windows-x64"
    $stage = Join-Path $env:TEMP "$app-package"
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    $dir = Join-Path $stage $name
    New-Item -ItemType Directory -Force $dir | Out-Null
    robocopy $folder $dir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    Copy-Item (Join-Path $root "packaging\$app\*") $dir -Force
    foreach ($f in 'LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md') { Copy-Item (Join-Path $root $f) $dir -Force }
    $public = Join-Path $root 'public'
    New-Item -ItemType Directory -Force $public | Out-Null
    $zip = Join-Path $public "$name.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    & "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage $name
    if ($LASTEXITCODE -ne 0) { throw "Could not zip $name" }
    Remove-Item -Recurse -Force $stage
    "{0}  {1:N1} MB" -f $zip, ((Get-Item $zip).Length / 1MB)
}

Build-Web 'ParticleCraft'
Build-Rust @('particlecraft')
$out = Join-Path $root 'Windows\ParticleCraft'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root 'target\release\particlecraft.exe') (Join-Path $out 'ParticleCraft.exe') -Force
Copy-Dir (Join-Path $root 'GameCraft\asset-library\world') (Join-Path $out 'asset-library\world')
Add-BlenderAddon $out
Zip-App 'ParticleCraft' $out
