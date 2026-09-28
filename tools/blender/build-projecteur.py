"""
Le projecteur sur rail des salles, généré par Blender en headless.

    blender --background --python tools/blender/build-projecteur.py

Produit `public/assets/architecture/projecteur.glb`, trois nœuds instanciés
par toile (`src/scene/ProjecteursLayer.tsx`) :

- `Monture` : l'adaptateur de rail, la tige et l'étrier. Origine au plafond ;
  elle ne fait que tourner vers le mur.
- `Tete` : le fût du projecteur, pointé vers +Z (three), origine sur l'axe de
  l'étrier : c'est lui qui s'incline vers la toile.
- `Lentille` : la vitre du fût, même repère que `Tete` ; on l'allume quand le
  visiteur regarde la toile.

Repère Blender : l'avant du fût est −Y Blender, soit +Z dans three.
Déterministe : aucune valeur aléatoire.
"""

import math
from pathlib import Path

import bpy

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "projecteur.glb"

# L'axe de l'étrier, sous le plafond : la tête pivote autour.
AXE = -0.17


def repartir():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)


def matiere(nom, couleur, rugosite, metallique=0.0, emission=None):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    b.inputs["Metallic"].default_value = metallique
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = 0.0
    return m


def lisser(o, angle=40):
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=math.radians(angle))


def cylindre(r, h, pos, rot=(0, 0, 0), n=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=pos, rotation=rot, vertices=n)
    # Transformations appliquées : les sommets sont en coordonnées d'objet final.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return bpy.context.active_object


def cube(taille, pos):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.active_object
    o.scale = taille
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def fondre(objets, nom, mat):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objets:
        o.select_set(True)
        o.data.materials.clear()
        o.data.materials.append(mat)
    bpy.context.view_layer.objects.active = objets[0]
    if len(objets) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = nom
    lisser(o)
    return o


def construire():
    repartir()
    alu = matiere("Projecteur_Alu", (0.035, 0.035, 0.037), 0.45, metallique=0.7)
    verre = matiere("Projecteur_Lentille", (0.9, 0.88, 0.8), 0.15, emission=(1.0, 0.93, 0.78))

    # La monture : adaptateur plaqué au rail, tige, étrier en U autour de l'axe.
    adaptateur = cube((0.05, 0.11, 0.035), (0, 0, -0.0175))
    tige = cylindre(0.009, 0.1, (0, 0, -0.085), n=12)
    traverse = cube((0.13, 0.018, 0.012), (0, 0, -0.13))
    branches = [cube((0.01, 0.018, 0.05), (s * 0.065, 0, AXE + 0.01)) for s in (-1, 1)]
    fondre([adaptateur, tige, traverse, *branches], "Monture", alu)

    # La tête : un fût de 20 cm, collerette à l'avant, dissipateur à l'arrière,
    # centrée sur l'axe de l'étrier, l'avant vers −Y Blender (+Z three).
    avant = (math.pi / 2, 0, 0)
    fut = cylindre(0.055, 0.2, (0, -0.04, AXE), rot=avant)
    collerette = cylindre(0.062, 0.025, (0, -0.13, AXE), rot=avant)
    ailettes = [cylindre(0.05 - 0.004 * i, 0.006, (0, 0.07 + 0.012 * i, AXE), rot=avant) for i in range(4)]
    fondre([fut, collerette, *ailettes], "Tete", alu)

    lentille = cylindre(0.048, 0.004, (0, -0.1445, AXE), rot=avant, n=24)
    lentille.data.materials.append(verre)
    lentille.name = "Lentille"

    # La tête et la lentille pivotent autour de l'axe de l'étrier : c'est leur origine.
    for nom in ("Tete", "Lentille"):
        o = bpy.data.objects[nom]
        bpy.context.view_layer.objects.active = o
        for v in o.data.vertices:
            v.co.z -= AXE
        o.location = (0, 0, AXE)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    print(f"projecteur : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


if __name__ == "__main__":
    import sys

    construire()
    if "--no-export" not in sys.argv:
        exporter()
