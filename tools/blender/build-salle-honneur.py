"""
La salle d'honneur à la manière de l'étage noble de la Casa Batlló, générée
par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-salle-honneur.py

Produit `public/assets/architecture/salle-honneur.glb`, posé tel quel par
`src/scene/SalleHonneurLayer.tsx`, autour de la baie Batlló (`build-batllo.py`)
dont il reprend le chêne, la pierre des colonnes et les cives :

- `Voute` : le plafond de plâtre du grand salon — une gorge d'un quart de
  cercle naît du haut des murs (+9,30), une corniche plate porte les rails des
  projecteurs (+9,85, `VOUTE` de `src/plan/plafonds.ts`), puis la voûte monte
  en tourbillon — neuf bras en spirale logarithmique — jusqu'à la lampe ;
- `Soleil` : la lampe du centre, un cœur d'opale, une couronne de gouttes
  d'ambre et dix-huit rayons de laiton qui suivent les bras du tourbillon ;
- `Peau` : l'enduit crème des murs, aux angles arrondis, percé des deux portes
  et de la baie, qui prend tout le mur sud entre les angles ; `Lambris` : un
  lambris de chêne à la lisse ondulée ;
- `Os` : deux pilastres de pierre en os au mur des vitrines, dont la nervure
  file dans la gorge — au sud, ce sont les colonnes de la baie qui portent ;
- `Portes` : l'encadrement de chêne sculpté des deux portes, côté salle, à la
  crête semée de cives de couleur, comme les portes intérieures de Gaudí ;
- `Parquet` : un point de Hongrie de chêne miel, lame par lame (three y pose
  la matière du parquet ; la couleur de chaque lame est dans ses sommets).

Même repère que la nef (`build-nef.py`) : x Blender = x du plan, y Blender =
−z du plan, z Blender = la hauteur. Déterministe : le tirage est semé.
"""

import importlib.util
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import mathutils

ICI = Path(__file__).resolve().parent


def _module(nom, fichier):
    spec = importlib.util.spec_from_file_location(nom, ICI / fichier)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


nef = _module("nef", "build-nef.py")
batllo = _module("batllo", "build-batllo.py")
SORTIE = ICI.parents[1] / "public" / "assets" / "architecture" / "salle-honneur.glb"

# ── La salle, lue dans src/plan/musee.ts ──────────────────────────────────
X0, X1, Z0, Z1 = 16.15, 31.85, 0.15, 11.85   # les faces des murs (axe ± 0,15)
SOL, MURS = 4.8, 9.3
GORGE = 0.55                                  # VOUTE.gorge de src/plan/plafonds.ts
CORNICHE = MURS + GORGE
SOMMET = 10.3                                 # crêtes comprises, sous le parapet du toit (+10,50)
CX, CZ = 24.0, 6.0
RC = 0.5                                      # les angles arrondis de la salle
PEAU = 0.002                                  # l'enduit, sur la face du mur
PORTE = (5.0, 7.0, SOL + 2.4)                 # les deux portes, en z ; le linteau
BAIE = (batllo.X0, batllo.X1)                 # tout le mur sud, entre les angles arrondis
ENCADREMENT = 1.28                            # demi-largeur de l'encadrement de chêne
CHAMBRANLE_BAIE = (round(batllo.X0 - batllo.CH, 6), round(batllo.X1 + batllo.CH, 6))  # il finit où l'angle s'arrondit
PILASTRES = [(21.75, "N"), (26.25, "N")]
BRAS, TORSION = 9, 5.0                        # le tourbillon : n·θ + k·ln r


def B(x, y, z):
    """Un point du plan (x, hauteur, z) dans le repère de Blender."""
    return (x, -z, y)


