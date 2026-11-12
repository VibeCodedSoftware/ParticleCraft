# Builds ParticleCraft alone and packages a public zip:
#   ..\public\ParticleCraft-<version>[-<label>]-windows-x64.zip
# Usage: powershell -ExecutionPolicy Bypass -File release.ps1 [-Label phase1]
param([string]$Label = '')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
Push-Location $here
npm run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
Pop-Location
Push-Location $root
cargo build --release -p particlecraft
if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
Pop-Location
$out = Join-Path $root 'Windows\ParticleCraft'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root 'target\release\particlecraft.exe') (Join-Path $out 'ParticleCraft.exe') -Force
$lib = Join-Path $root 'GameCraft\asset-library\world'
if (Test-Path $lib) { robocopy $lib (Join-Path $out 'asset-library\world') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null }
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $out -Force
$conf = Get-Content (Join-Path $here 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$name = "ParticleCraft-$($conf.version)" + ($(if ($Label) { "-$Label" } else { '' })) + '-windows-x64'
$stage = Join-Path $env:TEMP 'pc-package'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$dir = Join-Path $stage $name
New-Item -ItemType Directory -Force $dir | Out-Null
robocopy $out $dir /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $root 'packaging\ParticleCraft\*') $dir -Force
$zip = Join-Path $root "public\$name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage $name
if ($LASTEXITCODE -ne 0) { throw 'zip failed' }
Remove-Item -Recurse -Force $stage
"{0}  {1:N1} MB" -f $zip, ((Get-Item $zip).Length / 1MB)
