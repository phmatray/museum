"""
Ce qui habite le lit du ruisseau : la vieille souche moussue de la berge, la
branche morte tombée en travers du courant, et sept galets de rivière.

    blender --background --factory-startup --python tools/blender/build-ruisseau.py -- <souche Meshy .glb> <galets Meshy .glb>
    node tools/compresser-glb.ts public/assets/jardin/ruisseau.glb

Produit `public/assets/jardin/ruisseau.glb`. Les GLB bruts de Meshy (image
Nano Banana Pro → 3D, 11 et 13 Mo) ne sont pas dans le dépôt : les prompts sont
dans le manifeste `tools/fetch-assets.ts`.

- `src_souche` : la souche et sa motte de racines, 1,50 m de large, le pied à
  z = 0, centrée ; 14 000 triangles, textures 1024.
- `src_galet_1` … `src_galet_7` : les galets de la planche Meshy, séparés, couchés
  (l'œuf de granit debout se couche sur le flanc), chacun ramené à 20 cm de long,
  le pied à z = 0 ; une seule matière (la planche en partage la texture), donc
  un seul matériau pour les sept lots d'instances.
- `src_branche` : modelée ici, 3 m le long de +X depuis l'origine, un bois mort
  pelé, gris pâle, et quelques rameaux.

Tout est à l'origine : `src/scene/RuisseauLayer.tsx` les pose (`src/plan/ruisseau.ts`).
Déterministe : des tirages semés, aucune horloge.
"""

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "jardin" / "ruisseau.glb"

LARGEUR_SOUCHE = 1.5
TRI_SOUCHE = 14000
LONGUEUR_GALET = 0.2
TRI_GALET = 200
GALETS = 7
TEXTURE = 1024
LONGUEUR_BRANCHE = 3.0


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def importer(source):
    """Les maillages d'un GLB en un seul objet, transformations appliquées."""
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source))
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    maillages = [o for o in nouveaux if o.type == "MESH"]
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
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def boite(o):
    vs = [v.co for v in o.data.vertices]
    return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])