def lisse(a, b, t):
    t = min(1.0, max(0.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ── Le contour de la salle ────────────────────────────────────────────────


def contour():
    """
    Le rectangle aux angles arrondis des faces de murs, échantillonné une fois :
    (x, z, nx, nz, côté, abscisse). La normale regarde la salle ; un contour
    retrait de d est `x + nx·d`, les angles gardant leur centre.
    """
    def cotes(a, b, obligatoires):
        n = max(2, int(abs(b - a) / 0.2) + 1)
        ts = {a + (b - a) * i / (n - 1) for i in range(n)} | {t for t in obligatoires if min(a, b) < t < max(a, b)}
        return sorted(ts, reverse=b < a)

    portes = (PORTE[0], PORTE[1], CZ - ENCADREMENT, CZ + ENCADREMENT)
    baie = (*BAIE, *CHAMBRANLE_BAIE)
    pts = []

    def angle(cx, cz, a0, cote):
        for i in range(8):
            a = math.radians(a0 + 90 * i / 8)
            pts.append((cx + RC * math.cos(a), cz + RC * math.sin(a), -math.cos(a), -math.sin(a), cote, 0.0))

    for x in cotes(X0 + RC, X1 - RC, ())[:-1]:
        pts.append((x, Z0, 0.0, 1.0, "N", x))
    angle(X1 - RC, Z0 + RC, -90, "NE")
    for z in cotes(Z0 + RC, Z1 - RC, portes)[:-1]:
        pts.append((X1, z, -1.0, 0.0, "E", z))
    angle(X1 - RC, Z1 - RC, 0, "SE")
    for x in cotes(X1 - RC, X0 + RC, baie)[:-1]:
        pts.append((x, Z1, 0.0, -1.0, "S", x))
    angle(X0 + RC, Z1 - RC, 90, "SO")
    for z in cotes(Z1 - RC, Z0 + RC, portes)[:-1]:
        pts.append((X0, z, 1.0, 0.0, "O", z))
    angle(X0 + RC, Z0 + RC, 180, "NO")
    return pts


def retrait(p, d):
    return p[0] + p[2] * d, p[1] + p[3] * d


def dans_porte(cote, s, marge=0.0):
    return cote in ("E", "O") and PORTE[0] - marge < s < PORTE[1] + marge


# ── L'enduit et le lambris ────────────────────────────────────────────────


def peau(g, pts, stuc):
    """L'enduit crème, du plancher au haut des murs, sauf dans les portes (sous le linteau) et la baie."""
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        cote, s = p[4], (p[5] + q[5]) / 2 if p[4] == q[4] else -1
        if cote == "S" and BAIE[0] < s < BAIE[1]:
            continue
        y0 = PORTE[2] if dans_porte(cote, s) else SOL
        (ax, az), (bx, bz) = retrait(p, PEAU), retrait(q, PEAU)
        g.quad([B(ax, y0, az), B(bx, y0, bz), B(bx, MURS, bz), B(ax, MURS, az)], stuc)


# Le profil du lambris : (saillie, hauteur) ; la lisse, au-dessus de 0,74, ondule.
LAMBRIS = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.1), (0.02, 0.13), (0.02, 0.74), (0.028, 0.76),
           (0.04, 0.80), (0.043, 0.84), (0.036, 0.875), (0.02, 0.89), (0.0, 0.89)]


def lambris(g, pts, chene):
    def libre(p):
        return not (dans_porte(p[4], p[5], ENCADREMENT - 1.0 - 1e-6) and p[4] in ("E", "O")) and \
            not (p[4] == "S" and CHAMBRANLE_BAIE[0] + 1e-6 < p[5] < CHAMBRANLE_BAIE[1] - 1e-6)
    # Des courses continues, d'une porte ou d'une baie à la suivante.
    n = len(pts)
    debut = next(i for i in range(n) if libre(pts[i]) and not libre(pts[i - 1]))
    course, courses = [], []
    for k in range(n + 1):
        p = pts[(debut + k) % n]
        if libre(p):
            course.append(p)
        elif course:
            courses.append(course)
            course = []
    if course:
        courses.append(course)
    longueur = 0.0
    for c in courses:
        anneaux = []
        for i, p in enumerate(c):
            if i:
                longueur += math.dist(p[:2], c[i - 1][:2])
            vague = 0.03 * math.sin(2 * math.pi * longueur / 1.6)
            anneaux.append([B(*retrait(p, PEAU + w)[:1], SOL + v + (vague if v > 0.7 else 0.0), retrait(p, PEAU + w)[1])
                            for w, v in LAMBRIS])
        g.prisme(anneaux, chene)


