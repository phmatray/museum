"""
Le bébé hérisson du jardin : un modèle Meshy (image Nano Banana Pro → 3D,
piquants modelés en vrai relief), mis à l'échelle, les pattes tassées, allégé.

    blender --background --factory-startup --python tools/blender/build-herisson.py -- <herisson Meshy .glb>

Produit `public/assets/faune/herisson.glb`. Le GLB brut de Meshy (10 Mo,
texture 2K) n'est pas dans le dépôt : le prompt est dans le manifeste
`tools/fetch-assets.ts`.

- Le nez vers +X Blender (+x three), 16,5 cm du museau à la croupe, les pieds à 0.
- Les pattes raccourcies de moitié : sur la photo de Philippe, la jupe de poils
  les cache presque ; le modèle Meshy le posait haut sur pattes.
- 14 000 triangles, dont le visage intact (les yeux et le museau fondaient à
  la décimation) ; texture 1024 en WebP, Draco.
- Ses gestes (trot, museau qui flaire, boule) sont dans le vertex shader de
  `src/scene/FauneLayer.tsx` : aucune cible de morphose à télécharger.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "faune" / "herisson.glb"

LONGUEUR = 0.165
ROTATION = 90  # Meshy le livre le nez vers −Y.
PLAFOND = 14000
# Le visage, ses derniers centimètres : gardé tel que Meshy l'a modelé.
VISAGE = 0.045
TEXTURE = 1024
# Les pattes : tout ce qui est sous cette part de la hauteur est tassé de moitié.
JAMBES, TASSEMENT = 0.28, 0.5


def importer(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    maillages = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in maillages:
        m = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = m
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in maillages:
        o.select_set(True)
    bpy.context.view_layer.objects.active = maillages[0]
    if len(maillages) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Le glTF importé est en quaternions : on tourne le maillage lui-même.
    o.data.transform(Matrix.Rotation(math.radians(ROTATION), 4, "Z"))
    return o


def normaliser(o):
    vs = o.data.vertices
    lo = Vector([min(v.co[i] for v in vs) for i in range(3)])
    hi = Vector([max(v.co[i] for v in vs) for i in range(3)])
    k = LONGUEUR / (hi.x - lo.x)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    h = (hi.z - lo.z) * k
    seuil = JAMBES * h
    for v in vs:
        p = (v.co - centre) * k
        # Les pattes sous la jupe : tassées, et le corps descend d'autant.
        p.z = p.z * TASSEMENT if p.z < seuil else p.z - seuil * (1 - TASSEMENT)
        v.co = p
    o.data.update()


def alleger(o):
    """Les piquants allégés, le visage intact : c'est lui qu'on regarde, et la décimation le ruinait (yeux fondus, museau en cône)."""
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    x1 = max(v.co.x for v in o.data.vertices)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in o.data.polygons:
        p.select = p.center.x > x1 - VISAGE
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    visage = next(x for x in bpy.context.selected_objects if x is not o)
    garde = sum(len(p.vertices) - 2 for p in visage.data.polygons)
    corps = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = o.modifiers.new("Alleger", "DECIMATE")
    d.ratio = max(0.05, (PLAFOND - garde) / corps)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=d.name)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    visage.select_set(True)
    bpy.ops.object.join()
    for mat in o.data.materials:
        mat.name = "Faune_Herisson"
        for nd in mat.node_tree.nodes:
            if nd.type == "TEX_IMAGE" and nd.image is not None and max(nd.image.size) > TEXTURE:
                nd.image.scale(TEXTURE, TEXTURE)
    print(f"HERISSON {n} -> {sum(len(p.vertices) - 2 for p in o.data.polygons)} tri (visage {garde})")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = importer(Path(argv[0]))
    normaliser(o)
    alleger(o)
    o.name = o.data.name = "Herisson"
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", use_selection=True, export_yup=True,
                              export_image_format="WEBP", export_image_quality=82, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6)
    print(f"HERISSON {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(ROOT)}")


main()
