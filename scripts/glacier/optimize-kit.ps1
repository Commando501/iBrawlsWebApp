# Preserve authored UVs used by replacement runtime materials.
$ErrorActionPreference = 'Stop'
$glacierRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$glacierAssets = Join-Path $glacierRepo 'public/assets/glacier/architecture'
$glacierScratch = Join-Path $glacierRepo 'output/glacier'
$glacierNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
$glacierManifestPath = Join-Path $glacierAssets 'kit-v1.manifest.json'
$glacierManifest = Get-Content -LiteralPath $glacierManifestPath -Raw | ConvertFrom-Json
foreach ($glacierTier in @('high', 'low')) {
    $glacierVariant = $glacierManifest.variants.$glacierTier
    $glacierSource = Join-Path $glacierAssets $glacierVariant.file
    $glacierDedup = Join-Path $glacierScratch "kit-$glacierTier-dedup.glb"
    $glacierOptimized = Join-Path $glacierScratch "kit-$glacierTier-optimized.glb"
    & $glacierNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform dedup $glacierSource $glacierDedup
    if ($LASTEXITCODE -ne 0) { throw "glTF dedup failed for $glacierTier" }
    & $glacierNpx --yes --package '@gltf-transform/cli@4.5.1' gltf-transform prune $glacierDedup $glacierOptimized --keep-attributes true
    if ($LASTEXITCODE -ne 0) { throw "glTF prune failed for $glacierTier" }
    Copy-Item -LiteralPath $glacierOptimized -Destination $glacierSource
    $glacierVariant.bytes = (Get-Item -LiteralPath $glacierSource).Length
}
$glacierManifest | Add-Member -NotePropertyName optimizer -NotePropertyValue 'glTF Transform 4.5.1 dedup + prune --keep-attributes true; no geometry compression decoder' -Force
$glacierJson = ($glacierManifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($glacierManifestPath, $glacierJson, [System.Text.UTF8Encoding]::new($false))