# ── La voûte en tourbillon ────────────────────────────────────────────────

R_OEIL = 0.3


def hauteur(t, x, z):
    """La cote de la voûte : `t` de la corniche (0) à l'œil (1), le tourbillon lu en (x, z)."""
    u = lisse(0.22, 1.0, t)
    dome = (SOMMET - CORNICHE) * (0.75 * u + 0.25 * u ** 4)
    r = max(math.hypot(x - CX, z - CZ), 0.05)
    th = math.atan2(z - CZ, x - CX)
    env = lisse(0.24, 0.55, t) * (1 - lisse(0.94, 1.0, t))
    # Des nervures plutôt qu'une ondulation : crêtes étroites, creux larges, comme le plâtre tiré de Gaudí.
    crete = (0.5 + 0.5 * math.sin(BRAS * th + TORSION * math.log(r))) ** 2
    return CORNICHE + dome + (0.06 + 0.12 * t) * env * (crete - 0.35)


def voute(g, pts, platre):
    # La gorge : un quart de cercle, du nu de l'enduit à la corniche.
    anneaux = []
    for j in range(9):
        f = math.pi / 2 * j / 8
        d, y = PEAU + GORGE * (1 - math.cos(f)), MURS + GORGE * math.sin(f)
        anneaux.append([B(*retrait(p, d)[:1], y, retrait(p, d)[1]) for p in pts])
    # La corniche, puis la voûte : les anneaux s'arrondissent en montant vers l'œil.
    bord = [retrait(p, PEAU + GORGE) for p in pts]
    rayons = [math.hypot(x - CX, z - CZ) for x, z in bord]
    moyen = sum(rayons) / len(rayons)
    fin = 1 - R_OEIL / moyen
    for k in range(1, 61):
        t = fin * (k / 60) ** 0.85
        w = lisse(0.25, 0.85, t)
        rang = []
        for (x, z), r in zip(bord, rayons):
            ux, uz = (x - CX) / r, (z - CZ) / r
            rx, rz = (x - CX) * (1 - w) + ux * moyen * w, (z - CZ) * (1 - w) + uz * moyen * w
            px, pz = CX + rx * (1 - t), CZ + rz * (1 - t)
            rang.append(B(px, hauteur(t, px, pz), pz))
        anneaux.append(rang)
    n = len(pts)
    for j in range(len(anneaux) - 1):
        a, b = anneaux[j], anneaux[j + 1]
        for i in range(n):
            g.quad([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], platre)
    # L'œil, sous la lampe.
    centre = B(CX, SOMMET + 0.02, CZ)
    a = anneaux[-1]
    for i in range(n):
        g.quad([a[i], a[(i + 1) % n], centre], platre)


# ── La lampe-soleil ───────────────────────────────────────────────────────


