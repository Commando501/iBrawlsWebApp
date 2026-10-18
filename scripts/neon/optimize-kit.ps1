# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$neonRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$neonAssets = Join-Path $neonRepo 'public/assets/neon/architecture'
$neonScratch = Join-Path $neonRepo 'output/neon'
$neonNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$neonManifestPath = Join-Path $neonAssets 'kit-v1.manifest.json'
$neonManifest = Get-Content -LiteralPath $neonManifestPath -Raw | ConvertFrom-Json
foreach ($neonTier in @('high', 'low')) {
    $neonVariant = $neonManifest.variants.$neonTier
    $neonSource = Join-Path $neonAssets $neonVariant.file
    $neonDedup = Join-Path $neonScratch "kit-$neonTier-dedup.glb"
    $neonOptimized = Join-Path $neonScratch "kit-$neonTier-optimized.glb"
    & $neonNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $neonSource $neonDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $neonTier" }
    & $neonNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $neonDedup $neonOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $neonTier" }
    Copy-Item -LiteralPath $neonOptimized -Destination $neonSource
    $neonVariant.bytes = (Get-Item -LiteralPath $neonSource).Length
}
$neonManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$neonJson = ($neonManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($neonManifestPath, $neonJson, [System.Text.UTF8Encoding]::new($false))