def poser(o, k):
    """Échelle k, centré en x et y, le pied à z = 0."""
    lo, hi = boite(o)
    o.data.transform(Matrix.Translation(Vector((0, 0, 0))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    o.data.update()


def decimer(o, plafond):
    # L'import coupe le maillage à chaque couture d'UV : recollé, le collapse descend vraiment.
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()
    n = triangles(o)
    if n > plafond:
        d = o.modifiers.new("Alleger", "DECIMATE")
        d.ratio = plafond / n
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=d.name)
    return n


def matiere_meshy(o, nom, rugosite, relief=True):
    """La matière Meshy renommée, textures ramenées à 1024 ; la carte métal/rugosité
    retirée : ni la mousse ni la pierre ne sont du métal, une rugosité unie suffit
    (et c'est une texture de moins à charger). Sans `relief`, la carte de normales
    part aussi : un galet poli par l'eau n'en a que faire."""
    for m in o.data.materials:
        m.name = nom
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        for entree in ("Metallic", "Roughness"):
            for lien in list(b.inputs[entree].links):
                m.node_tree.links.remove(lien)
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["Roughness"].default_value = rugosite
        if not relief:
            for nd in [nd for nd in m.node_tree.nodes if nd.type == "NORMAL_MAP"]:
                m.node_tree.nodes.remove(nd)
        for nd in list(m.node_tree.nodes):
            if nd.type == "TEX_IMAGE" and nd.image is not None:
                if not any(l.to_node.type in ("BSDF_PRINCIPLED", "NORMAL_MAP") for s in nd.outputs for l in s.links):
                    m.node_tree.nodes.remove(nd)
                elif max(nd.image.size) > TEXTURE:
                    nd.image.scale(TEXTURE, TEXTURE)


def souche(source):
    o = importer(source)
    lo, hi = boite(o)
    poser(o, LARGEUR_SOUCHE / max(hi.x - lo.x, hi.y - lo.y))
    n = decimer(o, TRI_SOUCHE)
    matiere_meshy(o, "Ruisseau_Souche", 0.92)
    for p in o.data.polygons:
        p.use_smooth = True
    o.name = o.data.name = "src_souche"
    lo, hi = boite(o)
    print(f"RUISSEAU souche {n} -> {triangles(o)} tri, {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z:.2f} m")


def galets(source):
    o = importer(source)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # Les coutures d'UV d'abord recollées : sinon chaque îlot de texture ferait un « galet ».
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    morceaux = sorted(bpy.context.selected_objects, key=lambda p: -len(p.data.vertices))
    for m in morceaux[GALETS:]:
        bpy.data.objects.remove(m)
    # De gauche à droite, comme sur la planche : granit, quartz, schiste, grès, basalte, calcaire, rubané.
    gardes = sorted(morceaux[:GALETS], key=lambda p: sum((v.co.x for v in p.data.vertices)) / len(p.data.vertices))
    for k, g in enumerate(gardes, 1):
        bpy.ops.object.select_all(action="DESELECT")
        g.select_set(True)
        bpy.context.view_layer.objects.active = g
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        g.data.transform(Matrix.Translation(g.location))
        g.location = (0, 0, 0)
        lo, hi = boite(g)
        # Debout (l'œuf de granit) : couché sur le flanc, comme au fond d'un lit.
        if hi.z - lo.z > 0.9 * max(hi.x - lo.x, hi.y - lo.y):
            g.data.transform(Matrix.Rotation(math.radians(90), 4, "X" if hi.y - lo.y < hi.x - lo.x else "Y"))
        lo, hi = boite(g)
        poser(g, LONGUEUR_GALET / max(hi.x - lo.x, hi.y - lo.y))
        n = decimer(g, TRI_GALET)
        for p in g.data.polygons:
            p.use_smooth = True
        g.name = g.data.name = f"src_galet_{k}"
        lo, hi = boite(g)
        print(f"RUISSEAU galet {k} {n} -> {triangles(g)} tri, {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z:.2f} m")
    matiere_meshy(gardes[0], "Ruisseau_Galet", 0.6, relief=False)


def branche():
    """Un bois mort pelé : une tige qui se tord un peu, quatre rameaux. Anneaux de 6 côtés."""
    rng = random.Random("branche")
    bm = bmesh.new()
    couleur = bm.loops.layers.color.new("Col")

    def tube(pts, rayons, teinte):
        anneaux = []
        for i, (p, r) in enumerate(zip(pts, rayons)):
            a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
            d = (b - a).normalized()
            u = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
            v = d.cross(u)
            anneaux.append([bm.verts.new(p + r * (math.cos(2 * math.pi * j / 6) * u + math.sin(2 * math.pi * j / 6) * v)) for j in range(6)])
        for i, (r0, r1) in enumerate(zip(anneaux, anneaux[1:])):
            for j in range(6):
                f = bm.faces.new((r0[j], r0[(j + 1) % 6], r1[(j + 1) % 6], r1[j]))
                f.smooth = True
                for l in f.loops:
                    # Le dessous, qui a trempé : plus sombre, verdi ; le dessus blanchi.
                    h = 0.5 + 0.5 * (l.vert.co - pts[i]).normalized().z
                    c = [teinte[k] * (0.55 + 0.5 * h) * rng.uniform(0.93, 1.05) for k in range(3)]
                    c[1] *= 1.0 + 0.12 * (1 - h)
                    l[couleur] = (*c, 1.0)
        return anneaux

    n = 18
    tige = [Vector((LONGUEUR_BRANCHE * t, 0.05 * math.sin(t * 7.1) + rng.uniform(-0.01, 0.01), 0.03 * math.sin(t * 4.3)))
            for t in (k / n for k in range(n + 1))]
    tube(tige, [0.038 * (1 - 0.65 * k / n) for k in range(n + 1)], (0.62, 0.6, 0.55))
    for t0, cote, l in ((0.3, 1, 0.55), (0.48, -1, 0.7), (0.66, 1, 0.45), (0.8, -1, 0.35)):
        p0 = tige[round(t0 * n)]
        d = Vector((0.7, cote * 0.7, 0.18)).normalized()
        pts = [p0 + d * (l * k / 4) + Vector((0, 0, -0.04 * (k / 4) ** 2)) for k in range(5)]
        tube(pts, [0.016 * (1 - 0.7 * k / 4) for k in range(5)], (0.58, 0.56, 0.52))
    me = bpy.data.meshes.new("src_branche")
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new("Ruisseau_Branche")
    m.use_nodes = True
    b = next(nd for nd in m.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = 0.85
    attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    m.node_tree.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    me.materials.append(m)
    o = bpy.data.objects.new("src_branche", me)
    bpy.context.collection.objects.link(o)
    print(f"RUISSEAU branche {triangles(o)} tri")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    souche(Path(argv[0]))
    galets(Path(argv[1]))
    branche()
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_image_format="WEBP", export_image_quality=85, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6)
    tri = sum(triangles(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"RUISSEAU_POIDS {SORTIE.stat().st_size // 1024} Kio, {tri} triangles -> {SORTIE.relative_to(ROOT)}")


main()
