# Preserve authored UVs used by replacement runtime materials.
$ErrorActionPreference = 'Stop'
$circleRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$circleAssets = Join-Path $circleRepo 'public/assets/circle/architecture'
$circleScratch = Join-Path $circleRepo 'output/circle'
$circleNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$circleManifestPath = Join-Path $circleAssets 'kit-v1.manifest.json'
$circleManifest = Get-Content -LiteralPath $circleManifestPath -Raw | ConvertFrom-Json
foreach ($circleTier in @('high', 'low')) {
    $circleVariant = $circleManifest.variants.$circleTier
    $circleSource = Join-Path $circleAssets $circleVariant.file
    $circleDedup = Join-Path $circleScratch "kit-$circleTier-dedup.glb"
    $circleOptimized = Join-Path $circleScratch "kit-$circleTier-optimized.glb"
    & $circleNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $circleSource $circleDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $circleTier" }
    & $circleNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $circleDedup $circleOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $circleTier" }
    Copy-Item -LiteralPath $circleOptimized -Destination $circleSource
    $circleVariant.bytes = (Get-Item -LiteralPath $circleSource).Length
}
$circleManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$circleJson = ($circleManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($circleManifestPath, $circleJson, [System.Text.UTF8Encoding]::new($false))
