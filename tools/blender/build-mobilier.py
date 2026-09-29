"""
Le mobilier du musée, généré par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-mobilier.py
    blender --background --factory-startup --python tools/blender/build-mobilier.py -- --apercu /tmp/mobilier

Produit `public/assets/architecture/mobilier.glb`, une pièce par nœud,
instanciées par `src/scene/MobilierLayer.tsx` aux places de `src/plan/mobilier.ts` :

- `Banquette` : la banquette des galeries, 2,20 × 0,70 × 0,45 m — coussin de
  velours vert capitonné (boutons en quinconce, plis en losanges) sur un bâti
  de chêne miel à six pieds tournés, sabots de laiton.
- `BancNef` : le banc de la nef, 2,80 × 0,60 × 0,46 m — cuir fauve cloué de
  laiton sur un bâti de chêne à pieds fuselés et entretoise en H.
- `Accueil` : la banque d'accueil, 2,80 × 0,75 × 1,08 m — noyer à panneaux
  moulurés et pilastres, plinthe et jonc de laiton, dessus de marbre, et une
  lampe de banquier de laiton à l'abat-jour vert.
- `BancBatllo` : le banc double de la Casa Batlló (Gaudí, 1906), 1,50 × 0,70 m
  — chêne sculpté d'un seul tenant : deux assises creusées, deux dossiers en
  coquille, des pieds en os. Primitives fondues par remaillage voxel, puis
  lissées : aucune ligne droite.
- `BancPierre` : le banc de granit brut du bord de l'étang, 1,60 × 0,50 m.
- `BancJardin` : le banc de bois du jardin japonais, 1,80 × 0,45 m — trois
  lattes de cèdre sur deux tréteaux à tenons traversants.

Repère : l'origine au sol, au centre de l'emprise ; l'avant (où l'on s'assoit
face à la vue) vers −Y Blender, soit +Z dans three. x Blender = x three.
Déterministe : aucune valeur aléatoire (le bruit du granit est une texture fixe).
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
SORTIE = ROOT / "public" / "assets" / "architecture" / "mobilier.glb"
# La part des triangles d'un coussin capitonné qu'on garde : voir `coussin`.
ALLEGEMENT = 0.6


# ── Outils ────────────────────────────────────────────────────────────────


def repartir():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.textures, bpy.data.cameras, bpy.data.lights):
        for d in list(coll):
            coll.remove(d)


def matiere(nom, couleur, rugosite, metallique=0.0, sheen=None, emission=None, force=0.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    b.inputs["Metallic"].default_value = metallique
    if sheen is not None:
        # Le velours : un voile clair sous l'incidence rasante (KHR_materials_sheen).
        b.inputs["Sheen Weight"].default_value = 1.0
        b.inputs["Sheen Tint"].default_value = (*sheen, 1.0)
        b.inputs["Sheen Roughness"].default_value = 0.45
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = force
    return m


def lier(o, mat):
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


def appliquer(o):
    """Applique les modificateurs de `o`, sans opérateur (le fond n'a pas de contexte)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    ancien = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(ancien)
    return o


def objet(nom, verts, faces, mat, lisse=None):
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
    lier(o, mat)
    if lisse is not None:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(lisse))
    return o


def boite(x0, x1, y0, y1, z0, z1, mat, biseau=0.0, segments=2):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    o = objet("boite", v, f, mat)
    if biseau > 0:
        m = o.modifiers.new("Biseau", "BEVEL")
        m.width = biseau
        m.segments = segments
        m.limit_method = "NONE"
        appliquer(o)
        o.data.shade_smooth()
        o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


def tronc(x, y, z0, z1, c0, c1, mat, biseau=0.006):
    """Un pied carré fuselé : côté c0 en bas, c1 en haut."""
    v = []
    for z, c in ((z0, c0), (z1, c1)):
        v += [(x - c / 2, y - c / 2, z), (x + c / 2, y - c / 2, z), (x + c / 2, y + c / 2, z), (x - c / 2, y + c / 2, z)]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = objet("pied", v, f, mat)
    m = o.modifiers.new("Biseau", "BEVEL")
    m.width = biseau
    m.segments = 2
    appliquer(o)
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


