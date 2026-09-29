"""
Le lampadaire du parc, généré par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-lampadaire.py
    blender --background --factory-startup --python tools/blender/build-lampadaire.py -- --apercu /tmp/lampadaire

Produit `public/assets/architecture/lampadaire.glb`, un seul nœud `Lampadaire`,
instancié par `src/scene/MobilierLayer.tsx` aux places de `src/plan/mobilier.ts`.

« Ça manque de lumière à l'extérieur. On ajoute des lampadaires ? » (Philippe),
sur le modèle du Lindby « Daphne » : 2,20 m, fonte d'aluminium noire, un pied
évasé, un fût mince coiffé d'une pomme, une crosse qui se recourbe à 39 cm du
fût et porte une cloche de 25 cm, sous laquelle pend un globe dépoli.

Deux matières, que la scène reconnaît à leur nom :
- `Lampadaire_Fonte` : le noir satiné du métal ;
- `Lampadaire_Globe` : le verre dépoli, émissif — la scène ne l'allume qu'au
  crépuscule et la nuit.

Repère : l'origine au sol, au pied du fût ; la crosse part vers +X (Blender = three).
Déterministe : aucune valeur aléatoire.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "lampadaire.glb"

# La crosse : le fût monte jusqu'à la pomme, la crosse s'en détache à 1,86 m,
# culmine à 2,20 m et redescend au-dessus de la cloche, à 30 cm de l'axe.
FUT = 0.032
PORTEE = 0.30
HAUT_CLOCHE = 1.97


def repartir():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for d in list(coll):
            coll.remove(d)


def matiere(nom, couleur, rugosite, metallique=0.0, emission=None, force=0.0, transmission=0.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    b.inputs["Metallic"].default_value = metallique
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = force
    return m


def objet(nom, verts, faces, mat, lisse=50):
    me = bpy.data.meshes.new(nom)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(lisse))
    return o


def tour(profil, mat, x=0.0, n=20, lisse=50):
    """Une pièce tournée : le profil (r, z) de bas en haut, révolu autour de l'axe vertical en (x, 0)."""
    v, f = [], []
    for r, z in profil:
        for k in range(n):
            a = 2 * math.pi * k / n
            v.append((x + r * math.cos(a), r * math.sin(a), z))
    for i in range(len(profil) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            f.append((a, b, b + n, a + n))
    if profil[0][0] > 0:
        f.append(tuple(range(n))[::-1])
    if profil[-1][0] > 0:
        d = (len(profil) - 1) * n
        f.append(tuple(range(d, d + n)))
    return objet("tour", v, f, mat, lisse=lisse)


def tube(points, rayon, mat):
    """Un tube de section ronde le long d'une polyligne (x, z), dans le plan y = 0."""
    cu = bpy.data.curves.new("crosse", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = rayon
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, (x, z) in zip(sp.points, points):
        p.co = (x, 0.0, z, 1.0)
    o = bpy.data.objects.new("crosse", cu)
    bpy.context.collection.objects.link(o)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    m = bpy.data.objects.new("crosse", me)
    bpy.context.collection.objects.link(m)
    me.materials.clear()
    me.materials.append(mat)
    me.shade_smooth()
    return m


def fondre(objets, nom):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objets[0]
    if len(objets) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = nom
    o.data.name = nom
    return o


def lampadaire():
    fonte = matiere("Lampadaire_Fonte", (0.018, 0.018, 0.02), 0.42, metallique=0.55)
    # Le globe : un blanc chaud dépoli ; l'émission, 2700 K, est réglée par la scène.
    globe = matiere("Lampadaire_Globe", (0.92, 0.88, 0.8), 0.35, emission=(1.0, 0.66, 0.34), force=6.0)
    pieces = []
    # Le pied : une base carrée tournée à 8 pans, une doucine, deux bagues.
    pieces.append(tour([(0.0, 0.0), (0.105, 0.0), (0.105, 0.025), (0.092, 0.035), (0.085, 0.06), (0.07, 0.1),
                        (0.055, 0.15), (0.047, 0.2), (0.052, 0.215), (0.052, 0.235), (0.04, 0.25), (FUT, 0.26)],
                       fonte, n=8, lisse=30))
    # Le fût, une bague sous la crosse, et la pomme.
    pieces.append(tour([(FUT, 0.26), (FUT * 0.9, 1.84), (0.042, 1.85), (0.042, 1.875), (FUT * 0.85, 1.885),
                        (FUT * 0.85, 2.02), (0.036, 2.03), (0.036, 2.045), (0.026, 2.055), (0.03, 2.075), (0.024, 2.095),
                        (0.01, 2.115), (0.0, 2.125)], fonte, n=16))
    # La crosse : elle longe le fût, se recourbe en demi-cercle et redescend sur la cloche.
    rc = PORTEE / 2 - 0.01
    cx, cz = FUT + rc, 2.05
    arc = [(cx - rc * math.cos(math.pi * k / 24), cz + rc * math.sin(math.pi * k / 24)) for k in range(25)]
    pieces.append(tube([(FUT + 0.004, 1.86), (FUT + 0.004, 1.95), *arc, (cx + rc, HAUT_CLOCHE + 0.03)], 0.011, fonte))
    x = cx + rc
    # La cloche : un col, une calotte, un pavillon qui s'évase, un bord roulé.
    pieces.append(tour([(0.0, HAUT_CLOCHE + 0.045), (0.018, HAUT_CLOCHE + 0.04), (0.018, HAUT_CLOCHE + 0.01),
                        (0.03, HAUT_CLOCHE), (0.042, HAUT_CLOCHE - 0.03), (0.055, HAUT_CLOCHE - 0.075),
                        (0.08, HAUT_CLOCHE - 0.13), (0.11, HAUT_CLOCHE - 0.165), (0.125, HAUT_CLOCHE - 0.175),
                        (0.123, HAUT_CLOCHE - 0.182), (0.105, HAUT_CLOCHE - 0.172), (0.07, HAUT_CLOCHE - 0.14),
                        (0.0, HAUT_CLOCHE - 0.12)], fonte, x=x, n=24, lisse=35))
    corps = fondre(pieces, "Lampadaire_Corps")
    # Le globe dépoli, pendu sous la cloche.
    r, zc = 0.07, HAUT_CLOCHE - 0.215
    profil = [(r * math.sin(math.pi * k / 10), zc - r * math.cos(math.pi * k / 10)) for k in range(9)]
    profil += [(0.028, zc + 0.064), (0.028, HAUT_CLOCHE - 0.125)]
    verre = tour(profil, globe, x=x, n=20, lisse=80)
    verre.name = verre.data.name = "Lampadaire_Globe"
    racine = bpy.data.objects.new("Lampadaire", None)
    bpy.context.collection.objects.link(racine)
    for o in (corps, verre):
        o.parent = racine
    tris = sum(len(p.vertices) - 2 for o in (corps, verre) for p in o.data.polygons)
    print(f"  Lampadaire {tris} triangles, portée {x + 0.125:.3f} m, hauteur {max(v.co.z for v in corps.data.vertices):.3f} m")


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    print(f"lampadaire : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


def apercu(dossier):
    from mathutils import Vector

    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.render.resolution_x, scene.render.resolution_y = 600, 900
    monde = bpy.data.worlds.new("Ciel")
    scene.world = monde
    monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1)
    fond.inputs["Strength"].default_value = 0.6
    soleil = bpy.data.lights.new("Soleil", "SUN")
    soleil.energy = 3.5
    so = bpy.data.objects.new("Soleil", soleil)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(so)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    for nom, cible, direction, d in (("entier", Vector((0.1, 0, 1.1)), Vector((0.3, -1.0, 0.15)), 3.2),
                                     ("tete", Vector((0.2, 0, 1.95)), Vector((0.4, -1.0, 0.1)), 0.9)):
        cam.location = cible + direction.normalized() * d
        cam.rotation_euler = (cible - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(dossier / f"{nom}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    repartir()
    lampadaire()
    if "--apercu" in args:
        apercu(args[args.index("--apercu") + 1])
    else:
        exporter()
