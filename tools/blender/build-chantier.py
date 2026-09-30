"""
La baraque du CHANTIER DU MUSÉE, sur la pelouse sud-ouest, générée par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-chantier.py
    blender --background --factory-startup --python tools/blender/build-chantier.py -- --apercu /tmp/chantier

Produit `public/assets/architecture/chantier.glb`, posé tel quel par
`src/scene/ChantierLayer.tsx` : modélisé dans le repère du plan (Blender x = x,
y = −z, z = hauteur), d'après `src/plan/chantier.json` — la même emprise, la
même porte, la même table que celles que la marche arrête (`src/plan/chantier.ts`).

Un atelier de chantier à la manière d'Orsay : une charpente de fer peint en vert
wagon, poteaux en I, fermes Polonceau à tirants, sous une verrière à deux pans ;
un lambris de planches (brun créosote dehors, pin clair dedans, où s'accroche le
journal) jusqu'à 2,60 m, un bandeau vitré au-dessus. Au pignon est, la porte à
deux battants vitrés, ouverts sur le jardin, et l'enseigne émaillée « Chantier
du musée ». Dedans, la table sur tréteaux, le plan du rez-de-chaussée déroulé,
des rouleaux, un casque, des caisses, et la baladeuse qui pend de la ferme.

Une matière par nom (`Chantier_*`), que la scène reconnaît ; tous les morceaux
d'une même matière sont fondus en un seul maillage : une douzaine d'appels de
dessin pour toute la baraque. Le bois porte ses nuances en couleurs de sommets.

Déterministe : les nuances des planches viennent d'un hachage de leur rang.
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "chantier.glb"
POLICE = ROOT / "public" / "assets" / "fonts" / "PTSerif-Regular.ttf"
PLAN = json.loads((ROOT / "src" / "plan" / "chantier.json").read_text())

E = PLAN["emprise"]
X0, Z0, X1, Z1 = E["x"], E["z"], E["x"] + E["width"], E["z"] + E["depth"]
ZC = (Z0 + Z1) / 2
COTE = PLAN["cote"]
MUR = PLAN["mur"]
PORTE = PLAN["porte"]
LAMBRIS = COTE + PLAN["lambris"]
EGOUT = COTE + PLAN["egout"]
FAITAGE = COTE + PLAN["faitage"]
TABLE = PLAN["table"]
SOCLE = COTE + 0.25
PLANCHER = COTE + 0.03
PA, PB = PORTE["z"] - PORTE["largeur"] / 2, PORTE["z"] + PORTE["largeur"] / 2
LINTEAU = COTE + 2.3
DEBORD = 0.35
# Le dessus de la sablière, d'où part le versant.
SABLIERE = EGOUT + 0.16
PENTE = (FAITAGE - SABLIERE) / (ZC - Z0)
FERMES = [X0 + 2 * k for k in range(int(round(E["width"] / 2)) + 1)]


def repartir():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.fonts):
        for d in list(coll):
            coll.remove(d)


# ── Les matières ────────────────────────────────────────────────────────────

MATIERES = {}


def matiere(nom, couleur, rugosite, metallique=0.0, emission=None, force=0.0, alpha=1.0, sommets=False):
    m = bpy.data.materials.new(f"Chantier_{nom}")
    m.use_nodes = True
    arbre = m.node_tree
    b = next(n for n in arbre.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    b.inputs["Metallic"].default_value = metallique
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = force
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    if sommets:
        # La nuance de chaque planche : l'attribut de couleur, lu tel quel par l'export glTF (COLOR_0).
        attr = arbre.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Nuance"
        arbre.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    MATIERES[nom] = {"mat": m, "v": [], "f": [], "c": [], "sommets": sommets}
    return nom


def creer_matieres():
    # Le vert wagon des fers d'Orsay, satiné.
    matiere("Fer", (0.035, 0.058, 0.048), 0.42, metallique=0.6)
    matiere("BoisDehors", (1, 1, 1), 0.82, sommets=True)
    matiere("Lambris", (1, 1, 1), 0.7, sommets=True)
    matiere("Plancher", (1, 1, 1), 0.66, sommets=True)
    matiere("Socle", (0.42, 0.39, 0.35), 0.9)
    matiere("Verre", (0.82, 0.9, 0.88), 0.04, alpha=0.16)
    matiere("Enseigne", (0.03, 0.09, 0.07), 0.28)
    matiere("Lettres", (0.9, 0.82, 0.62), 0.45)
    matiere("Laiton", (0.72, 0.52, 0.22), 0.3, metallique=1.0)
    matiere("Plan", (0.05, 0.14, 0.34), 0.75)
    matiere("Papier", (0.86, 0.83, 0.74), 0.8)
    matiere("Casque", (0.92, 0.62, 0.04), 0.35)
    # La baladeuse : 2700 K, réglée par la scène (plus vive la nuit).
    matiere("Ampoule", (1.0, 0.9, 0.75), 0.3, emission=(1.0, 0.68, 0.36), force=4.0)


# ── Les pièces, dans le repère du plan ──────────────────────────────────────


def B(x, y, z):
    """Du plan (x, hauteur, z) à Blender (x, −z, hauteur)."""
    return Vector((x, -z, y))


def ajouter(nom, verts, faces, couleur=(1, 1, 1)):
    m = MATIERES[nom]
    n = len(m["v"])
    m["v"].extend(verts)
    m["f"].extend(tuple(i + n for i in f) for f in faces)
    m["c"].extend([couleur] * len(verts))


CUBE_F = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]


def boite(nom, x0, x1, y0, y1, z0, z1, couleur=(1, 1, 1)):
    """Une boîte alignée : x0..x1, de y0 à y1 de haut, z0..z1."""
    pts = [B(x0, y0, z0), B(x1, y0, z0), B(x1, y0, z1), B(x0, y0, z1), B(x0, y1, z0), B(x1, y1, z0), B(x1, y1, z1), B(x0, y1, z1)]
    ajouter(nom, pts, CUBE_F, couleur)


def poutre(nom, a, b, largeur, hauteur, haut=Vector((0, 0, 1)), couleur=(1, 1, 1)):
    """Une poutre de section rectangulaire de a à b (points du plan), `haut` en Blender."""
    a, b = B(*a), B(*b)
    axe = (b - a).normalized()
    cote = axe.cross(haut).normalized() * (largeur / 2)
    dessus = cote.cross(axe).normalized() * (hauteur / 2)
    pts = []
    for p in (a, b):
        for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts.append(p + cote * s + dessus * t)
    ajouter(nom, pts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], couleur)


def profil_i(a, b, h=0.14, l=0.1, e=0.012, haut=Vector((0, 0, 1))):
    """Un fer en I de a à b : deux semelles et une âme. `haut` : le sens de l'âme."""
    A, Bb = B(*a), B(*b)
    axe = (Bb - A).normalized()
    ame = haut - axe * haut.dot(axe)
    ame.normalize()
    for s in (-1, 1):
        d = ame * (s * (h - e) / 2)
        pa = (A + d)
        pb = (Bb + d)
        poutre_b("Fer", pa, pb, l, e, ame)
    poutre_b("Fer", A, Bb, e, h - 2 * e, ame.cross(axe))


