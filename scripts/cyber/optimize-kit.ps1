# Package the authored GLBs without discarding UVs supplied to runtime materials.
$ErrorActionPreference = 'Stop'
$cyberRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cyberAssets = Join-Path $cyberRepo 'public/assets/cyber/architecture'
$cyberScratch = Join-Path $cyberRepo 'output/cyber'
$cyberNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$cyberManifestPath = Join-Path $cyberAssets 'kit-v1.manifest.json'
$cyberManifest = Get-Content -LiteralPath $cyberManifestPath -Raw | ConvertFrom-Json
foreach ($cyberTier in @('high', 'low')) {
    $cyberVariant = $cyberManifest.variants.$cyberTier
    $cyberSource = Join-Path $cyberAssets $cyberVariant.file
    $cyberDedup = Join-Path $cyberScratch "kit-$cyberTier-dedup.glb"
    $cyberOptimized = Join-Path $cyberScratch "kit-$cyberTier-optimized.glb"
    & $cyberNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $cyberSource $cyberDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $cyberTier" }
    & $cyberNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $cyberDedup $cyberOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $cyberTier" }
    Copy-Item -LiteralPath $cyberOptimized -Destination $cyberSource
    $cyberVariant.bytes = (Get-Item -LiteralPath $cyberSource).Length
}
$cyberManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$cyberJson = ($cyberManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($cyberManifestPath, $cyberJson, [System.Text.UTF8Encoding]::new($false))
