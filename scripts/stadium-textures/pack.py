"""Package stadium source textures without artistic or view-transform changes.

Run: blender --background --factory-startup --python scripts/stadium-textures/pack.py
Optionally append: -- --ceramic-source /absolute/path/to/generated.png

Image.save writes the image's own color space (sRGB for color, Non-Color for
physical data), avoiding the scene's AgX/Filmic render transform. Originals are
retained; only the explicitly named runtime derivatives are replaced.
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "public" / "assets" / "stadium"


def package(source: Path, destination: Path, max_dimension: int, color: bool):
    image = bpy.data.images.load(str(source), check_existing=False)
    try:
        image.colorspace_settings.name = "sRGB" if color else "Non-Color"
        original_size = tuple(image.size)
        ratio = max_dimension / max(original_size)
        size = tuple(max(1, round(dimension * ratio)) for dimension in original_size)
        image.scale(*size)
        image.file_format = "JPEG"
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(filepath=str(destination), quality=91 if color else 95, save_copy=True)
        # Reopen the file to verify the encoded image, not just the in-memory size.
        encoded = bpy.data.images.load(str(destination), check_existing=False)
        try:
            if tuple(encoded.size) != size:
                raise RuntimeError(f"Wrong encoded dimensions: {destination}")
        finally:
            bpy.data.images.remove(encoded)
        data = destination.read_bytes()
        return {
            "path": str(destination.relative_to(ROOT / "public")).replace("\\", "/"),
            "source": str(source.relative_to(ROOT / "public")).replace("\\", "/"),
            "width": size[0], "height": size[1], "bytes": len(data),
            "colorSpace": "sRGB" if color else "linear / no color space",
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    finally:
        bpy.data.images.remove(image)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ceramic-source", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    ceramic_source = ASSETS / "ceramic" / "source.png"
    if args.ceramic_source:
        ceramic_source.parent.mkdir(parents=True, exist_ok=True)
        if args.ceramic_source.resolve() != ceramic_source.resolve():
            shutil.copyfile(args.ceramic_source, ceramic_source)
    if not ceramic_source.is_file():
        raise FileNotFoundError("Supply the generated ceramic albedo using --ceramic-source.")

    files = [
        package(ceramic_source, ceramic_source.with_name("albedo.jpg"), 1024, True),
        package(ceramic_source, ceramic_source.with_name("albedo-low.jpg"), 512, True),
    ]
    for directory in ("metal-panels", "concrete"):
        for source in sorted((ASSETS / directory).glob("*.jpg")):
            if source.stem.endswith("-low"):
                continue
            files.append(package(source, source.with_name(source.stem + "-low.jpg"), 512, source.stem == "albedo"))
    for name in ("championship", "sapphire", "gauss"):
        source = ASSETS / "screens" / (name + ".png")
        files.append(package(source, source.with_name(name + "-low.jpg"), 512, True))

    manifest = {"version": 1, "tool": "Blender Image.scale / Image.save", "artisticChanges": False, "files": files}
    (ASSETS / "texture-pack-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(files), "runtimeBytes": sum(file["bytes"] for file in files), "manifest": str(ASSETS / "texture-pack-manifest.json")}))


if __name__ == "__main__":
    main()
