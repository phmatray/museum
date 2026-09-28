"""
La baie de la salle d'honneur, à la manière de la Casa Batlló, générée par
Blender en headless.

    blender --background --factory-startup --python tools/blender/build-batllo.py

Produit `public/assets/architecture/batllo.glb` : la grande fenêtre de l'étage
noble du passeig de Gràcia (Gaudí, 1906), transposée dans la baie de 6 m qui
ouvre la salle d'honneur sur le hall (x 21–27, du plancher +4,80 au plafond
+9,30, mur en z 11,85–12,15). Deux colonnes de pierre en os, aux genoux
renflés ; des arcs souples ; une menuiserie de chêne miel aux meneaux ondulés ;
en bas des vitres claires aux coins ronds et une rangée d'ovales ; en haut un
bandeau de vitrail en cives bleues, turquoise, vertes, blanches et quelques
violettes, serties de plomb ; une fleur de bois sculpté au centre.

Même repère que la nef, dont on reprend les outils (`build-nef.py`) : x Blender
= x du plan, y Blender = −z du plan, z Blender = la hauteur. Les pièces plates
sont des courbes 2D dessinées dans le plan de la baie (u = x, v = hauteur),
couchées dans le mur d'un quart de tour : le z local devient le z du plan, et
le côté du hall est celui des w positifs.

Déterministe : le tirage des couleurs du vitrail est semé.
"""

import importlib.util
import math
import random
import sys
from pathlib import Path

import bpy

ICI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("nef", ICI / "build-nef.py")
nef = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nef)
SORTIE = ICI.parents[1] / "public" / "assets" / "architecture" / "batllo.glb"

# ── La baie, lue dans src/plan/musee.ts ───────────────────────────────────
X0, X1 = 21.0, 27.0          # les tableaux de la baie
SOL, PLAFOND = 4.8, 9.3      # plancher de l'étage, sous-face de la dalle
ZM = 12.0                    # l'axe du mur
COLS = (22.5, 25.5)          # les deux colonnes : trois travées, la grande au milieu
NAISS = 7.3                  # naissance des arcs, sur les chapiteaux
FLECHES = (0.42, 0.62, 0.42)
BAS = 5.45                   # haut de l'allège aux ovales
TRAVERSE = 6.45              # la traverse ondulée des vitres claires
CADRE = 0.14                 # largeur du dormant
BOIS = 0.07                  # demi-épaisseur de la menuiserie
BISEAU = 0.015               # l'arrondi des arêtes de chêne


# ── Géométrie plane ───────────────────────────────────────────────────────


def arrondir(poly, r, n=4, seuil=math.radians(25)):
    """Adoucit les angles vifs d'un polygone (Bézier quadratique de rayon ≈ r) ; les courbes déjà lisses restent."""
    k = len(poly)
    rs = r if isinstance(r, (list, tuple)) else [r] * k
    out = []
    for i in range(k):
        p0, p, p1 = poly[i - 1], poly[i], poly[(i + 1) % k]
        a0 = math.atan2(p[1] - p0[1], p[0] - p0[0])
        a1 = math.atan2(p1[1] - p[1], p1[0] - p[0])
        virage = abs((a1 - a0 + math.pi) % (2 * math.pi) - math.pi)
        if virage < seuil or rs[i] <= 0:
            out.append(p)
            continue

        def vers(q):
            d = math.dist(p, q)
            t = min(rs[i], d / 2) / d
            return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

        a, b = vers(p0), vers(p1)
        for j in range(n + 1):
            s = j / n
            out.append(((1 - s) ** 2 * a[0] + 2 * (1 - s) * s * p[0] + s * s * b[0],
                        (1 - s) ** 2 * a[1] + 2 * (1 - s) * s * p[1] + s * s * b[1]))
    # Deux angles voisins sur un côté court se touchent : pas de sommet en double.
    return [q for i, q in enumerate(out) if math.dist(q, out[i - 1]) > 1e-4]


def couper(poly, axe, borne, garder_sous):
    """Sutherland–Hodgman contre une droite u = borne (axe 0) ou v = borne (axe 1)."""
    dedans = (lambda p: p[axe] <= borne) if garder_sous else (lambda p: p[axe] >= borne)
    out = []
    for i, p in enumerate(poly):
        q = poly[i - 1]
        if dedans(p) != dedans(q):
            t = (borne - q[axe]) / (p[axe] - q[axe])
            out.append((q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t))
        if dedans(p):
            out.append(p)
    return out


