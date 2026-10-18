# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$asteroidRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$asteroidAssets = Join-Path $asteroidRepo 'public/assets/asteroid/architecture'
$asteroidScratch = Join-Path $asteroidRepo 'output/asteroid'
$asteroidNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$asteroidManifestPath = Join-Path $asteroidAssets 'kit-v1.manifest.json'
$asteroidManifest = Get-Content -LiteralPath $asteroidManifestPath -Raw | ConvertFrom-Json
foreach ($asteroidTier in @('high', 'low')) {
    $asteroidVariant = $asteroidManifest.variants.$asteroidTier
    $asteroidSource = Join-Path $asteroidAssets $asteroidVariant.file
    $asteroidDedup = Join-Path $asteroidScratch "kit-$asteroidTier-dedup.glb"
    $asteroidOptimized = Join-Path $asteroidScratch "kit-$asteroidTier-optimized.glb"
    & $asteroidNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $asteroidSource $asteroidDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $asteroidTier" }
    & $asteroidNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $asteroidDedup $asteroidOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $asteroidTier" }
    Copy-Item -LiteralPath $asteroidOptimized -Destination $asteroidSource
    $asteroidVariant.bytes = (Get-Item -LiteralPath $asteroidSource).Length
}
$asteroidManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$asteroidJson = ($asteroidManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($asteroidManifestPath, $asteroidJson, [System.Text.UTF8Encoding]::new($false))

