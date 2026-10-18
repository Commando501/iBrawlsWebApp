# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$rainyRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$rainyAssets = Join-Path $rainyRepo 'public/assets/rainy/architecture'
$rainyScratch = Join-Path $rainyRepo 'output/rainy'
$rainyNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$rainyManifestPath = Join-Path $rainyAssets 'kit-v1.manifest.json'
$rainyManifest = Get-Content -LiteralPath $rainyManifestPath -Raw | ConvertFrom-Json
foreach ($rainyTier in @('high', 'low')) {
    $rainyVariant = $rainyManifest.variants.$rainyTier
    $rainySource = Join-Path $rainyAssets $rainyVariant.file
    $rainyDedup = Join-Path $rainyScratch "kit-$rainyTier-dedup.glb"
    $rainyOptimized = Join-Path $rainyScratch "kit-$rainyTier-optimized.glb"
    & $rainyNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $rainySource $rainyDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $rainyTier" }
    & $rainyNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $rainyDedup $rainyOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $rainyTier" }
    Copy-Item -LiteralPath $rainyOptimized -Destination $rainySource
    $rainyVariant.bytes = (Get-Item -LiteralPath $rainySource).Length
}
$rainyManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$rainyJson = ($rainyManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($rainyManifestPath, $rainyJson, [System.Text.UTF8Encoding]::new($false))

