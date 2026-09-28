"""
Les chambranles de pierre des portes, générés par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-chambranle.py

Produit `public/assets/architecture/chambranle.glb`, trois pièces instanciées
sur chaque face de porte (`src/scene/PortesLayer.tsx`, placement dans
`src/plan/portes.ts`) :

- `Chambranle` : l'architrave en U — deux montants et une traverse, onglets à
  45° —, un profil de musée (baguette, deux fasces, quart-de-rond et filet)
  balayé le long de la porte. Modelé pour une baie de W0 = 2,00 m : three
  l'élargit en poussant chaque moitié vers son côté (x < 0 à gauche, x > 0 à
  droite), si bien que les onglets et la largeur du profil ne se déforment pas.
- `Plinthe` : le socle d'un montant, centré en x.
- `Entablement` : frise lisse (où l'on grave le nom de la salle) et corniche
  à retours d'onglet, posée sur la traverse. Élargie comme le chambranle.

Repère three (celui de l'export, +Y en haut) : x le long du mur, centré sur la
baie ; y la hauteur depuis le plancher ; z la saillie, 0 sur la face du mur.
Les cotes suivent `src/plan/portes.ts` (LINTEAU 2,40 m, largeur 0,22 m).
Déterministe : aucune valeur aléatoire.
"""

import math
from pathlib import Path

import bmesh
import bpy

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "chambranle.glb"

# ── Les cotes, lues dans src/plan/portes.ts ───────────────────────────────
W0 = 2.0          # largeur de baie du modèle ; three élargit
H = 2.4           # sous linteau (LINTEAU de src/plan/mesh.ts)
L = 0.22          # largeur de l'architrave
HP = 0.32         # hauteur de la plinthe
LP = L + 0.03     # largeur de la plinthe
FRISE = 0.36      # hauteur de la frise, sous la corniche


def repartir():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)


def matiere():
    # #d6c9b0, la pierre du hall (src/scene/pierre.ts), en linéaire.
    m = bpy.data.materials.new("Chambranle_Pierre")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.672, 0.584, 0.434, 1.0)
    b.inputs["Roughness"].default_value = 0.8
    return m


def pt(x, y, z):
    """Un point du repère three dans celui de Blender (l'export repasse en +Y)."""
    return (x, -z, y)


def arc(cu, cv, r, a0, a1, n=6):
    """Un arc (u, v) du profil, de l'angle a0 à a1 en degrés, sans son premier point."""
    return [(cu + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cv + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(1, n + 1)]


# Le profil de l'architrave : (s, z), s de l'arête de la baie vers le dehors, z la saillie.
ARCHITRAVE = [
    (0.0, 0.0), (0.0, 0.036),
    *arc(0.012, 0.036, 0.012, 180, 90, 5),        # la baguette, sur l'arête de la baie
    (0.016, 0.048), (0.016, 0.040), (0.085, 0.040),  # première fasce
    (0.085, 0.047), (0.150, 0.047),                # seconde fasce
    (0.150, 0.054), *arc(0.176, 0.054, 0.026, 180, 90, 8),  # filet et quart-de-rond
    (0.205, 0.080), (0.214, 0.077), (0.220, 0.070), (L, 0.0),
]

# Le profil de l'entablement : (y, z), y au-dessus de la traverse, z la saillie.
ENTABLEMENT = [
    (0.0, 0.0), (0.0, 0.035), (FRISE, 0.035),      # la frise, en retrait de l'architrave
    (FRISE, 0.045), *arc(FRISE + 0.04, 0.045, 0.04, 180, 90, 8),  # quart-de-rond de lit
    (FRISE + 0.04, 0.095), (FRISE + 0.045, 0.175),  # larmier, sa sous-face
    (0.50, 0.175), (0.505, 0.182),                  # face du larmier
    *arc(0.505, 0.202, 0.02, 270, 360, 5),          # doucine : le creux…
    *arc(0.545, 0.202, 0.02, 180, 90, 5),           # … et la panse
    (0.56, 0.222), (0.56, 0.0),
]

# La plinthe : (y, z), un socle à chanfrein.
PLINTHE = [(0.0, 0.0), (0.0, 0.10), (HP - 0.03, 0.10), (HP, 0.088), (HP, 0.0)]


def balayage(nom, anneaux, mat, bouchons=False):
    """Relie des anneaux de même nombre de sommets ; `bouchons` ferme les deux bouts."""
    v, f = [], []
    n = len(anneaux[0])
    for a in anneaux:
        v.extend(pt(*p) for p in a)
    for k in range(len(anneaux) - 1):
        for j in range(n - 1):
            a, b = k * n + j, k * n + j + 1
            f.append((a, b, b + n, a + n))
    if bouchons:
        f.append(tuple(range(n))[::-1])
        d = (len(anneaux) - 1) * n
        f.append(tuple(range(d, d + n)))
    me = bpy.data.meshes.new(nom)
    me.from_pydata(v, [], f)
    me.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    # Tout se voit de face (−Y Blender, +z three) : si l'aire vue de face est
    # négative, le sens de saisie est à l'envers, on retourne tout.
    if sum(-fa.normal.y * fa.calc_area() for fa in bm.faces) < 0:
        for fa in bm.faces:
            fa.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    o = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(o)
    return o


def construire():
    repartir()
    pierre = matiere()
    c = W0 / 2

    # L'architrave en U : quatre anneaux, les deux du haut sur l'onglet (s le long de la bissectrice).
    balayage("Chambranle", [
        [(-(c + s), HP, z) for s, z in ARCHITRAVE],
        [(-(c + s), H + s, z) for s, z in ARCHITRAVE],
        [(c + s, H + s, z) for s, z in ARCHITRAVE],
        [(c + s, HP, z) for s, z in ARCHITRAVE],
    ], pierre)

    # L'entablement : du mur au retour gauche, l'onglet, la face, l'onglet, le retour droit.
    e, y0 = c + L, H + L
    balayage("Entablement", [
        [(-(e + z), y0 + y, 0.0) for y, z in ENTABLEMENT],
        [(-(e + z), y0 + y, z) for y, z in ENTABLEMENT],
        [(e + z, y0 + y, z) for y, z in ENTABLEMENT],
        [(e + z, y0 + y, 0.0) for y, z in ENTABLEMENT],
    ], pierre)

    balayage("Plinthe", [[(x, y, z) for y, z in PLINTHE] for x in (-LP / 2, LP / 2)], pierre, bouchons=True)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    print(f"chambranle : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


if __name__ == "__main__":
    import sys

    construire()
    if "--no-export" not in sys.argv:
        exporter()
