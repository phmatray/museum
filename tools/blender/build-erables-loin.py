"""
Les érables du jardin vus de loin, générés par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-erables-loin.py

Produit `public/assets/jardin/erables-loin.glb` : `src_erable_rouge` et
`src_erable_vert` de `build-jardin.py`, tirés des mêmes graines avec
`loin=True` — mêmes branches, mêmes nuages, deux fois moins de cartes de
feuillage (deux fois plus grandes) et des rameaux sans fourches. Au-delà de
35 m, `ParkLayer.tsx` les dessine à la place des sujets de `jardin.glb`, avec
LEURS matériaux : ce fichier ne porte que la géométrie (et le nom des
matériaux, qui trie écorce et feuillage). Sans les sources Poly Haven.
"""

import importlib.util
import sys
from pathlib import Path

import bpy

ICI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("build_jardin", ICI / "build-jardin.py")
jardin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jardin)

SORTIE = jardin.ROOT / "public" / "assets" / "jardin" / "erables-loin.glb"


def construire():
    jardin.repartir()
    ecorce = jardin.matiere("Jardin_Ecorce", (0.07, 0.055, 0.045), 0.9)
    feuilles = jardin.matiere("Jardin_Feuillage", (1, 1, 1), 0.75)
    jardin.erable("src_erable_rouge", "erable-rouge", 11, ecorce, feuilles, loin=True)
    jardin.erable("src_erable_vert", "erable-vert", 12, ecorce, feuilles, loin=True)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    for o in bpy.data.objects:
        if o.type == "MESH":
            print(f"ERABLE_LOIN {o.name:18} {jardin.triangles(o)} triangles")
    print(f"ERABLE_LOIN {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(jardin.ROOT)}")


if __name__ == "__main__":
    construire()
    if "--no-export" not in sys.argv:
        exporter()