def soleil(laiton, opale, ambre):
    g = nef.Maillage()
    y0 = SOMMET - 0.02
    # Le cœur d'opale : une demi-sphère renflée, sous une bague de laiton.
    coeur = [(0.0, y0 - 0.26)] + [(0.24 * math.sin(math.pi / 2 * k / 10), y0 - 0.26 * math.cos(math.pi / 2 * k / 10)) for k in range(1, 11)]
    nef.tour(g, coeur, CX, -CZ, opale, n=32)
    nef.tour(g, [(0.2, y0 - 0.03), (0.3, y0 - 0.02), (0.31, y0 + 0.01), (0.2, y0 + 0.05)], CX, -CZ, laiton, n=32)
    # Dix-huit rayons de laiton, effilés, le long des bras du tourbillon.
    for k in range(18):
        th0 = 2 * math.pi * k / 18
        cote_g, cote_d = [], []
        pas = 24
        for i in range(pas + 1):
            f = i / pas
            r = 0.3 + 1.0 * f
            th = th0 - (TORSION / BRAS) * math.log(r / 0.3)
            larg = 0.05 * (1 - f) + 0.006
            tx, tz = math.cos(th), math.sin(th)
            nx, nz = -tz, tx
            x, z = CX + r * tx, CZ + r * tz
            t = 1 - r / 6.3
            y = hauteur(t, x, z) - 0.012 - 0.03 * (1 - f)
            cote_g.append((x + nx * larg, y, z + nz * larg))
            cote_d.append((x - nx * larg, y, z - nz * larg))
        for i in range(pas):
            for dy in (0.0, -0.012):
                a, b, c, d = cote_g[i], cote_g[i + 1], cote_d[i + 1], cote_d[i]
                g.quad([B(p[0], p[1] + dy, p[2]) for p in (a, b, c, d)], laiton)
    # La couronne de gouttes d'ambre, pendues autour du cœur.
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        x, z = CX + 0.4 * math.cos(a), CZ + 0.4 * math.sin(a)
        nef.tour(g, [(0.004, y0), (0.004, y0 - 0.1)], x, -z, laiton, n=6)
        goutte = [(0.0, y0 - 0.19)] + [(0.035 * math.sin(math.pi * i / 8) * (0.6 + 0.4 * i / 8), y0 - 0.19 + 0.09 * i / 8) for i in range(1, 8)] + [(0.0, y0 - 0.1)]
        nef.tour(g, goutte, x, -z, ambre, n=10)
    return g.objet("Soleil", [laiton, opale, ambre], lisse=math.radians(60))


# ── Les os ────────────────────────────────────────────────────────────────


def fut(h):
    """Le rayon d'un pilastre à la hauteur h : pied renflé, deux genoux, un chapiteau qui s'évase."""
    def bosse(c, l, a):
        return a * math.exp(-((h - c) / l) ** 2)
    return 0.078 + bosse(SOL + 0.06, 0.16, 0.06) + bosse(6.1, 0.2, 0.034) + bosse(7.45, 0.18, 0.03) + bosse(9.15, 0.24, 0.06)


