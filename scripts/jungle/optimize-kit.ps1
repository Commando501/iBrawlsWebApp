# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$jungleRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$jungleAssets = Join-Path $jungleRepo 'public/assets/jungle/architecture'
$jungleScratch = Join-Path $jungleRepo 'output/jungle'
$jungleNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$jungleManifestPath = Join-Path $jungleAssets 'kit-v1.manifest.json'
$jungleManifest = Get-Content -LiteralPath $jungleManifestPath -Raw | ConvertFrom-Json
foreach ($jungleTier in @('high', 'low')) {
    $jungleVariant = $jungleManifest.variants.$jungleTier
    $jungleSource = Join-Path $jungleAssets $jungleVariant.file
    $jungleDedup = Join-Path $jungleScratch "kit-$jungleTier-dedup.glb"
    $jungleOptimized = Join-Path $jungleScratch "kit-$jungleTier-optimized.glb"
    & $jungleNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $jungleSource $jungleDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $jungleTier" }
    & $jungleNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $jungleDedup $jungleOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $jungleTier" }
    Copy-Item -LiteralPath $jungleOptimized -Destination $jungleSource
    $jungleVariant.bytes = (Get-Item -LiteralPath $jungleSource).Length
}
$jungleManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$jungleJson = ($jungleManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($jungleManifestPath, $jungleJson, [System.Text.UTF8Encoding]::new($false))
