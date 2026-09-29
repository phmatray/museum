"""
Les accessoires du musée : des modèles Meshy (texte → 3D, texture PBR), mis à
l'échelle réelle, allégés et réunis dans un seul fichier.

    blender --background --factory-startup --python tools/blender/build-accessoires.py -- <dossier des GLB Meshy>

Produit `public/assets/architecture/accessoires.glb`, une pièce par nœud,
instanciées par `src/scene/MobilierLayer.tsx` aux places de `src/plan/mobilier.ts`.
Les GLB bruts de Meshy (≈ 6 Mo chacun, textures 2K) ne sont pas dans le dépôt :
les prompts sont dans le manifeste `tools/fetch-assets.ts`. Le fichier produit,
lui, est commité — la CI n'a ni Blender ni clé Meshy.

Meshy livre chaque objet centré dans un cube de ±0,95, sans échelle. Ici :
une rotation pour que l'avant regarde −Y Blender (+Z three), l'échelle réelle
d'après UNE cote connue, l'origine au sol au centre de l'emprise, un plafond
de triangles, des textures ramenées à 1024 (512 pour les petits objets), en WebP.

L'arceau à vélos, un simple tube cintré, est modelé ici : pas besoin d'IA pour
un U renversé d'acier galvanisé.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "accessoires.glb"

# nom du nœud : (fichier Meshy, axe de la cote, cote en m, rotation z en degrés, plafond de triangles, texture)
PIECES = {
    "Potelet": ("potelet.glb", "z", 0.95, 0, 2000, 512),
    "ChaiseGardien": ("chaise.glb", "z", 0.88, 0, 3500, 512),
    "Presentoir": ("presentoir.glb", "x", 1.4, 0, 7000, 1024),
    "Extincteur": ("extincteur.glb", "z", 0.55, 0, 1500, 512),
    "PanneauHoraires": ("panneau.glb", "x", 1.6, 0, 3000, 1024),
    "Velo": ("velo.glb", "x", 1.78, 0, 12500, 1024),
    "Fontaine": ("fontaine.glb", "x", 3.0, 0, 15000, 1024),
    "Versailles": ("versailles.glb", "z", 1.4, 0, 8000, 1024),
}


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def importer(nom, fichier, axe, cote, rot, plafond, tex, source):
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / fichier))
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    maillages = [o for o in nouveaux if o.type == "MESH"]
    # Détacher de la hiérarchie en gardant la transformation, puis un seul objet.
    for o in maillages:
        m = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = m
    for o in nouveaux:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in maillages:
        o.select_set(True)
    bpy.context.view_layer.objects.active = maillages[0]
    if len(maillages) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.rotation_euler[2] += math.radians(rot)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # L'échelle réelle, d'après la cote donnée.
    lo = Vector([min(v.co[i] for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in o.data.vertices) for i in range(3)])
    k = cote / (hi - lo)["xyz".index(axe)]
    # L'origine au sol, au centre de l'emprise.
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in o.data.vertices:
        v.co = (v.co - centre) * k

    depart = triangles(o)
    if depart > plafond:
        d = o.modifiers.new("Alleger", "DECIMATE")
        d.ratio = plafond / depart
        bpy.ops.object.modifier_apply(modifier=d.name)

    o.name = o.data.name = nom
    for i, mat in enumerate(o.data.materials):
        mat.name = f"{nom}-{i}"
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                img = n.image
                img.name = f"{nom}-{n.label or n.name}"
                if max(img.size) > tex:
                    img.scale(tex, tex)
    dims = (hi - lo) * k
    print(f"ACCESSOIRE {nom:16s} {depart:6d} -> {triangles(o):6d} tri, {dims.x:.2f} × {dims.y:.2f} × {dims.z:.2f} m, textures {tex}")
    return o


def arceau():
    """L'arceau « Sheffield » : un U renversé de tube galvanisé Ø 48 mm, 0,80 × 0,80 m, scellé au sol."""
    courbe = bpy.data.curves.new("ArceauVelo", "CURVE")
    courbe.dimensions = "3D"
    courbe.bevel_depth = 0.024
    courbe.bevel_resolution = 3
    courbe.resolution_u = 6
    s = courbe.splines.new("POLY")
    r, l, h = 0.18, 0.40, 0.80
    pts = [(-l, 0, 0), (-l, 0, h - r)]
    pts += [(-l + r - r * math.cos(a), 0, h - r + r * math.sin(a)) for a in [math.pi / 2 * i / 6 for i in range(1, 7)]]
    pts += [(l - r + r * math.sin(a), 0, h - r + r * math.cos(a)) for a in [math.pi / 2 * i / 6 for i in range(0, 7)]]
    pts += [(l, 0, 0)]
    s.points.add(len(pts) - 1)
    for p, c in zip(s.points, pts):
        p.co = (*c, 1)
    o = bpy.data.objects.new("ArceauVelo", courbe)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = "ArceauVelo"
    m = bpy.data.materials.new("ArceauVelo")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.55, 0.57, 0.58, 1)
    b.inputs["Metallic"].default_value = 0.9
    b.inputs["Roughness"].default_value = 0.45
    o.data.materials.append(m)
    print(f"ACCESSOIRE ArceauVelo       {triangles(o):6d} tri")
    return o


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        print("usage : blender --background --factory-startup --python build-accessoires.py -- <dossier des GLB Meshy>")
        sys.exit(1)
    source = Path(args[0])
    repartir()
    for nom, p in PIECES.items():
        importer(nom, *p, source)
    arceau()
    bpy.ops.object.select_all(action="SELECT")
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="WEBP", export_image_quality=82,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    print(f"ACCESSOIRES {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(ROOT)}")


main()