def dedans(p, poly):
    c = False
    for i, a in enumerate(poly):
        b = poly[i - 1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def cercle(cx, cy, r, n=24):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def arc(xa, xb, fleche, retrait=0.0, n=24):
    """La ligne d'un arc en demi-ellipse, de droite à gauche ; `retrait` donne l'intrados."""
    cx, a, b = (xa + xb) / 2, (xb - xa) / 2 - retrait, fleche - retrait
    return [(cx + a * math.cos(math.pi * i / n), NAISS + b * math.sin(math.pi * i / n)) for i in range(n + 1)]


def onduler(poly):
    """
    Le chêne de Gaudí n'a pas de ligne droite : un même champ ondule tous les
    jours de vitre, si bien que deux vitres voisines ondulent ensemble et que le
    meneau entre elles serpente sans changer de largeur.
    """
    return [(x + 0.045 * math.sin(2.4 * y + 1.3 * x),
             y + 0.035 * math.sin(2.1 * x) * min(1.0, max(0.0, (7.0 - y) / 0.4))) for x, y in poly]


def travees():
    """(bord gauche, bord droit, arc) des trois travées : du tableau ou de la colonne, à l'arc."""
    bornes = (X0, *COLS, X1)
    for i in range(3):
        xa, xb = bornes[i], bornes[i + 1]
        h0 = X0 + CADRE if i == 0 else xa + 0.1
        h1 = X1 - CADRE if i == 2 else xb - 0.1
        yield i, xa, xb, h0, h1


def vitres_claires():
    """Les jours de la menuiserie basse : deux étages de vitres sous chaque arc, et l'allège aux ovales."""
    jours = []
    for i, xa, xb, h0, h1 in travees():
        haut = [(min(max(x, h0), h1), y) for x, y in arc(xa, xb, FLECHES[i], retrait=0.07)]
        baie = [(h0, BAS), (h1, BAS), *haut]
        etages = [couper(baie, 1, TRAVERSE - 0.05, True), couper(baie, 1, TRAVERSE + 0.05, False)]
        for e in etages:
            morceaux = [couper(e, 0, 23.95, True), couper(e, 0, 24.05, False)] if i == 1 else [e]
            jours += [onduler(arrondir(m, 0.12)) for m in morceaux]
        n = 3 if i != 1 else 6
        pas = (h1 - h0) / n
        rx = min(0.16, pas / 2 - 0.06)
        for k in range(n):
            jours.append(onduler([(h0 + pas * (k + 0.5) + rx * math.cos(2 * math.pi * j / 24),
                                   5.12 + 0.17 * math.sin(2 * math.pi * j / 24)) for j in range(24)]))
    return jours


def bas_du_vitrail(x):
    return 8.08 + 0.06 * math.cos(2 * math.pi * (x - 24.0) / 3.0)


def panneaux():
    """Les trois panneaux du bandeau de vitrail, au bas ondulé, au-dessus des arcs."""
    out = []
    for g, d in ((X0 + CADRE, COLS[0] - 0.07), (COLS[0] + 0.07, COLS[1] - 0.07), (COLS[1] + 0.07, X1 - CADRE)):
        bas = [(g + (d - g) * k / 16, bas_du_vitrail(g + (d - g) * k / 16)) for k in range(17)]
        out.append(arrondir([*bas, (d, PLAFOND - 0.16), (g, PLAFOND - 0.16)], 0.16))
    return out


# ── Le vitrail ────────────────────────────────────────────────────────────

# Les cives de la Casa Batlló : surtout des bleus et des turquoises, des verts
# d'eau, des blancs laiteux, quelques violets.
PALETTE = {
    "Batllo_Cive_Bleu": ((0.06, 0.22, 0.72), 30),
    "Batllo_Cive_Turquoise": ((0.03, 0.55, 0.60), 24),
    "Batllo_Cive_Vert": ((0.20, 0.55, 0.22), 18),
    "Batllo_Cive_Blanc": ((0.86, 0.92, 0.90), 16),
    "Batllo_Cive_Violet": ((0.46, 0.24, 0.66), 8),
}


def vitrail():
    """
    Une grande rose au cœur de chaque panneau, puis des cives de plus en plus
    petites qui se logent où elles tiennent, comme le verrier les sertissait.
    Retourne les disques par couleur, les anneaux de plomb, les roses, et le
    verre laiteux qui remplit les écoinçons entre les cives.
    """
    tirage = random.Random(1906)
    noms = list(PALETTE)
    poids = [PALETTE[n][1] for n in noms]
    disques = {n: [] for n in noms}
    plombs, roses, fonds = [], [], []
    for i, p in enumerate(panneaux()):
        g, d = min(x for x, _ in p), max(x for x, _ in p)
        cx = (g + d) / 2
        cy = (bas_du_vitrail(cx) + PLAFOND - 0.16) / 2
        R = 0.33 if i == 1 else 0.27
        roses.append((cx, cy, R))
        # La rose : une couronne bleue au centre, turquoise sur les côtés ; un cœur blanc.
        couronne = "Batllo_Cive_Bleu" if i == 1 else "Batllo_Cive_Turquoise"
        disques[couronne].append([cercle(cx, cy, R, 48), cercle(cx, cy, R * 0.5, 32)])
        disques["Batllo_Cive_Blanc"].append([cercle(cx, cy, R * 0.5, 32)])
        plombs += [(cx, cy, R), (cx, cy, R * 0.5)]
        poses = [(cx, cy, R)]
        for r in (0.12, 0.085, 0.06, 0.042):
            pas = r * 0.9
            v = PLAFOND - 0.16
            while v > 7.95:
                u = g + (tirage.random() * pas)
                while u < d:
                    libre = all(math.hypot(u - a, v - b) > r + c + 0.022 for a, b, c in poses)
                    if libre and all(dedans(q, p) for q in cercle(u, v, r + 0.02, 12)):
                        poses.append((u, v, r))
                        disques[tirage.choices(noms, poids)[0]].append([cercle(u, v, r, 20)])
                    u += pas
                v -= pas
        plombs += poses[1:]
        fonds.append([p, *(cercle(u, v, r, 48 if r == R else 20) for u, v, r in poses)])
    return disques, plombs, roses, fonds


# ── Blender : courbes couchées dans le mur ────────────────────────────────


def plaque(nom, contours, mat, ep=0.0, biseau=0.0, w=0.0, pleine=True):
    """
    Une courbe 2D remplie (les contours emboîtés deviennent des trous), extrudée
    de ±ep et biseautée, couchée dans le plan du mur à w du nu central. Sans
    `pleine`, les contours sont des fils : tubes de rayon `biseau`, pour le plomb.
    """
    cu = bpy.data.curves.new(nom, "CURVE")
    cu.dimensions = "2D" if pleine else "3D"
    if pleine:
        cu.fill_mode = "BOTH"
    cu.extrude = ep
    cu.bevel_depth = biseau
    cu.bevel_resolution = 2 if pleine else 0
    for c in contours:
        sp = cu.splines.new("POLY")
        sp.points.add(len(c) - 1)
        for pt, (u, v) in zip(sp.points, c):
            pt.co = (u, v, 0.0, 1.0)
        sp.use_cyclic_u = True
        sp.use_smooth = True
    cu.materials.append(mat)
    o = bpy.data.objects.new(nom, cu)
    o.rotation_euler = (math.pi / 2, 0.0, 0.0)  # v → hauteur, w → z du plan
    o.location = (0.0, -(ZM + w), 0.0)
    bpy.context.collection.objects.link(o)
    # En maillage tout de suite : l'export n'a plus à deviner la tessellation.
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    if not me.materials:
        me.materials.append(mat)
    me.set_sharp_from_angle(angle=math.radians(35))
    m = bpy.data.objects.new(nom, me)
    m.matrix_world = o.matrix_world
    bpy.data.objects.remove(o)
    bpy.data.curves.remove(cu)
    bpy.context.collection.objects.link(m)
    return m


def menuiserie(chene):
    """Le chêne : dormant, allège, traverses et meneaux, tout d'une pièce percée de ses jours."""
    b = BISEAU
    dehors = [(X0 + b, SOL + b), (X1 - b, SOL + b), (X1 - b, PLAFOND - b), (X0 + b, PLAFOND - b)]
    plaque("Batllo_Menuiserie", [dehors, *vitres_claires(), *panneaux()], chene, ep=BOIS - b, biseau=b)
    # Le chambranle, sur chaque face : un U de chêne aux angles hauts arrondis.
    # Le biseau gonfle le contour : on le dessine d'autant en retrait.
    u = [(20.84, SOL + b), (X0 - b, SOL + b), (X0 - b, 9.18), (X1 + b, 9.18), (X1 + b, SOL + b),
         (27.16, SOL + b), (27.16, PLAFOND - b), (20.84, PLAFOND - b)]
    u = arrondir(u, [0, 0, 0.35, 0.35, 0, 0, 0.04, 0.04])
    for w in (0.19, -0.19):
        plaque("Batllo_Chambranle", [u], chene, ep=0.025, biseau=0.015, w=w)
    # La fleur sculptée qui sertit la rose centrale, et deux boutons sur les colonnes.
    _, _, roses, _ = VITRAIL
    cx, cy, R = next(r for r in roses if abs(r[0] - 24.0) < 0.1)
    fleur = [(cx + (R + 0.08 + 0.035 * math.cos(8 * t)) * math.cos(t), cy + (R + 0.08 + 0.035 * math.cos(8 * t)) * math.sin(t))
             for t in (2 * math.pi * i / 96 for i in range(96))]
    for w in (0.045, -0.045):
        plaque("Batllo_Fleur", [fleur, cercle(cx, cy, R - 0.005, 48)], chene, ep=0.012, biseau=0.012, w=w)
        for x in COLS:
            plaque("Batllo_Bouton", [cercle(x, 7.78, 0.08, 24)], chene, ep=0.02, biseau=0.025, w=w * 2.1)


def vitrages(clair, laiteux, plomb, cives):
    plaque("Batllo_Verre", vitres_claires(), clair)
    disques, plombs, _, fonds = VITRAIL
    plaque("Batllo_Vitrail_Fond", [c for f in fonds for c in f], laiteux)
    for nom, liste in disques.items():
        plaque(nom, [c for d in liste for c in d], cives[nom])
    plaque("Batllo_Plomb", [cercle(u, v, r, 20 if r < 0.2 else 40) for u, v, r in plombs], plomb, biseau=0.012, pleine=False)


# ── La pierre : colonnes en os et arcs ────────────────────────────────────


def fut(h):
    """Le rayon d'une colonne à la hauteur h : un os, renflé au pied, aux deux genoux et sous l'arc."""
    def bosse(c, l, a):
        return a * math.exp(-((h - c) / l) ** 2)
    return 0.1 + bosse(4.86, 0.12, 0.1) + bosse(5.95, 0.16, 0.055) + bosse(6.75, 0.14, 0.05) + bosse(7.26, 0.12, 0.11)


def tube(g, pts, rayons, mat, n=12):
    """Un tube de section ronde qui suit une ligne du plan de la baie."""
    anneaux = []
    for i, ((u, v), r) in enumerate(zip(pts, rayons)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        tu, tv = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tu, tv)
        nu, nv = -tv / l, tu / l
        anneaux.append([(u + r * math.cos(2 * math.pi * j / n) * nu, -ZM + r * math.sin(2 * math.pi * j / n),
                         v + r * math.cos(2 * math.pi * j / n) * nv) for j in range(n)])
    g.prisme(anneaux, mat)


def pierre_(pierre):
    g = nef.Maillage()
    for x in COLS:
        hs = [SOL + (7.42 - SOL) * k / 40 for k in range(41)]
        nef.tour(g, [(fut(h), h) for h in hs] + [(0.12, 7.46)], x, -ZM, pierre, n=20)
    for i, xa, xb, _, _ in travees():
        ligne = arc(xa, xb, FLECHES[i], n=36)
        # Plus épais aux reins, fin à la clé : l'arc s'amincit comme un os.
        tube(g, ligne, [0.075 + 0.045 * abs(math.cos(math.pi * k / 36)) ** 2 for k in range(37)], pierre)
    # Les arcs de rive naissent sur un corbeau engagé dans le tableau.
    for x in (X0 + 0.03, X1 - 0.03):
        nef.tour(g, [(0.0, NAISS - 0.2), (0.09, NAISS - 0.15), (0.13, NAISS), (0.1, NAISS + 0.12), (0.0, NAISS + 0.16)], x, -ZM, pierre, n=16)
    return g.objet("Batllo_Pierre", [pierre], lisse=math.radians(50))


def construire():
    global VITRAIL
    nef.repartir()
    for c in list(bpy.data.curves):
        bpy.data.curves.remove(c)
    VITRAIL = vitrail()
    chene = nef.matiere("Batllo_Chene", (0.68, 0.41, 0.15), 0.5)
    pierre = nef.matiere("Batllo_Pierre", (0.76, 0.72, 0.65), 0.7)
    plomb = nef.matiere("Batllo_Plomb", (0.16, 0.17, 0.18), 0.45, metallique=0.4)
    clair = nef.matiere("Batllo_Verre", (0.90, 0.95, 0.96), 0.08, alpha=0.25, emission=(0.9, 0.96, 1.0), force=0.12)
    laiteux = nef.matiere("Batllo_Laiteux", (0.88, 0.94, 0.90), 0.3, alpha=0.7, emission=(0.88, 0.95, 0.9), force=0.35)
    cives = {n: nef.matiere(n, c, 0.15, alpha=0.75, emission=c, force=0.7) for n, (c, _) in PALETTE.items()}
    menuiserie(chene)
    vitrages(clair, laiteux, plomb, cives)
    pierre_(pierre)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
    )
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"batllo : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio, {tris} triangles)")


if __name__ == "__main__":
    construire()
    if "--no-export" not in sys.argv:
        exporter()