def poutre_b(nom, a, b, largeur, epaisseur, normale):
    """Une plaque de a à b (coordonnées Blender), large de `largeur`, épaisse de `epaisseur` le long de `normale`."""
    axe = (b - a).normalized()
    n = normale.normalized()
    cote = axe.cross(n).normalized() * (largeur / 2)
    ep = n * (epaisseur / 2)
    pts = []
    for p in (a, b):
        for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts.append(p + cote * s + ep * t)
    ajouter(nom, pts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])


def cylindre(nom, a, b, r, n=10, couleur=(1, 1, 1), bouts=True):
    A, Bb = B(*a), B(*b)
    axe = (Bb - A).normalized()
    u = axe.orthogonal().normalized()
    v = axe.cross(u)
    pts = [p + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r for p in (A, Bb) for k in range(n)]
    f = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    if bouts:
        f += [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    ajouter(nom, pts, f, couleur)


def sphere(nom, c, r, n=12, m=8, couleur=(1, 1, 1), bas=math.pi):
    """Une sphère (ou une calotte, jusqu'à l'angle polaire `bas`) centrée en c (plan)."""
    C = B(*c)
    pts = [C + Vector((0, 0, r))]
    for i in range(1, m + 1):
        t = bas * i / m
        for k in range(n):
            a = 2 * math.pi * k / n
            pts.append(C + Vector((r * math.sin(t) * math.cos(a), r * math.sin(t) * math.sin(a), r * math.cos(t))))
    f = [(0, 1 + (k + 1) % n, 1 + k) for k in range(n)]
    for i in range(m - 1):
        for k in range(n):
            a, b = 1 + i * n + k, 1 + i * n + (k + 1) % n
            f.append((a, b, b + n, a + n))
    if bas >= math.pi - 1e-6:
        pass
    else:
        f.append(tuple(1 + (m - 1) * n + k for k in range(n)))
    ajouter(nom, pts, f, couleur)


def nuance(i, base, ecart=0.14):
    """La couleur d'une planche : `base` éclaircie ou foncée d'un hachage de son rang."""
    h = ((i * 2654435761) % 4294967296) / 4294967296
    k = 1 + ecart * (2 * h - 1)
    return tuple(min(1.0, c * k) for c in base)


# ── Le bâti ─────────────────────────────────────────────────────────────────


def socle():
    # Un soubassement de pierre sous les murs : il descend sous la pelouse, la porte le coupe.
    y0 = COTE - 0.35
    s = 0.04
    boite("Socle", X0 - s, X1 + s, y0, SOCLE, Z0 - s, Z0 + MUR)
    boite("Socle", X0 - s, X1 + s, y0, SOCLE, Z1 - MUR, Z1 + s)
    boite("Socle", X0 - s, X0 + MUR, y0, SOCLE, Z0, Z1)
    boite("Socle", X1 - MUR, X1 + s, y0, SOCLE, Z0, PA)
    boite("Socle", X1 - MUR, X1 + s, y0, SOCLE, PB, Z1)
    # Le seuil de pierre de la porte, au ras du plancher.
    boite("Socle", X1 - MUR, X1 + 0.35, y0, PLANCHER, PA, PB)


def plancher():
    # Des lames de 18 cm, d'est en ouest, posées sur la plate-forme.
    brun = (0.34, 0.22, 0.13)
    z, i = Z0 + MUR, 0
    while z < Z1 - MUR - 1e-6:
        z1 = min(z + 0.18, Z1 - MUR)
        boite("Plancher", X0 + MUR, X1 - MUR, COTE - 0.05, PLANCHER, z + 0.002, z1 - 0.002, nuance(i, brun, 0.22))
        z, i = z1, i + 1
    # Sous les joints, un fond sombre : pas de jour entre les lames.
    boite("Plancher", X0 + MUR, X1 - MUR, COTE - 0.06, PLANCHER - 0.01, Z0 + MUR, Z1 - MUR, (0.05, 0.03, 0.02))


def murs():
    """Les murs de planches : le noyau, les couvre-joints dehors, le lambris dedans."""
    creosote = (0.09, 0.055, 0.035)
    pin = (0.62, 0.43, 0.24)
    # Les pans de mur : (axe, position de la face extérieure, sens vers le dedans, de, à).
    pans = [("x", Z0, 1, X0, X1), ("x", Z1, -1, X0, X1), ("z", X0, 1, Z0, Z1), ("z", X1, -1, Z0, PA), ("z", X1, -1, PB, Z1)]
    for k, (axe, pos, sens, u0, u1) in enumerate(pans):
        dedans = pos + sens * MUR

        def mur(nom, a, b, y0, y1, p0, p1, c=(1, 1, 1)):
            q0, q1 = min(p0, p1), max(p0, p1)
            if axe == "x":
                boite(nom, a, b, y0, y1, q0, q1, c)
            else:
                boite(nom, q0, q1, y0, y1, a, b, c)

        # Le noyau des planches, brun sombre.
        mur("BoisDehors", u0, u1, SOCLE, LAMBRIS, pos, dedans - sens * 0.02, creosote)
        # Les couvre-joints, tous les 30 cm.
        u, i = u0 + 0.12, 0
        while u < u1 - 0.1:
            mur("BoisDehors", u - 0.03, u + 0.03, SOCLE, LAMBRIS - 0.02, pos, pos - sens * 0.022, nuance(k * 100 + i, creosote, 0.3))
            u, i = u + 0.3, i + 1
        # Le lambris du dedans : des planches de 15 cm, en travers, un joint de 5 mm.
        y, i = PLANCHER, 0
        while y < LAMBRIS - 1e-6:
            y1 = min(y + 0.15, LAMBRIS)
            mur("Lambris", u0 + (0 if axe == "x" else 0), u1, y + 0.0025, y1 - 0.0025, dedans - sens * 0.02, dedans, nuance(k * 100 + i, pin, 0.16))
            y, i = y1, i + 1
        # Le fond du joint, et la plinthe foncée au pied.
        mur("Lambris", u0, u1, PLANCHER, LAMBRIS, dedans - sens * 0.021, dedans - sens * 0.004, (0.16, 0.1, 0.05))
        mur("Lambris", u0, u1, PLANCHER, PLANCHER + 0.12, dedans - sens * 0.02, dedans + sens * 0.012, (0.2, 0.12, 0.06))
        # La cimaise de chêne, à 2,45 m : la ligne d'où l'on accroche.
        mur("Lambris", u0, u1, COTE + 2.42, COTE + 2.47, dedans - sens * 0.02, dedans + sens * 0.03, (0.3, 0.19, 0.09))
        # Le chapeau du lambris, sous le vitrage.
        mur("Fer", u0, u1, LAMBRIS, LAMBRIS + 0.04, pos - sens * 0.01, dedans + sens * 0.01)
    # Le dedans des angles : le lambris des long murs passe devant celui des pignons.
    # Au-dessus de la porte, un linteau de planches jusqu'au lambris.
    boite("BoisDehors", X1 - MUR, X1, LINTEAU, LAMBRIS, PA, PB, creosote)
    boite("Lambris", X1 - MUR - 0.02, X1 - MUR, LINTEAU, LAMBRIS, PA, PB, (0.5, 0.34, 0.18))
    # Le chambranle de la porte, en fer.
    for z in (PA, PB):
        boite("Fer", X1 - MUR - 0.03, X1 + 0.03, SOCLE, LINTEAU, z - 0.04 if z == PA else z, z if z == PA else z + 0.04)
    boite("Fer", X1 - MUR - 0.03, X1 + 0.03, LINTEAU, LINTEAU + 0.08, PA - 0.04, PB + 0.04)


def vitrages():
    """Le bandeau vitré au-dessus du lambris, et les pignons vitrés jusqu'au faîtage."""
    # Les longs pans : une vitre entre lambris et sablière, un petit fer tous les mètres.
    for z, s in ((Z0, 1), (Z1, -1)):
        e = z + s * MUR / 2
        ajouter("Verre", [B(X0, LAMBRIS + 0.04, e), B(X1, LAMBRIS + 0.04, e), B(X1, EGOUT, e), B(X0, EGOUT, e)], [(0, 1, 2, 3)])
        x = X0
        while x <= X1 + 1e-6:
            boite("Fer", x - 0.02, x + 0.02, LAMBRIS + 0.04, EGOUT, e - 0.025, e + 0.025)
            x += 1.0
    # Les pignons : bandeau puis triangle, un fer tous les mètres, montant jusqu'au rampant.
    for x, s in ((X0, 1), (X1, -1)):
        e = x + s * MUR / 2
        ajouter("Verre", [B(e, LAMBRIS + 0.04, Z0), B(e, LAMBRIS + 0.04, Z1), B(e, EGOUT, Z1), B(e, EGOUT, Z0)], [(0, 1, 2, 3)])
        ajouter("Verre", [B(e, SABLIERE, Z0), B(e, SABLIERE, Z1), B(e, FAITAGE, ZC)], [(0, 1, 2)])
        z = Z0 + 1.0
        while z < Z1 - 0.5:
            haut = FAITAGE - PENTE * abs(z - ZC)
            boite("Fer", e - 0.025, e + 0.025, LAMBRIS + 0.04, haut, z - 0.02, z + 0.02)
            z += 1.0
        # Une traverse à l'égout.
        boite("Fer", e - 0.03, e + 0.03, EGOUT - 0.02, SABLIERE, Z0, Z1)


def charpente():
    """Les poteaux en I, les sablières, les fermes Polonceau, les chevrons de la verrière."""
    # Les poteaux, contre la face extérieure des longs murs, tous les deux mètres.
    # Les semelles parallèles au mur : l'âme suit sa normale (Blender y pour les longs pans).
    for x in FERMES:
        for z, s in ((Z0, -1), (Z1, 1)):
            zp = z + s * 0.06
            profil_i((x, SOCLE, zp), (x, SABLIERE, zp), h=0.12, l=0.1, haut=Vector((0, 1, 0)))
            # Un sabot de fonte au pied.
            boite("Fer", x - 0.08, x + 0.08, SOCLE - 0.01, SOCLE + 0.06, zp - 0.08, zp + 0.08)
    # Deux poteaux au pignon du fond ; celui de la porte n'a que ses angles, les battants s'y rabattent.
    for z in (Z0 + 2.33, Z1 - 2.33):
        profil_i((X0 - 0.06, SOCLE, z), (X0 - 0.06, SABLIERE, z), h=0.12, l=0.1, haut=Vector((1, 0, 0)))
    # Les sablières, en I couché, le long des longs pans.
    for z, s in ((Z0, -1), (Z1, 1)):
        profil_i((X0 - DEBORD, EGOUT + 0.08, z + s * 0.02), (X1 + DEBORD, EGOUT + 0.08, z + s * 0.02), h=0.16, l=0.12)
        # Le chéneau de zinc, au bout du versant.
        zg = z + s * (DEBORD + 0.02)
        yg = SABLIERE - PENTE * DEBORD - 0.06
        boite("Fer", X0 - DEBORD, X1 + DEBORD, yg - 0.05, yg + 0.02, zg - 0.06, zg + 0.06)
    # Les fermes Polonceau : deux arbalétriers en I, un tirant, un poinçon, deux bielles.
    for x in FERMES:
        haut = Vector((0, 0, 1))
        for z, s in ((Z0, -1), (Z1, 1)):
            a = (x, SABLIERE - PENTE * DEBORD, z + s * DEBORD)
            profil_i(a, (x, FAITAGE - 0.06, ZC), h=0.12, l=0.08, haut=haut)
        if x in (FERMES[0], FERMES[-1]):
            continue
        yt = EGOUT + 0.02
        cylindre("Fer", (x, yt, Z0 + 0.1), (x, yt, Z1 - 0.1), 0.014)
        cylindre("Fer", (x, yt, ZC), (x, FAITAGE - 0.1, ZC), 0.02)
        for z in (Z0 + 1.2, Z1 - 1.2):
            ym = SABLIERE + PENTE * ((ZC - Z0) - abs(z - ZC)) - 0.08
            cylindre("Fer", (x, yt, ZC), (x, ym, z), 0.012)
        # Les goussets de laiton aux nœuds.
        sphere("Laiton", (x, yt, ZC), 0.035, n=8, m=5)
    # Le faîtage, en fer plat, et ses deux épis de faîtage aux pignons.
    boite("Fer", X0 - DEBORD, X1 + DEBORD, FAITAGE - 0.02, FAITAGE + 0.07, ZC - 0.07, ZC + 0.07)
    for x in (X0 - DEBORD + 0.05, X1 + DEBORD - 0.05):
        cylindre("Fer", (x, FAITAGE + 0.07, ZC), (x, FAITAGE + 0.5, ZC), 0.018)
        sphere("Laiton", (x, FAITAGE + 0.34, ZC), 0.05, n=10, m=6)
        cylindre("Fer", (x, FAITAGE + 0.5, ZC), (x, FAITAGE + 0.62, ZC), 0.006)
    # La verrière : deux pans de verre sur des petits fers tous les mètres.
    for z, s in ((Z0, -1), (Z1, 1)):
        ze = z + s * DEBORD
        ye = SABLIERE - PENTE * DEBORD + 0.07
        ajouter("Verre", [B(X0 - DEBORD, ye, ze), B(X1 + DEBORD, ye, ze), B(X1 + DEBORD, FAITAGE + 0.01, ZC), B(X0 - DEBORD, FAITAGE + 0.01, ZC)], [(0, 1, 2, 3)])
        x = X0 - DEBORD
        while x <= X1 + DEBORD + 1e-6:
            poutre("Fer", (x, ye, ze), (x, FAITAGE, ZC), 0.035, 0.05)
            x += 1.0
        # Deux pannes le long du versant.
        for t in (0.33, 0.66):
            zp = ze + (ZC - ze) * t
            yp = ye + (FAITAGE - ye) * t - 0.04
            poutre("Fer", (X0, yp, zp), (X1, yp, zp), 0.05, 0.04)


def porte():
    """Deux battants vitrés, grands ouverts contre la façade est."""
    l = PORTE["largeur"] / 2
    for z0, s in ((PA, -1), (PB, 1)):
        # Le battant pivote sur son gond et se rabat contre le mur, vers le dehors.
        xg = X1 + 0.05
        zf = z0 + s * l
        a, b = (xg, 0, z0), (xg, 0, zf)
        for y0, y1 in ((SOCLE, SOCLE + 0.06), (LINTEAU - 0.1, LINTEAU - 0.04), (COTE + 0.95, COTE + 1.0)):
            boite("Fer", xg, xg + 0.04, y0, y1, min(z0, zf), max(z0, zf))
        for z in (z0, zf):
            boite("Fer", xg, xg + 0.04, SOCLE, LINTEAU - 0.04, min(z, z + s * 0.05), max(z, z + s * 0.05))
        # Le bas du battant plein, en planches ; le haut vitré.
        boite("BoisDehors", xg + 0.01, xg + 0.03, SOCLE + 0.06, COTE + 0.95, min(z0, zf), max(z0, zf), (0.1, 0.06, 0.04))
        ajouter("Verre", [B(xg + 0.02, COTE + 1.0, z0), B(xg + 0.02, COTE + 1.0, zf), B(xg + 0.02, LINTEAU - 0.1, zf), B(xg + 0.02, LINTEAU - 0.1, z0)], [(0, 1, 2, 3)])
        # La poignée de laiton.
        cylindre("Laiton", (xg + 0.05, COTE + 1.05, zf - s * 0.1), (xg + 0.12, COTE + 1.05, zf - s * 0.1), 0.012, n=8)


def texte(nom, chaine, taille, centre, epaisseur=0.004):
    """Un texte de la police du musée, extrudé, posé à plat sur la façade est (tourné vers +x)."""
    cu = bpy.data.curves.new("texte", "FONT")
    cu.body = chaine
    cu.font = bpy.data.fonts.load(str(POLICE))
    cu.size = taille
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = epaisseur / 2
    cu.resolution_u = 6
    o = bpy.data.objects.new("texte", cu)
    bpy.context.collection.objects.link(o)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    # Le texte est dessiné dans le plan (x, y) de Blender, face à +z : on le lève sur la façade, face à +x (est).
    cx, cy, cz = centre
    rot = Matrix.Rotation(math.pi / 2, 4, "X")
    rot = Matrix.Rotation(math.pi / 2, 4, "Z") @ rot
    t = Matrix.Translation(B(cx, cy, cz)) @ rot
    verts = [t @ v.co for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    bpy.data.meshes.remove(me)
    ajouter(nom, verts, faces)


def enseigne():
    """L'enseigne émaillée au-dessus de la porte : vert sombre, filet d'or, lettres crème."""
    x = X1 + 0.08
    y0, y1 = COTE + 2.6, COTE + 3.2
    za, zb = PORTE["z"] - 1.7, PORTE["z"] + 1.7
    boite("Enseigne", x, x + 0.04, y0, y1, za, zb)
    # Le filet de laiton, à 3 cm du bord.
    for (ya, yb, z0, z1) in ((y0 + 0.03, y0 + 0.042, za + 0.03, zb - 0.03), (y1 - 0.042, y1 - 0.03, za + 0.03, zb - 0.03),
                             (y0 + 0.03, y1 - 0.03, za + 0.03, za + 0.042), (y0 + 0.03, y1 - 0.03, zb - 0.042, zb - 0.03)):
        boite("Laiton", x + 0.04, x + 0.046, ya, yb, z0, z1)
    texte("Lettres", "CHANTIER DU MUSÉE", 0.25, (x + 0.043, COTE + 2.95, PORTE["z"]))
    texte("Lettres", "journal des travaux  ·  entrée libre", 0.085, (x + 0.043, COTE + 2.74, PORTE["z"]))
    # Deux pattes de fer qui la tiennent au lambris.
    for z in (za + 0.3, zb - 0.3):
        boite("Fer", X1, x, y0 + 0.1, y0 + 0.14, z - 0.02, z + 0.02)
        boite("Fer", X1, x, y1 - 0.14, y1 - 0.1, z - 0.02, z + 0.02)


# ── Le mobilier du chantier ─────────────────────────────────────────────────


def treteaux():
    """La table : un plateau de planches sur deux tréteaux en A."""
    tx, tz, L, P, H = TABLE["x"], TABLE["z"], TABLE["largeur"], TABLE["profondeur"], COTE + TABLE["hauteur"]
    sapin = (0.55, 0.38, 0.2)
    for i in range(4):
        z0 = tz - P / 2 + i * P / 4
        boite("Plancher", tx - L / 2, tx + L / 2, H - 0.04, H, z0 + 0.003, z0 + P / 4 - 0.003, nuance(40 + i, sapin, 0.2))
    for dx in (-0.85, 0.85):
        x = tx + dx
        # La traverse sous le plateau, et les pieds en A qui s'écartent.
        boite("Plancher", x - 0.05, x + 0.05, H - 0.12, H - 0.04, tz - P / 2 + 0.05, tz + P / 2 - 0.05, nuance(50, sapin))
        for sz in (-1, 1):
            for sx in (-1, 1):
                haut = (x + sx * 0.03, H - 0.1, tz + sz * (P / 2 - 0.12))
                bas = (x + sx * 0.22, PLANCHER, tz + sz * (P / 2 - 0.02))
                poutre("Plancher", haut, bas, 0.06, 0.045, couleur=nuance(60 + sx + 2 * sz, sapin))
        boite("Plancher", x - 0.2, x + 0.2, COTE + 0.3, COTE + 0.34, tz - 0.02, tz + 0.02, nuance(70, sapin))


def plans():
    """Sur la table : le plan du rez-de-chaussée déroulé, des rouleaux, un casque, une règle."""
    tx, tz, H = TABLE["x"], TABLE["z"], COTE + TABLE["hauteur"]
    # La feuille bleue, au 1/50 : les salles du rez-de-chaussée de `musee.ts`, en traits blancs.
    k, (ox, oz) = 1 / 50, (tx - 0.55, tz - 0.4)
    boite("Plan", ox - 0.04, ox + 48 * k + 0.04, H, H + 0.002, oz - 0.04, oz + 40 * k + 0.04)
    salles = [(0, 0, 16, 13), (0, 13, 16, 14), (0, 27, 16, 13), (16, 0, 16, 12), (32, 0, 16, 13), (32, 13, 16, 14), (32, 27, 16, 13), (16, 12, 16, 28)]
    t = 0.004
    for x, z, w, d in salles:
        x0, z0, x1, z1 = ox + x * k, oz + z * k, ox + (x + w) * k, oz + (z + d) * k
        for a in ((x0, x1, z0, z0 + t), (x0, x1, z1 - t, z1), (x0, x0 + t, z0, z1), (x1 - t, x1, z0, z1)):
            boite("Papier", a[0], a[1], H + 0.002, H + 0.003, a[2], a[3])
    # Le cartouche, en bas à droite, et les presse-papiers aux coins.
    boite("Papier", ox + 0.72, ox + 0.96, H + 0.002, H + 0.003, oz + 0.7, oz + 0.8)
    for (px, pz) in ((ox - 0.02, oz - 0.02), (ox + 0.98, oz + 0.82)):
        boite("Fer", px - 0.03, px + 0.03, H + 0.002, H + 0.03, pz - 0.02, pz + 0.02)
    # Les rouleaux, couchés au bout de la table, papier et calque bleu.
    for i, (dz, mat) in enumerate(((-0.3, "Papier"), (-0.2, "Plan"), (-0.1, "Papier"))):
        cylindre(mat, (tx + 0.72, H + 0.035, tz + dz), (tx + 1.15, H + 0.035, tz + dz + 0.04 * (i - 1)), 0.033, n=12)
    cylindre("Papier", (tx + 0.8, H + 0.1, tz + 0.05), (tx + 1.18, H + 0.1, tz - 0.12), 0.03, n=12)
    # Le casque de chantier, posé sur son bord.
    sphere("Casque", (tx + 0.85, H + 0.015, tz + 0.28), 0.13, n=16, m=6, bas=math.pi / 2)
    cylindre("Casque", (tx + 0.85, H + 0.01, tz + 0.28), (tx + 0.85, H + 0.02, tz + 0.28), 0.16, n=16)
    # La règle pliante de menuisier, dépliée sur le plan.
    boite("Casque", tx - 0.5, tx + 0.35, H + 0.003, H + 0.008, tz + 0.36, tz + 0.38)


def baladeuse():
    """La lampe de chantier qui pend du tirant de la ferme au-dessus de la table : fil, douille, cage, ampoule."""
    tx, tz = TABLE["x"], TABLE["z"]
    haut, y = EGOUT + 0.02, COTE + 2.05
    cylindre("Fer", (tx, haut, tz), (tx, y + 0.22, tz), 0.005, n=6)
    # Le crochet et la poignée de bakélite.
    cylindre("Fer", (tx, y + 0.22, tz), (tx, y + 0.1, tz), 0.018, n=10)
    cylindre("Laiton", (tx, y + 0.1, tz), (tx, y + 0.06, tz), 0.024, n=10)
    sphere("Ampoule", (tx, y - 0.02, tz), 0.045, n=12, m=8)
    # La cage : six côtes de fer et deux cerceaux.
    for k in range(6):
        a = 2 * math.pi * k / 6
        cylindre("Fer", (tx, y + 0.06, tz), (tx + 0.07 * math.cos(a), y - 0.03, tz + 0.07 * math.sin(a)), 0.004, n=5, bouts=False)
        cylindre("Fer", (tx + 0.07 * math.cos(a), y - 0.03, tz + 0.07 * math.sin(a)), (tx, y - 0.12, tz), 0.004, n=5, bouts=False)
    for r, yy in ((0.07, y - 0.03), (0.035, y - 0.1)):
        for k in range(12):
            a, b = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
            cylindre("Fer", (tx + r * math.cos(a), yy, tz + r * math.sin(a)), (tx + r * math.cos(b), yy, tz + r * math.sin(b)), 0.004, n=5, bouts=False)


def caisses():
    """Deux caisses de bois dans l'angle nord-ouest, une dans l'angle sud-ouest : sous la frise."""
    sapin = (0.5, 0.35, 0.18)
    for i, (x, z, c, h) in enumerate(((X0 + 0.55, Z0 + 0.5, 0.6, 0.45), (X0 + 1.25, Z0 + 0.45, 0.5, 0.38), (X0 + 0.5, Z1 - 0.5, 0.55, 0.42))):
        y0 = PLANCHER
        boite("Plancher", x - c / 2, x + c / 2, y0, y0 + h, z - c / 2 + 0.02, z + c / 2 - 0.02, nuance(80 + i, sapin, 0.1))
        # Les liteaux qui ceinturent la caisse.
        for yy in (y0 + 0.04, y0 + h - 0.08):
            boite("Plancher", x - c / 2 - 0.01, x + c / 2 + 0.01, yy, yy + 0.05, z - c / 2 + 0.01, z + c / 2 - 0.01, nuance(90 + i, sapin, 0.3))
    # Un rouleau de plans debout dans la caisse du sud-ouest.
    for k, dz in enumerate((-0.1, 0.05, 0.12)):
        cylindre("Papier" if k != 1 else "Plan", (X0 + 0.5 + dz * 0.5, PLANCHER + 0.3, Z1 - 0.5 + dz), (X0 + 0.5 + dz * 0.7, PLANCHER + 1.05 - 0.1 * k, Z1 - 0.5 + dz), 0.035, n=10)


# ── Assemblage ──────────────────────────────────────────────────────────────


def assembler():
    racine = bpy.data.objects.new("Chantier", None)
    bpy.context.collection.objects.link(racine)
    total = 0
    for nom, m in MATIERES.items():
        if not m["v"]:
            continue
        me = bpy.data.meshes.new(f"Chantier_{nom}")
        me.from_pydata(m["v"], [], m["f"])
        if m["sommets"]:
            attr = me.color_attributes.new("Nuance", "BYTE_COLOR", "POINT")
            for i, c in enumerate(m["c"]):
                attr.data[i].color = (*c, 1.0)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(m["mat"])
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(35))
        o = bpy.data.objects.new(f"Chantier_{nom}", me)
        bpy.context.collection.objects.link(o)
        o.parent = racine
        total += sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"  Chantier : {total} triangles, {sum(1 for m in MATIERES.values() if m['v'])} maillages")


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    print(f"chantier : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


def apercu(dossier):
    """Un rendu de contrôle, Cycles : la baraque depuis l'axe de l'entrée, et le dedans vers le pignon du fond."""
    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.view_settings.view_transform = "AgX"
    monde = bpy.data.worlds.new("Ciel")
    scene.world = monde
    monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.55, 0.7, 0.95, 1)
    fond.inputs["Strength"].default_value = 0.9
    sol = bpy.data.meshes.new("Sol")
    sol.from_pydata([B(-20, COTE - 0.01, 40), B(40, COTE - 0.01, 40), B(40, COTE - 0.01, 80), B(-20, COTE - 0.01, 80)], [], [(0, 1, 2, 3)])
    herbe = bpy.data.materials.new("Herbe")
    herbe.use_nodes = True
    next(n for n in herbe.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.12, 0.25, 0.06, 1)
    sol.materials.append(herbe)
    so = bpy.data.objects.new("Sol", sol)
    scene.collection.objects.link(so)
    soleil = bpy.data.lights.new("Soleil", "SUN")
    soleil.energy = 4.0
    soleil.angle = math.radians(2)
    sl = bpy.data.objects.new("Soleil", soleil)
    sl.rotation_euler = (math.radians(40), 0, math.radians(-150))
    scene.collection.objects.link(sl)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 24
    scene.collection.objects.link(cam)
    scene.camera = cam
    for nom, oeil, cible in (("dehors", (22, COTE + 1.7, 52), (8, COTE + 2.0, 59.5)),
                             ("dedans", (12.2, COTE + 1.62, 60.3), (1, COTE + 1.5, 59)),
                             ("enseigne", (17.5, COTE + 1.8, 60.5), (13, COTE + 2.6, 59.5))):
        cam.location = B(*oeil)
        cam.rotation_euler = (B(*cible) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(dossier / f"{nom}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    repartir()
    creer_matieres()
    socle()
    plancher()
    murs()
    vitrages()
    charpente()
    porte()
    enseigne()
    treteaux()
    plans()
    baladeuse()
    caisses()
    assembler()
    if "--apercu" in args:
        apercu(args[args.index("--apercu") + 1])
    else:
        exporter()