def tour(profil, mat, x=0.0, y=0.0, n=20, lisse=50):
    """Une pièce tournée : le profil (r, z) de bas en haut, révolu autour de l'axe (x, y)."""
    v, f = [], []
    for r, z in profil:
        for k in range(n):
            a = 2 * math.pi * k / n
            v.append((x + r * math.cos(a), y + r * math.sin(a), z))
    for i in range(len(profil) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            f.append((a, b, b + n, a + n))
    f.append(tuple(range(n))[::-1])
    d = (len(profil) - 1) * n
    f.append(tuple(range(d, d + n)))
    return objet("tour", v, f, mat, lisse=lisse)


def sphere(x, y, z, r, mat, sz=1.0, n=10):
    v, f = [], []
    anneaux = n // 2
    for i in range(1, anneaux):
        t = math.pi * i / anneaux
        for k in range(n):
            a = 2 * math.pi * k / n
            v.append((x + r * math.sin(t) * math.cos(a), y + r * math.sin(t) * math.sin(a), z - r * sz * math.cos(t)))
    bas, haut = len(v), len(v) + 1
    v += [(x, y, z - r * sz), (x, y, z + r * sz)]
    for i in range(anneaux - 2):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            f.append((a, b, b + n, a + n))
    for k in range(n):
        f.append((bas, (k + 1) % n, k))
        d = (anneaux - 2) * n
        f.append((haut, d + k, d + (k + 1) % n))
    return objet("sphere", v, f, mat, lisse=80)


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


def lisse01(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def au_segment(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)


def coussin(L, W, z0, epaisseur, mat, boutons, plis, pas=0.014, arrondi=0.05, bord=0.35,
            creux=0.026, r_bouton=0.022, pli=0.008, l_pli=0.014):
    """
    Un coussin en champ de hauteurs : dessus bombé qui s'arrondit sur ses bords,
    creusé à chaque bouton et le long de chaque pli, flancs droits jusqu'au bâti.
    """
    nx, ny = int(round(L / pas)) + 1, int(round(W / pas)) + 1
    v, f = [], []

    def haut(x, y):
        d = min(L / 2 - abs(x), W / 2 - abs(y))
        # Un quart de cercle : le bord roule, il ne se chanfreine pas.
        s = math.sqrt(max(0.0, 1 - (1 - min(1.0, d / arrondi)) ** 2))
        z = z0 + epaisseur * (bord + (1 - bord) * s)
        for bx, by in boutons:
            z -= creux * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / r_bouton ** 2)
        for a, b in plis:
            z -= pli * math.exp(-(au_segment(x, y, a, b) / l_pli) ** 2)
        return z

    for j in range(ny):
        for i in range(nx):
            x, y = -L / 2 + L * i / (nx - 1), -W / 2 + W * j / (ny - 1)
            v.append((x, y, haut(x, y)))
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            f.append((a, a + 1, a + nx + 1, a + nx))
    # Le pourtour du dessus, descendu au bâti : flancs, puis le fond.
    tourn = [i for i in range(nx)] + [j * nx + nx - 1 for j in range(1, ny)] + \
            [(ny - 1) * nx + i for i in range(nx - 2, -1, -1)] + [j * nx for j in range(ny - 2, 0, -1)]
    base = len(v)
    for k in tourn:
        x, y, _ = v[k]
        v.append((x, y, z0))
    m = len(tourn)
    for k in range(m):
        a, b = tourn[k], tourn[(k + 1) % m]
        f.append((b, a, base + k, base + (k + 1) % m))
    f.append(tuple(range(base, base + m))[::-1])
    o = objet("coussin", v, f, mat, lisse=70)
    # La grille fine ne sert qu'aux boutons, aux plis et au bord qui roule ; entre eux le dessus
    # bombe à peine. Une décimation par erreur quadrique y ôte l'essentiel des triangles — sur le
    # dessus seulement, le bord qui roule et les flancs restent tels quels —, et les normales de la
    # grille d'origine, recopiées coin par coin, gardent l'ombrage du velours.
    ref = o.copy()
    ref.data = o.data.copy()
    bpy.context.collection.objects.link(ref)
    dessus = o.vertex_groups.new(name="dessus")
    dessus.add([s.index for s in o.data.vertices
                if s.co.z > z0 + 1e-4 and min(L / 2 - abs(s.co.x), W / 2 - abs(s.co.y)) > arrondi * 1.2], 1.0, "REPLACE")
    dec = o.modifiers.new("Allege", "DECIMATE")
    dec.ratio = ALLEGEMENT
    dec.vertex_group = "dessus"
    appliquer(o)
    dt = o.modifiers.new("Normales", "DATA_TRANSFER")
    dt.object = ref
    dt.use_loop_data = True
    dt.data_types_loops = {"CUSTOM_NORMAL"}
    dt.loop_mapping = "POLYINTERP_NEAREST"
    dt.vertex_group = "dessus"
    appliquer(o)
    o.vertex_groups.clear()
    bpy.data.meshes.remove(ref.data)
    return o


def quinconce(L, W, pas_x, rangs):
    """Les boutons d'un capitonnage en losanges, et les plis qui les relient."""
    boutons, lignes = [], []
    for j, y in enumerate(rangs):
        decale = j % 2 == 1
        n = int((L - 2 * pas_x) / pas_x) + (0 if decale else 1)
        x0 = -(n - 1) * pas_x / 2
        lignes.append([(x0 + k * pas_x, y) for k in range(n)])
        boutons += lignes[-1]
    plis = []
    for a, b in zip(lignes, lignes[1:]):
        for p in a:
            for q in b:
                if abs(p[0] - q[0]) < pas_x * 0.75:
                    plis.append((p, q))
    # Des bords : chaque bouton des rangs extrêmes tire un pli vers le flanc.
    for ligne, vers in ((lignes[0], -W / 2), (lignes[-1], W / 2)):
        for p in ligne:
            plis.append((p, (p[0], vers)))
    return boutons, plis


# ── Les matières ──────────────────────────────────────────────────────────


def matieres():
    return {
        "chene": matiere("Mobilier_Chene", (0.47, 0.26, 0.10), 0.5),
        "velours": matiere("Mobilier_Velours", (0.010, 0.052, 0.028), 0.88, sheen=(0.35, 0.62, 0.45)),
        "laiton": matiere("Mobilier_Laiton", (0.78, 0.56, 0.26), 0.3, metallique=0.9),
        "cuir": matiere("Mobilier_Cuir", (0.16, 0.052, 0.018), 0.42),
        "noyer": matiere("Mobilier_Noyer", (0.13, 0.058, 0.026), 0.38),
        "marbre": matiere("Mobilier_Marbre", (0.80, 0.77, 0.72), 0.18),
        "abat_jour": matiere("Mobilier_AbatJour", (0.03, 0.28, 0.10), 0.12, emission=(0.35, 0.8, 0.45), force=0.25),
        "batllo": matiere("Mobilier_ChenBatllo", (0.46, 0.24, 0.085), 0.45),
        "granit": matiere("Mobilier_Granit", (0.34, 0.33, 0.30), 0.88),
        "cedre": matiere("Mobilier_Cedre", (0.26, 0.15, 0.075), 0.7),
    }


# ── Les pièces ────────────────────────────────────────────────────────────


def banquette(M):
    L, W = 2.2, 0.7
    parts = []
    # Le bâti : une ceinture moulurée, un jonc en dessous.
    parts.append(boite(-1.075, 1.075, -0.325, 0.325, 0.29, 0.375, M["chene"], biseau=0.012, segments=3))
    parts.append(boite(-1.055, 1.055, -0.305, 0.305, 0.268, 0.292, M["chene"], biseau=0.008))
    # Six pieds tournés : sabot de laiton, balustre, bague, vase, dé.
    profil = [(0.020, 0.0), (0.026, 0.004), (0.026, 0.028), (0.022, 0.03),
              (0.020, 0.032), (0.024, 0.05), (0.020, 0.09), (0.018, 0.115), (0.03, 0.128), (0.03, 0.14),
              (0.018, 0.152), (0.024, 0.17), (0.036, 0.205), (0.034, 0.23), (0.024, 0.245), (0.036, 0.255),
              (0.038, 0.27)]
    for x in (-0.97, 0.0, 0.97):
        for y in (-0.25, 0.25):
            parts.append(tour(profil[4:], M["chene"], x, y))
            parts.append(tour(profil[:4] + [(0.02, 0.032)], M["laiton"], x, y, lisse=30))
    boutons, plis = quinconce(2.14, 0.64, 0.24, [-0.16, 0.0, 0.16])
    parts.append(coussin(2.16, 0.66, 0.372, 0.088, M["velours"], boutons, plis, arrondi=0.075, bord=0.12))
    # Les boutons, drapés du même velours.
    parts += [sphere(bx, by, 0.372 + 0.088 - 0.026 + 0.004, 0.011, M["velours"], sz=0.55, n=10) for bx, by in boutons]
    return fondre(parts, "Banquette")


def banc_nef(M):
    L, W = 2.8, 0.6
    parts = []
    parts.append(boite(-1.4, 1.4, -0.3, 0.3, 0.30, 0.38, M["chene"], biseau=0.014, segments=3))
    for x in (-1.28, 0.0, 1.28):
        for y in (-0.22, 0.22):
            parts.append(tronc(x, y, 0.0, 0.30, 0.05, 0.075, M["chene"]))
        # L'entretoise en H : une traverse par paire de pieds…
        parts.append(boite(x - 0.022, x + 0.022, -0.22, 0.22, 0.09, 0.14, M["chene"], biseau=0.006))
    # … et la longue, au milieu.
    parts.append(boite(-1.28, 1.28, -0.025, 0.025, 0.095, 0.145, M["chene"], biseau=0.006))
    boutons, plis = quinconce(2.74, 0.54, 0.34, [-0.1, 0.1])
    parts.append(coussin(2.76, 0.56, 0.378, 0.08, M["cuir"], boutons, plis, arrondi=0.045, bord=0.45,
                         creux=0.018, r_bouton=0.024, pli=0.004, l_pli=0.016))
    parts += [sphere(bx, by, 0.378 + 0.08 - 0.018 + 0.003, 0.010, M["cuir"], sz=0.6, n=8) for bx, by in boutons]
    # Les clous de laiton, en rang serré au bas du cuir.
    pas = 0.05
    for s in (-1, 1):
        for k in range(int(2.7 / pas) + 1):
            parts.append(sphere(-1.35 + k * pas, s * 0.283, 0.39, 0.006, M["laiton"], sz=0.8, n=6))
        for k in range(int(0.5 / pas) + 1):
            parts.append(sphere(s * 1.383, -0.25 + k * pas, 0.39, 0.006, M["laiton"], sz=0.8, n=6))
    return fondre(parts, "BancNef")


def accueil(M):
    L, D = 2.8, 0.75
    y0 = -D / 2                      # la façade, côté visiteurs
    yc = -0.03                       # le dos du comptoir haut
    H, HB = 1.04, 0.74
    parts = []
    # Le comptoir haut : corps de noyer, plinthe et jonc de laiton.
    parts.append(boite(-L / 2, L / 2, y0 + 0.02, yc, 0.10, 0.98, M["noyer"], biseau=0.004))
    parts.append(boite(-L / 2 - 0.005, L / 2 + 0.005, y0 + 0.012, D / 2, 0.0, 0.10, M["laiton"], biseau=0.004))
    parts.append(boite(-L / 2 - 0.02, L / 2 + 0.02, y0 - 0.005, yc + 0.02, 0.98, H, M["noyer"], biseau=0.012, segments=3))
    parts.append(boite(-L / 2 - 0.022, L / 2 + 0.022, y0 - 0.008, yc + 0.02, 0.965, 0.978, M["laiton"], biseau=0.003))
    # Le dessus de marbre, qui déborde.
    parts.append(boite(-L / 2 - 0.05, L / 2 + 0.05, y0 - 0.05, yc + 0.03, H, H + 0.04, M["marbre"], biseau=0.012, segments=3))
    # La façade : pilastres et panneaux à table saillante.
    n = 4
    largeur = L / n
    for k in range(n + 1):
        x = -L / 2 + k * largeur
        parts.append(boite(x - 0.045, x + 0.045, y0 - 0.012, y0 + 0.03, 0.10, 0.965, M["noyer"], biseau=0.006))
        # Chapiteau et base de laiton sur chaque pilastre.
        parts.append(boite(x - 0.05, x + 0.05, y0 - 0.017, y0 + 0.03, 0.90, 0.92, M["laiton"], biseau=0.003))
    for k in range(n):
        xa, xb = -L / 2 + k * largeur + 0.07, -L / 2 + (k + 1) * largeur - 0.07
        parts.append(boite(xa, xb, y0 + 0.004, y0 + 0.022, 0.16, 0.86, M["noyer"], biseau=0.012, segments=3))
        parts.append(boite(xa + 0.05, xb - 0.05, y0 - 0.006, y0 + 0.01, 0.23, 0.79, M["noyer"], biseau=0.018, segments=2))
    # Les flancs, à panneau aussi.
    for s in (-1, 1):
        parts.append(boite(s * L / 2 - 0.02, s * L / 2 + 0.02, y0 + 0.02, D / 2, 0.10, HB, M["noyer"], biseau=0.004))
    # Le bureau derrière, plus bas, dessus de noyer.
    parts.append(boite(-L / 2, L / 2, yc, D / 2 - 0.02, 0.10, HB - 0.03, M["noyer"], biseau=0.004))
    parts.append(boite(-L / 2 - 0.01, L / 2 + 0.01, yc, D / 2, HB - 0.03, HB, M["noyer"], biseau=0.006))
    # La lampe de banquier : socle, tige, abat-jour vert en demi-cylindre.
    lx, ly = 0.95, (y0 + yc) / 2
    z = H + 0.04
    parts.append(tour([(0.0, z), (0.075, z), (0.075, z + 0.012), (0.06, z + 0.02), (0.02, z + 0.03), (0.0, z + 0.03)],
                      M["laiton"], lx, ly, n=24, lisse=40))
    parts.append(tour([(0.007, z + 0.03), (0.007, z + 0.33)], M["laiton"], lx, ly, n=10))
    parts.append(tour([(0.014, z + 0.10), (0.018, z + 0.12), (0.014, z + 0.14)], M["laiton"], lx, ly, n=12))
    ha = z + 0.36
    v, f = [], []
    na = 12
    for i in range(na + 1):
        a = math.pi * i / na
        for x in (-0.19, 0.19):
            v.append((lx + x, ly + 0.085 * math.cos(a) * 1.0, ha + 0.085 * math.sin(a) * 0.55 - 0.02))
    for i in range(na):
        a = 2 * i
        f.append((a, a + 1, a + 3, a + 2))
    ab = objet("abat-jour", v, f, M["abat_jour"], lisse=60)
    sol = ab.modifiers.new("Epaisseur", "SOLIDIFY")
    sol.thickness = 0.004
    appliquer(ab)
    parts.append(ab)
    # Les embouts de laiton de l'abat-jour, et la potence.
    for s in (-1, 1):
        parts.append(tour([(0.0, 0), (0.012, 0.0), (0.012, 0.01), (0.0, 0.01)], M["laiton"], 0, 0, n=12))
        e = parts[-1]
        e.rotation_euler = (0, math.pi / 2, 0)
        e.location = (lx + s * 0.19 - (0.01 if s > 0 else 0), ly, ha - 0.02)
        bpy.context.view_layer.update()
        e.data.transform(e.matrix_world)
        e.matrix_world.identity()
    parts.append(boite(lx - 0.006, lx + 0.006, ly - 0.006, ly + 0.006, z + 0.33, ha + 0.03, M["laiton"]))
    return fondre(parts, "Accueil")


def banc_pierre(M):
    """Deux dés et une dalle de granit, dressés au têtu : des éclats plans, pas une pâte molle."""
    parts = []
    grain = bpy.data.textures.new("Mobilier_Grain", "CLOUDS")
    grain.noise_scale = 0.09
    houle = bpy.data.textures.new("Mobilier_Houle", "CLOUDS")
    houle.noise_scale = 0.3
    for bloc in ((-0.6, -0.6 + 0.32, -0.19, 0.19, 0.0, 0.37), (0.6 - 0.32, 0.6, -0.19, 0.19, 0.0, 0.37),
                 (-0.8, 0.8, -0.25, 0.25, 0.35, 0.48)):
        dalle = bloc[4] > 0
        o = boite(*bloc, M["granit"], biseau=0.025, segments=1)
        sub = o.modifiers.new("Sub", "SUBSURF")
        sub.subdivision_type = "SIMPLE"
        sub.levels = sub.render_levels = 3
        for tex, force in ((grain, 0.018), (houle, 0.045 if dalle else 0.022)):
            d = o.modifiers.new("Taille", "DISPLACE")
            d.texture = tex
            d.strength = force
            d.mid_level = 0.5
            d.texture_coords = "GLOBAL"
        # Décimé très fort et rendu à facettes : les plans d'éclat d'une pierre taillée au têtu.
        dec = o.modifiers.new("Eclats", "DECIMATE")
        dec.ratio = 0.07
        appliquer(o)
        o.data.shade_flat()
        parts.append(o)
    return fondre(parts, "BancPierre")


def banc_jardin(M):
    L = 1.8
    parts = []
    for k, y in enumerate((-0.15, 0.0, 0.15)):
        parts.append(boite(-L / 2, L / 2, y - 0.064, y + 0.064, 0.40, 0.45, M["cedre"], biseau=0.008))
    for x in (-0.66, 0.66):
        # Le tréteau : deux pieds, une traverse sous les lattes, une autre en bas, tenons traversants.
        for y in (-0.16, 0.16):
            parts.append(boite(x - 0.045, x + 0.045, y - 0.045, y + 0.045, 0.0, 0.40, M["cedre"], biseau=0.006))
        parts.append(boite(x - 0.04, x + 0.04, -0.24, 0.24, 0.32, 0.40, M["cedre"], biseau=0.006))
        parts.append(boite(x - 0.03, x + 0.03, -0.2, 0.2, 0.08, 0.13, M["cedre"], biseau=0.005))
        for s in (-1, 1):
            parts.append(boite(x - 0.018, x + 0.018, s * 0.24 - 0.012 * (1 - s) / 2, s * 0.24 + 0.012 * (1 + s) / 2,
                               0.34, 0.38, M["cedre"], biseau=0.003))
    return fondre(parts, "BancJardin")


def banc_batllo(M):
    """
    Le banc double : des métaballes — os en capsules, assises et dossiers en
    ellipsoïdes — que le champ fond d'un seul tenant, avec des congés partout :
    le chêne sculpté de Gaudí, sans une ligne droite.
    """
    from mathutils import Quaternion, Vector

    mb = bpy.data.metaballs.new("BancBatllo")
    mb.resolution = mb.render_resolution = 0.009
    mb.threshold = 0.6
    VISIBLE = 0.575  # rayon visible d'une boule seule, en fraction de son rayon d'influence

    def ellipsoide(c, demi, rot=(0, 0, 0), negatif=False):
        """`demi` : les demi-axes visibles voulus, en mètres."""
        e = mb.elements.new(type="ELLIPSOID")
        r = max(demi) / VISIBLE
        e.co = c
        e.radius = r
        e.size_x, e.size_y, e.size_z = (d / VISIBLE / r for d in demi)
        from mathutils import Euler
        e.rotation = Euler(rot).to_quaternion()
        e.use_negative = negatif
        return e

    def os_(points):
        """Un os : une chaîne de (x, y, z, rayon visible), en capsules, renflé à chaque nœud."""
        for (x0, y0, z0, r0), (x1, y1, z1, r1) in zip(points, points[1:]):
            a, b = Vector((x0, y0, z0)), Vector((x1, y1, z1))
            e = mb.elements.new(type="CAPSULE")
            e.co = (a + b) / 2
            e.radius = min(r0, r1) / VISIBLE
            e.size_x = (b - a).length / 2
            e.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
        for x, y, z, r in points:
            e = mb.elements.new(type="BALL")
            e.co = (x, y, z)
            e.radius = r / VISIBLE

    for s in (-1, 1):
        cx = s * 0.33
        # L'assise : un plateau ovale, creusé en selle par une boule négative.
        ellipsoide((cx, -0.02, 0.43), (0.31, 0.25, 0.045))
        ellipsoide((cx, -0.02, 0.54), (0.2, 0.17, 0.08), negatif=True)
        # Le dossier : trois lobes sur un arc, penchés — une coquille qui enveloppe.
        for k, (dx, dy, dz, ry) in enumerate(((-0.15, 0.21, 0.74, 0.3), (0.0, 0.25, 0.69, 0.0), (0.15, 0.21, 0.74, -0.3))):
            ellipsoide((cx + dx, dy, dz), (0.13, 0.042, 0.16), rot=(math.radians(-12), 0, ry))
        # Pied avant, en os, genou renflé, pied évasé.
        os_([(s * 0.6, -0.2, 0.02, 0.05), (s * 0.59, -0.19, 0.14, 0.028), (s * 0.6, -0.18, 0.3, 0.04),
             (s * 0.56, -0.14, 0.42, 0.034)])
        # Pied arrière, qui monte d'un jet jusqu'au haut du dossier.
        os_([(s * 0.58, 0.2, 0.02, 0.05), (s * 0.58, 0.21, 0.14, 0.028), (s * 0.57, 0.22, 0.34, 0.04),
             (s * 0.6, 0.23, 0.56, 0.03), (s * 0.55, 0.25, 0.78, 0.035)])
        # L'accotoir, du genou avant au dossier.
        os_([(s * 0.6, -0.18, 0.3, 0.03), (s * 0.63, -0.1, 0.55, 0.028), (s * 0.62, 0.08, 0.6, 0.03),
             (s * 0.58, 0.22, 0.58, 0.03)])
        # L'entretoise, en arc sous l'assise.
        os_([(s * 0.59, 0.0, 0.16, 0.024), (s * 0.3, 0.0, 0.22, 0.022), (0.0, 0.0, 0.17, 0.026)])
    # Le montant central : il sépare les deux places et soude les deux dossiers.
    os_([(0.0, -0.2, 0.02, 0.055), (0.0, -0.19, 0.14, 0.03), (0.0, -0.17, 0.3, 0.04), (0.0, -0.12, 0.5, 0.034),
         (0.0, 0.02, 0.6, 0.036), (0.0, 0.2, 0.66, 0.04), (0.0, 0.24, 0.78, 0.04)])
    os_([(0.0, 0.2, 0.02, 0.05), (0.0, 0.21, 0.14, 0.028), (0.0, 0.22, 0.36, 0.04), (0.0, 0.12, 0.43, 0.04)])

    boule = bpy.data.objects.new("BancBatllo_mb", mb)
    bpy.context.collection.objects.link(boule)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(boule.evaluated_get(dg))
    bpy.data.objects.remove(boule)
    bpy.data.metaballs.remove(mb)
    o = bpy.data.objects.new("BancBatllo", me)
    bpy.context.collection.objects.link(o)
    lis = o.modifiers.new("Lisser", "SMOOTH")
    lis.iterations = 4
    dec = o.modifiers.new("Alleger", "DECIMATE")
    dec.ratio = 0.15
    appliquer(o)
    o.data.name = "BancBatllo"
    lier(o, M["batllo"])
    o.data.shade_smooth()
    return o


# ── Export et aperçu ──────────────────────────────────────────────────────

PIECES = ("Banquette", "BancNef", "Accueil", "BancBatllo", "BancPierre", "BancJardin")


def construire():
    repartir()
    M = matieres()
    banquette(M)
    banc_nef(M)
    accueil(M)
    banc_batllo(M)
    banc_pierre(M)
    banc_jardin(M)
    for nom in PIECES:
        o = bpy.data.objects[nom]
        print(f"  {nom:12s} {len(o.data.polygons):6d} faces, {len(o.data.vertices):6d} sommets")


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    print(f"mobilier : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


def apercu(dossier):
    """Une image par pièce, sous un ciel neutre : de quoi juger les proportions sans le musée."""
    from mathutils import Vector

    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 48
    except (TypeError, AttributeError):
        pass
    scene.render.resolution_x, scene.render.resolution_y = 900, 600
    monde = bpy.data.worlds.new("Ciel") if not scene.world else scene.world
    scene.world = monde
    monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1)
    fond.inputs["Strength"].default_value = 0.6
    sol = boite(-4, 4, -4, 4, -0.02, 0.0, matiere("Sol", (0.35, 0.34, 0.33), 0.8))
    soleil = bpy.data.lights.new("Soleil", "SUN")
    soleil.energy = 3.5
    so = bpy.data.objects.new("Soleil", soleil)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(so)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    for nom in [p for p in PIECES if not SEULES or p in SEULES]:
        for autre in PIECES:
            bpy.data.objects[autre].hide_render = autre != nom
        o = bpy.data.objects[nom]
        dim = max(o.dimensions.x, o.dimensions.y, o.dimensions.z)
        cible = Vector((0, 0, o.dimensions.z / 2))
        for suffixe, direction in (("", Vector((-0.55, -1.0, 0.5))), ("-dos", Vector((0.6, 1.0, 0.45)))):
            cam.location = cible + direction.normalized() * dim * 1.55
            cam.rotation_euler = (cible - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = str(dossier / f"{nom}{suffixe}.png")
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sol)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    construire()
    SEULES = args[args.index("--seules") + 1].split(",") if "--seules" in args else []
    if "--apercu" in args:
        apercu(args[args.index("--apercu") + 1])
    elif "--no-export" not in args:
        exporter()