def tube(g, pts, rayons, mat, n=12):
    """Un tube de section ronde le long d'une ligne quelconque (repère du plan)."""
    anneaux = []
    for i, (p, r) in enumerate(zip(pts, rayons)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = mathutils.Vector((b[0] - a[0], b[1] - a[1], b[2] - a[2])).normalized()
        ref = mathutils.Vector((0, 1, 0)) if abs(t.y) < 0.9 else mathutils.Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = t.cross(u)
        anneaux.append([B(*(mathutils.Vector(p) + r * (math.cos(2 * math.pi * j / n) * u + math.sin(2 * math.pi * j / n) * v))) for j in range(n)])
    g.prisme(anneaux, mat)


def os_(pierre):
    g = nef.Maillage()
    for x, mur in PILASTRES:
        nz = 1.0 if mur == "N" else -1.0
        z = (Z0 if mur == "N" else Z1) + nz * 0.035
        hs = [SOL + (MURS - SOL) * k / 60 for k in range(61)]
        nef.tour(g, [(fut(h), h) for h in hs], x, -z, pierre, n=18)
        # La nervure : elle suit la gorge, puis s'efface sur la corniche.
        ligne, rayons = [], []
        for k in range(25):
            f = k / 24
            if f <= 0.6:
                a = math.pi / 2 * f / 0.6
                d, y = 0.035 + (GORGE - 0.02) * (1 - math.cos(a)), MURS + (GORGE - 0.02) * math.sin(a)
            else:
                d, y = GORGE + 0.015 + 0.9 * (f - 0.6) / 0.4, CORNICHE - 0.02
            ligne.append((x, y, (Z0 if mur == "N" else Z1) + nz * d))
            rayons.append(0.07 * (1 - f) ** 0.8 + 0.012)
        tube(g, ligne, rayons, pierre)
    return g.objet("Os", [pierre], lisse=math.radians(60))


# ── Les portes ────────────────────────────────────────────────────────────

CIVES = {
    "Honneur_Cive_Bleu": (0.06, 0.22, 0.72),
    "Honneur_Cive_Turquoise": (0.03, 0.55, 0.60),
    "Honneur_Cive_Vert": (0.20, 0.55, 0.22),
    "Honneur_Cive_Ambre": (0.85, 0.45, 0.08),
    "Honneur_Cive_Violet": (0.46, 0.24, 0.66),
}


def plaque(nom, contours, mat, ep, biseau, repere, w=0.0):
    """Une courbe 2D (u, v) remplie — les contours emboîtés sont des trous —, posée par `repere`."""
    cu = bpy.data.curves.new(nom, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = ep
    cu.bevel_depth = biseau
    cu.bevel_resolution = 2
    for c in contours:
        sp = cu.splines.new("POLY")
        sp.points.add(len(c) - 1)
        for p, (u, v) in zip(sp.points, c):
            p.co = (u, v, 0.0, 1.0)
        sp.use_cyclic_u = True
        sp.use_smooth = True
    cu.materials.append(mat)
    o = bpy.data.objects.new(nom, cu)
    bpy.context.collection.objects.link(o)
    o.matrix_world = repere @ mathutils.Matrix.Translation((0, 0, w))
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    if not me.materials:
        me.materials.append(mat)
    m = bpy.data.objects.new(nom, me)
    m.matrix_world = o.matrix_world
    bpy.data.objects.remove(o)
    bpy.data.curves.remove(cu)
    bpy.context.collection.objects.link(m)
    return m


def crete(u):
    """Le haut de l'encadrement : une vague qui monte au milieu, comme une crête de Gaudí."""
    return 2.66 + 0.27 * math.cos(math.pi * u / (2 * ENCADREMENT)) ** 2 + 0.03 * math.cos(3 * math.pi * u / ENCADREMENT)


def encadrement():
    """Le U de chêne autour de la baie, et ses cives : (contour, [(u, v, r)])."""
    e = ENCADREMENT
    b = 0.012  # le biseau gonfle le contour : le pied part d'autant au-dessus du plancher
    gauche = [(-e + 0.025 * math.sin(2.3 * v), max(v, b)) for v in (2.5 * i / 12 for i in range(13))]
    haut = [(u, crete(u)) for u in (-e + 2 * e * i / 40 for i in range(1, 40))]
    droite = [(-u, v) for u, v in reversed(gauche)]
    ouverture = [(1.0 + b, b), (1.0 + b, 2.4 + b), (-1.0 - b, 2.4 + b), (-1.0 - b, b)]
    poly = gauche + haut + droite + ouverture
    rayons = [0.0] * len(poly)
    rayons[len(gauche) - 1] = rayons[len(gauche) + len(haut)] = 0.12   # les épaules
    rayons[-3] = rayons[-2] = 0.16                                     # les angles hauts de l'ouverture
    cives = []
    for i in range(7):
        u = -0.78 + 1.56 * i / 6
        r = 0.065 if i == 3 else (0.052 if i in (2, 4) else 0.042)
        cives.append((u, 2.4 + (crete(u) - 2.4) * 0.5, r))
    return batllo.arrondir(poly, rayons), cives


def portes(chene, cives_mats):
    contour_, cives = encadrement()
    trous = [batllo.cercle(u, v, r, 24) for u, v, r in cives]
    bague = [batllo.cercle(u, v, r + 0.022, 24) for u, v, r in cives]
    noms = list(CIVES)
    objets = []
    for sens, x in ((1.0, X0), (-1.0, X1)):
        # Le repère de la face : u le long du mur, v la hauteur, w vers la salle.
        ez = mathutils.Vector((sens, 0, 0))
        ey = mathutils.Vector((0, 0, 1))
        ex = ey.cross(ez)
        repere = mathutils.Matrix((
            (ex.x, ey.x, ez.x, x + sens * PEAU),
            (ex.y, ey.y, ez.y, -CZ),
            (ex.z, ey.z, ez.z, SOL),
            (0, 0, 0, 1),
        ))
        objets.append(plaque("Porte_Chene", [contour_, *trous], chene, 0.018, 0.012, repere, w=0.02))
        # Une baguette ronde autour de l'ouverture, et une bague autour de chaque cive.
        e = 1.0
        baguette = batllo.arrondir([(e + 0.07, 0.02), (e + 0.07, 2.47), (-e - 0.07, 2.47), (-e - 0.07, 0.02),
                                    (-e - 0.03, 0.02), (-e - 0.03, 2.43), (e + 0.03, 2.43), (e + 0.03, 0.02)],
                                   [0, 0.2, 0.2, 0, 0, 0.14, 0.14, 0])
        objets.append(plaque("Porte_Baguette", [baguette], chene, 0.01, 0.02, repere, w=0.05))
        for k, (b, t) in enumerate(zip(bague, trous)):
            objets.append(plaque("Porte_Bague", [b, t], chene, 0.006, 0.01, repere, w=0.045))
        for k, (u, v, r) in enumerate(cives):
            objets.append(plaque("Porte_Cive", [batllo.cercle(u, v, r, 24)], cives_mats[noms[(k * 3 + (sens > 0)) % len(noms)]], 0.003, 0.0, repere, w=0.012))
    return objets


# ── Le parquet en point de Hongrie ────────────────────────────────────────


def parquet(dessous_mat, lames_mat):
    """
    Des lames de 55 × 10 cm coupées à 45°, en colonnes alternées : les chevrons
    pointent vers la baie. Chaque lame porte ses UV (en mètres / 3, le motif de
    la matière de parquet de three) et sa teinte, dans l'attribut de couleur.
    """
    tirage = random.Random(1906)
    c45 = math.sqrt(0.5)
    cw, h = 0.55 * c45, 0.1 / c45
    y = SOL + 0.004
    v, f, uvs, cols = [], [], [], []

    def clip(poly):
        for axe, borne, sous in ((0, X0, False), (0, X1, True), (1, Z0, False), (1, Z1, True)):
            poly = batllo.couper(poly, axe, borne, sous)
            if len(poly) < 3:
                return []
        return poly

    k0, k1 = math.floor((X0 - CX) / cw) - 1, math.ceil((X1 - CX) / cw) + 1
    for k in range(k0, k1):
        xa, xb = CX + k * cw, CX + (k + 1) * cw
        s = 1.0 if k % 2 == 0 else -1.0
        decal = 0.0 if s > 0 else cw
        i0 = math.floor((Z0 - cw - decal) / h) - 1
        for i in range(i0, i0 + int((Z1 - Z0 + 2 * cw) / h) + 4):
            z0 = i * h + decal
            quad = [(xa, z0), (xb, z0 + s * cw), (xb, z0 + s * cw + h), (xa, z0 + h)]
            # Un joint d'un millimètre et demi : la lame se resserre sur son centre.
            gx, gz = sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4
            quad = [(gx + (p[0] - gx) * 0.985, gz + (p[1] - gz) * 0.975) for p in quad]
            poly = clip(quad)
            if not poly:
                continue
            along = (c45, s * c45)
            across = (-along[1], along[0])
            ou, ov = tirage.random(), tirage.random()
            teinte = 0.82 + 0.3 * tirage.random()
            chaud = tirage.random() * 0.06
            base = len(v)
            for px, pz in poly:
                v.append(B(px, y, pz))
                du, dv = px - xa, pz - z0
                uvs.append((ou + (du * along[0] + dv * along[1]) / 3, ov + (du * across[0] + dv * across[1]) / 3))
                cols.append((teinte, teinte * (0.97 - chaud), teinte * (0.9 - 2 * chaud), 1.0))
            f.append(tuple(range(base, base + len(poly))))
    me = bpy.data.meshes.new("Parquet")
    me.from_pydata(v, [], f)
    me.materials.append(lames_mat)
    uv = me.uv_layers.new(name="UVMap")
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = uvs[vi]
            col.data[li].color = cols[vi]
    me.color_attributes.active_color = col
    me.validate()
    # Le plan retourné en Blender (y = −z) retourne l'enroulement : les lames regardent le plafond.
    me.update()
    if me.polygons[0].normal.z < 0:
        me.flip_normals()
    o = bpy.data.objects.new("Parquet", me)
    bpy.context.collection.objects.link(o)
    # Sous les joints, le fond sombre.
    g = nef.Maillage()
    g.quad([B(X0, SOL + 0.002, Z0), B(X1, SOL + 0.002, Z0), B(X1, SOL + 0.002, Z1), B(X0, SOL + 0.002, Z1)], dessous_mat)
    g.objet("Parquet_Joints", [dessous_mat])
    return o


# ── Assemblage ────────────────────────────────────────────────────────────


def construire():
    nef.repartir()
    for c in list(bpy.data.curves):
        bpy.data.curves.remove(c)
    stuc = nef.matiere("Honneur_Stuc", (0.74, 0.62, 0.43), 0.9)
    platre = nef.matiere("Honneur_Platre", (0.86, 0.76, 0.58), 0.85)
    chene = nef.matiere("Honneur_Chene", (0.58, 0.34, 0.13), 0.5)
    pierre = nef.matiere("Honneur_Os", (0.62, 0.55, 0.43), 0.7)
    laiton = nef.matiere("Honneur_Laiton", (0.85, 0.62, 0.26), 0.35, metallique=0.6, emission=(0.9, 0.6, 0.25), force=0.25)
    opale = nef.matiere("Honneur_Soleil", (1.0, 0.92, 0.78), 0.4, emission=(1.0, 0.78, 0.45), force=1.0)
    ambre = nef.matiere("Honneur_Ambre", (0.95, 0.55, 0.15), 0.2, alpha=0.85, emission=(1.0, 0.55, 0.12), force=0.8)
    cives = {n: nef.matiere(n, c, 0.15, emission=c, force=0.5) for n, c in CIVES.items()}
    dessous = nef.matiere("Honneur_Joint", (0.05, 0.03, 0.015), 0.9)
    lames = nef.matiere("Honneur_Parquet", (1.0, 1.0, 1.0), 0.6)

    pts = contour()
    g = nef.Maillage()
    voute(g, pts, platre)
    g.objet("Voute", [platre], lisse=math.radians(80))
    g = nef.Maillage()
    peau(g, pts, stuc)
    g.objet("Peau", [stuc], lisse=math.radians(50))
    g = nef.Maillage()
    lambris(g, pts, chene)
    g.objet("Lambris", [chene], lisse=math.radians(50))
    soleil(laiton, opale, ambre)
    os_(pierre)
    pieces = portes(chene, cives)
    bpy.ops.object.select_all(action="DESELECT")
    for o in pieces:
        o.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = "Portes"
    parquet(dessous, lames)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_vertex_color="ACTIVE", export_draco_mesh_compression_enable=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"salle-honneur : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio, {tris} triangles)")


if __name__ == "__main__":
    construire()
    if "--no-export" not in sys.argv:
        exporter()
