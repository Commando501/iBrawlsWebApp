# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$hangarRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$hangarAssets = Join-Path $hangarRepo 'public/assets/hangar/architecture'
$hangarScratch = Join-Path $hangarRepo 'output/hangar'
$hangarNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$hangarManifestPath = Join-Path $hangarAssets 'kit-v1.manifest.json'
$hangarManifest = Get-Content -LiteralPath $hangarManifestPath -Raw | ConvertFrom-Json
foreach ($hangarTier in @('high', 'low')) {
    $hangarVariant = $hangarManifest.variants.$hangarTier
    $hangarSource = Join-Path $hangarAssets $hangarVariant.file
    $hangarDedup = Join-Path $hangarScratch "kit-$hangarTier-dedup.glb"
    $hangarOptimized = Join-Path $hangarScratch "kit-$hangarTier-optimized.glb"
    & $hangarNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $hangarSource $hangarDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $hangarTier" }
    & $hangarNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $hangarDedup $hangarOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $hangarTier" }
    Copy-Item -LiteralPath $hangarOptimized -Destination $hangarSource
    $hangarVariant.bytes = (Get-Item -LiteralPath $hangarSource).Length
}
$hangarManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$hangarJson = ($hangarManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($hangarManifestPath, $hangarJson, [System.Text.UTF8Encoding]::new($false))
