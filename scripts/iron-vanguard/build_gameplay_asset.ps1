$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$source = Join-Path $repoRoot 'output/iron-vanguard/runtime-v018/iron-vanguard-hammer-v018.clean.glb'
$intermediate = Join-Path $repoRoot 'output/iron-vanguard/runtime-v018/iron-vanguard-gameplay-simple.glb'
$destination = Join-Path $repoRoot 'public/assets/iron-vanguard/hammer-v018.glb'
if (-not (Test-Path -LiteralPath $source)) { throw 'Export and clean v018 first; see cascadeur/README.md#local-browser-swing-test.' }
New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
& npx --yes '@gltf-transform/cli@4.5.1' simplify $source $intermediate --ratio 0.12 --error 0.002
if ($LASTEXITCODE -ne 0) { throw 'Gameplay simplification failed.' }
& npx --yes '@gltf-transform/cli@4.5.1' meshopt $intermediate $destination --level medium --quantize-position 16 --quantize-normal 16 --quantize-weight 16
if ($LASTEXITCODE -ne 0) { throw 'Gameplay compression failed.' }
Write-Output "Built $destination"
