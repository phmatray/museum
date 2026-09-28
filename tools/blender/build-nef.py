"""
La nef du hall, à la manière du musée d'Orsay, générée par Blender en headless.

    blender --background --python tools/blender/build-nef.py

Produit `public/assets/architecture/nef.glb` : ce qui couvre le hall au-dessus
des murs (+9,30) — attique percé de baies cintrées, voûte en berceau à arcs
doubleaux et caissons dorés, verrière à résille de fonte, pignons vitrés,
l'horloge dorée du pignon nord et six lanternes suspendues.

Le fichier est modélisé DANS le repère du plan : x Blender = x du plan,
y Blender = -z du plan, z Blender = la hauteur. L'export glTF (+Y en haut) le
rend donc directement dans le repère de three, sans aucune transformation.

Déterministe : aucune valeur aléatoire, aucune horloge.
"""

import math
from pathlib import Path

import bmesh
import bpy

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:  # exécuté depuis le MCP, sans __file__
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "nef.glb"

# ── Le hall, lu dans src/plan/musee.ts ────────────────────────────────────
X0, X1 = 16.0, 32.0          # murs ouest et est
Z0, Z1 = 12.0, 40.0          # pignon nord (salle d'honneur), pignon sud (entrée)
CX = (X0 + X1) / 2
MURS = 9.3                   # haut des murs de l'étage : 2 × 4,80 − 0,30
ATTIQUE = 3.3                # l'attique porte les baies cintrées
S = MURS + ATTIQUE           # naissance de la voûte
R = (X1 - X0) / 2            # berceau plein cintre
TRAVEE = 3.5
ARCS = [Z0 + k * TRAVEE for k in range(int((Z1 - Z0) / TRAVEE) + 1)]
ARC_L = 0.7                  # largeur d'un arc doubleau
ARC_E = 0.45                 # retombée de l'arc sous l'intrados
CAISSONS = math.radians(52)  # la verrière occupe le haut, entre 52° et 128°


def repartir():
    """Vide la scène sans `read_factory_settings`, qui déchargerait l'addon MCP."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)


def matiere(nom, couleur, rugosite, metallique=0.0, alpha=1.0, emission=None, force=1.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    m.use_backface_culling = False  # exporté doubleSided : la voûte se voit aussi du parc
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    b.inputs["Metallic"].default_value = metallique
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = force
    return m


def P(r, t, z, cx=CX, cy=S):
    """Un point de la voûte : rayon r, angle t (0 = naissance ouest), cote z du plan."""
    return (cx - r * math.cos(t), -z, cy + r * math.sin(t))


class Maillage:
    """Accumule sommets et faces par matériau, puis un seul objet par pièce."""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def quad(self, pts, mat):
        i = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(i, i + len(pts))))
        self.m.append(mat)

    def prisme(self, anneaux, mat, fermer=True):
        """Relie des anneaux successifs de même nombre de sommets (un balayage)."""
        n = len(anneaux[0])
        base = len(self.v)
        for a in anneaux:
            self.v.extend(a)
        for k in range(len(anneaux) - 1):
            for j in range(n):
                a, b = base + k * n + j, base + k * n + (j + 1) % n
                self.f.append((a, b, b + n, a + n))
                self.m.append(mat)
        if fermer:
            self.f.append(tuple(range(base, base + n))[::-1])
            self.m.append(mat)
            d = base + (len(anneaux) - 1) * n
            self.f.append(tuple(range(d, d + n)))
            self.m.append(mat)

    def boite(self, x0, x1, y0, y1, z0, z1, mat):
        """Pavé dans le repère Blender."""
        anneaux = [[(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)] for x in (x0, x1)]
        self.prisme(anneaux, mat)

    def objet(self, nom, mats, lisse=math.radians(35)):
        me = bpy.data.meshes.new(nom)
        me.from_pydata(self.v, [], self.f)
        for m in mats:
            me.materials.append(m)
        idx = {m.name: i for i, m in enumerate(mats)}
        for p, m in zip(me.polygons, self.m):
            p.material_index = idx[m.name]
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=lisse)
        o = bpy.data.objects.new(nom, me)
        bpy.context.collection.objects.link(o)
        return o


def arc(g, r0, r1, za, zb, t0, t1, mat, n=48):
    """Secteur d'anneau balayé autour de l'axe de la nef : arc, lisse, montant."""
    anneaux = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        anneaux.append([P(r0, t, za), P(r1, t, za), P(r1, t, zb), P(r0, t, zb)])
    g.prisme(anneaux, mat)


def caisson(g, r, t0, t1, za, zb, cadre, fond, rosace, creux=0.07):
    """
    Un caisson : un cadre à l'intrados, un fond en retrait, une rosace dorée.
    Tout vit sur le cylindre de rayon r ; creuser, c'est s'éloigner de l'axe.
    """
    mz = 0.12 * (zb - za)
    mt = 0.12 * (t1 - t0)
    ext = [(t0, za), (t1, za), (t1, zb), (t0, zb)]
    inn = [(t0 + mt, za + mz), (t1 - mt, za + mz), (t1 - mt, zb - mz), (t0 + mt, zb - mz)]
    ros = [(t0 + 3.2 * mt, za + 3.2 * mz), (t1 - 3.2 * mt, za + 3.2 * mz), (t1 - 3.2 * mt, zb - 3.2 * mz), (t0 + 3.2 * mt, zb - 3.2 * mz)]
    for k in range(4):
        (a, b), (c, d) = ext[k], ext[(k + 1) % 4]
        (e, f), (h, i) = inn[k], inn[(k + 1) % 4]
        g.quad([P(r, a, b), P(r, c, d), P(r, h, i), P(r, e, f)], cadre)                       # cadre
        g.quad([P(r, e, f), P(r, h, i), P(r + creux, h, i), P(r + creux, e, f)], cadre)       # joue
        (j, l), (m, n) = ros[k], ros[(k + 1) % 4]
        g.quad([P(r + creux, e, f), P(r + creux, h, i), P(r + creux, m, n), P(r + creux, j, l)], fond)
        g.quad([P(r + creux, j, l), P(r + creux, m, n), P(r + creux - 0.05, m, n), P(r + creux - 0.05, j, l)], rosace)
    g.quad([P(r + creux - 0.05, t, z) for t, z in ros], rosace)


def plein_cintre(largeur, bas, naissance, n=16):
    """Le contour d'une baie cintrée dans son plan (u horizontal, v hauteur)."""
    rr = largeur / 2
    pts = [(-rr, bas), (rr, bas)]
    pts += [(rr * math.cos(math.pi * i / n), naissance + rr * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return pts


# ── Les pièces ────────────────────────────────────────────────────────────


def voute(staff, ocre, fond, or_, fonte, verre):
    g = Maillage()
    # Les arcs doubleaux, chacun couvert de caissons.
    for z in ARCS:
        za, zb = z - ARC_L / 2, z + ARC_L / 2
        arc(g, R - ARC_E, R + 0.05, za, zb, 0, math.pi, ocre, n=64)
        n = 30
        for i in range(n):
            t0, t1 = math.pi * i / n, math.pi * (i + 1) / n
            caisson(g, R - ARC_E - 0.001, t0, t1, za + 0.05, zb - 0.05, ocre, fond, or_, creux=0.05)
    # Entre les arcs : caissons sur les reins, verrière au sommet.
    for z in ARCS[:-1]:
        za, zb = z + ARC_L / 2, z + TRAVEE - ARC_L / 2
        cols, rangs = 3, 8
        for c in range(cols):
            ca, cb = za + (zb - za) * c / cols, za + (zb - za) * (c + 1) / cols
            for k in range(rangs):
                for t0, t1 in ((CAISSONS * k / rangs, CAISSONS * (k + 1) / rangs),
                               (math.pi - CAISSONS * (k + 1) / rangs, math.pi - CAISSONS * k / rangs)):
                    caisson(g, R, t0, t1, ca, cb, staff, fond, or_)
        # Traverses de la verrière.
        for k in range(1, 4):
            zt = za + (zb - za) * k / 4
            arc(g, R - 0.07, R, zt - 0.025, zt + 0.025, CAISSONS, math.pi - CAISSONS, fonte, n=24)
    # Les pannes de la verrière, d'un pignon à l'autre, et les deux sablières dorées.
    for k in range(1, 12):
        t = CAISSONS + (math.pi - 2 * CAISSONS) * k / 12
        arc(g, R - 0.08, R, Z0, Z1, t - 0.004, t + 0.004, fonte, n=1)
    for t in (CAISSONS, math.pi - CAISSONS):
        arc(g, R - 0.16, R + 0.02, Z0, Z1, t - 0.012, t + 0.012, or_, n=1)
    o = g.objet("Nef_Voute", [staff, ocre, fond, or_, fonte])

    v = Maillage()
    for z in ARCS[:-1]:
        za, zb = z + ARC_L / 2, z + TRAVEE - ARC_L / 2
        n = 20
        for i in range(n):
            t0 = CAISSONS + (math.pi - 2 * CAISSONS) * i / n
            t1 = CAISSONS + (math.pi - 2 * CAISSONS) * (i + 1) / n
            v.quad([P(R + 0.02, t0, za), P(R + 0.02, t1, za), P(R + 0.02, t1, zb), P(R + 0.02, t0, zb)], verre)
    return o, v.objet("Nef_Verriere", [verre])


def attique(pierre, fonte, verre):
    """Les murs de l'attique, percés d'une baie cintrée par travée, pilastres sous les arcs."""
    g = Maillage()
    vit = Maillage()
    ep = 0.4
    bas, naiss, larg = MURS + 0.5, MURS + 1.9, 2.2
    for xm, sens in ((X0, 1), (X1, -1)):
        xa, xb = xm - sens * ep, xm  # la face intérieure est au nu du mur du dessous
        xa, xb = min(xa, xb), max(xa, xb)
        # Le mur en pièces : allèges, trumeaux, et le plein au-dessus des cintres.
        for z in ARCS[:-1]:
            zc = z + TRAVEE / 2
            za, zb = z + ARC_L / 2, z + TRAVEE - ARC_L / 2
            g.boite(xa, xb, -zb, -za, MURS, bas, pierre)
            g.boite(xa, xb, -(zc - larg / 2), -za, bas, naiss, pierre)
            g.boite(xa, xb, -zb, -(zc + larg / 2), bas, naiss, pierre)
            # Le tympan autour du cintre : un éventail de quadrilatères.
            n = 16
            for i in range(n):
                a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
                u0, u1 = larg / 2 * math.cos(a0), larg / 2 * math.cos(a1)
                h0, h1 = naiss + larg / 2 * math.sin(a0), naiss + larg / 2 * math.sin(a1)
                # Le point du bord extérieur que vise chaque rayon.
                def bord(a):
                    c, s = math.cos(a), math.sin(a)
                    k = min((TRAVEE - ARC_L) / 2 / abs(c) if abs(c) > 1e-6 else 1e9, (S - naiss) / s if s > 1e-6 else 1e9)
                    return c * k, naiss + s * k
                e0, e1 = bord(a0), bord(a1)
                anneaux = [[(x, -(zc - u0), h0), (x, -(zc - u1), h1), (x, -(zc - e1[0]), e1[1]), (x, -(zc - e0[0]), e0[1])] for x in (xa, xb)]
                g.prisme(anneaux, pierre)
            # La baie : vitrage en retrait, meneaux et petits-bois de fonte.
            xv = xm - sens * ep * 0.6
            cont = plein_cintre(larg, bas, naiss)
            vit.quad([(xv, -(zc + u), h) for u, h in cont], verre)
            for u in (-larg / 6, larg / 6):
                top = naiss + math.sqrt((larg / 2) ** 2 - u * u)
                g.boite(xv - 0.03, xv + 0.03, -(zc + u) - 0.03, -(zc + u) + 0.03, bas, top, fonte)
            for h in (bas + 0.45, bas + 0.95, naiss):
                g.boite(xv - 0.03, xv + 0.03, -(zc + larg / 2), -(zc - larg / 2), h - 0.03, h + 0.03, fonte)
        # Pilastres sous chaque arc, corniche du bas, imposte à la naissance.
        for z in ARCS:
            x0, x1 = sorted((xm, xm + sens * 0.22))
            g.boite(x0, x1, -(z + ARC_L / 2), -(z - ARC_L / 2), MURS, S, pierre)
        for h0, h1, saillie in ((MURS - 0.25, MURS, 0.18), (MURS, MURS + 0.12, 0.32), (S - 0.2, S, 0.3)):
            x0, x1 = sorted((xm - sens * ep, xm + sens * saillie))
            g.boite(x0, x1, -Z1, -Z0, h0, h1, pierre)
    return g.objet("Nef_Attique", [pierre, fonte], lisse=math.radians(20)), vit.objet("Nef_Baies", [verre])


def pignons(pierre, fonte, verre):
    """Les deux pignons vitrés : un plein cintre sur l'attique, résille de fonte."""
    g = Maillage()
    vit = Maillage()

    def demi_largeur(h):
        return R if h <= S else math.sqrt(max(R * R - (h - S) ** 2, 0.0))

    for zp, sens in ((Z0, 1), (Z1, -1)):
        y = -(zp + sens * 0.05)
        cont = [(X0, MURS), (X1, MURS)] + [(CX + R * math.cos(math.pi * i / 48), S + R * math.sin(math.pi * i / 48)) for i in range(49)]
        vit.quad([(x, y, h) for x, h in cont], verre)
        # Résille : montants tous les mètres, traverses tous les 1,10 m.
        for i in range(1, 16):
            x = X0 + i
            haut = S + math.sqrt(max(R * R - (x - CX) ** 2, 0.0))
            w = 0.09 if i % 4 == 0 else 0.04
            g.boite(x - w, x + w, y - 0.05, y + 0.05, MURS, haut, fonte)
        h = MURS + 1.1
        while h < S + R - 0.3:
            d = demi_largeur(h)
            g.boite(CX - d, CX + d, y - 0.04, y + 0.04, h - 0.03, h + 0.03, fonte)
            h += 1.1
        # Un arc intérieur de fonte, comme à Orsay : la grande baie dans la baie.
        arc_plan(g, R * 0.6, R * 0.6 + 0.16, y, fonte)
        g.boite(X0, X1, y - 0.12, y + 0.12, MURS, MURS + 0.25, pierre)
    return g.objet("Nef_Pignons", [pierre, fonte]), vit.objet("Nef_Pignons_Verre", [verre])


def arc_plan(g, r0, r1, y, mat, n=40):
    """Un arc de fonte dans le plan d'un pignon, centré sur l'axe de la nef."""
    anneaux = []
    for i in range(n + 1):
        t = math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        anneaux.append([(CX + r0 * c, y - 0.06, S + r0 * s), (CX + r1 * c, y - 0.06, S + r1 * s),
                        (CX + r1 * c, y + 0.06, S + r1 * s), (CX + r0 * c, y + 0.06, S + r0 * s)])
    g.prisme(anneaux, mat)


def tore(g, cx, cy, cz, R_, r_, mat, n=48, m=8, axe="y"):
    """Un tore dans le plan vertical face au hall (axe y Blender)."""
    anneaux = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        anneau = []
        for j in range(m):
            b = 2 * math.pi * j / m
            rr = R_ + r_ * math.cos(b)
            anneau.append((cx + rr * ca, cy + r_ * math.sin(b), cz + rr * sa))
        anneaux.append(anneau)
    g.prisme(anneaux, mat, fermer=False)


def disque(g, cx, cy, cz, r, mat, n=48, face=-1):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy, cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    g.quad(pts if face < 0 else pts[::-1], mat)


def horloge(or_, cadran, fonte):
    """L'horloge dorée du pignon nord, tournée vers l'entrée."""
    g = Maillage()
    cx, cz = CX, S + 2.2  # au-dessus des lanternes, vue depuis l'entrée
    y = -(Z0 + ARC_L / 2 + 0.25)
    rc = 1.25
    # Le fond du cartouche, puis le cadran légèrement en avant.
    disque(g, cx, y + 0.12, cz, 1.95, or_)
    g.prisme([[(cx + r * math.cos(2 * math.pi * i / 64), yy, cz + r * math.sin(2 * math.pi * i / 64)) for i in range(64)]
              for r, yy in ((1.95, y + 0.12), (1.95, y + 0.02))], or_)
    disque(g, cx, y - 0.02, cz, rc, cadran, n=64)
    tore(g, cx, y - 0.03, cz, rc + 0.06, 0.08, or_, n=64)
    tore(g, cx, y - 0.02, cz, 1.62, 0.12, or_, n=64)
    tore(g, cx, y - 0.02, cz, 1.9, 0.07, or_, n=64)
    # Rayons et fleurons entre les deux couronnes.
    for i in range(24):
        a = 2 * math.pi * i / 24
        c, s = math.cos(a), math.sin(a)
        r0, r1 = rc + 0.14, 1.9 if i % 2 == 0 else 1.62
        w = 0.05
        g.prisme([[(cx + r * c - w * s, yy, cz + r * s + w * c), (cx + r * c + w * s, yy, cz + r * s - w * c),
                   (cx + r * c + w * s, yy - 0.1, cz + r * s - w * c), (cx + r * c - w * s, yy - 0.1, cz + r * s + w * c)]
                  for r, yy in ((r0, y), (r1, y))], or_)
        if i % 2 == 0:
            tore(g, cx + 1.78 * c, y - 0.08, cz + 1.78 * s, 0.1, 0.035, or_, n=12, m=6)
    # Les heures : des index dorés, doublés aux quarts.
    for i in range(12):
        a = math.pi / 2 - 2 * math.pi * i / 12
        c, s = math.cos(a), math.sin(a)
        for dec in ((-0.035, 0.035) if i % 3 == 0 else (0.0,)):
            ox, oz = -s * dec, c * dec
            r0, r1, w = rc - 0.28, rc - 0.06, 0.018
            g.prisme([[(cx + ox + r * c - w * s, yy, cz + oz + r * s + w * c), (cx + ox + r * c + w * s, yy, cz + oz + r * s - w * c),
                       (cx + ox + r * c + w * s, yy - 0.02, cz + oz + r * s - w * c), (cx + ox + r * c - w * s, yy - 0.02, cz + oz + r * s + w * c)]
                      for r, yy in ((r0, y - 0.03), (r1, y - 0.03))], or_)
    # Les aiguilles, à dix heures dix.
    for a, long_, w in ((math.pi / 2 - 2 * math.pi * 10 / 12 - math.radians(5), 0.62, 0.035), (math.pi / 2 - 2 * math.pi * 2 / 12, 0.98, 0.022)):
        c, s = math.cos(a), math.sin(a)
        g.prisme([[(cx + r * c - w * s, yy, cz + r * s + w * c), (cx + r * c + w * s, yy, cz + r * s - w * c),
                   (cx + r * c + w * s, yy - 0.02, cz + r * s - w * c), (cx + r * c - w * s, yy - 0.02, cz + r * s + w * c)]
                  for r, yy in ((-0.15, y - 0.07), (long_, y - 0.07))], fonte)
    tore(g, cx, y - 0.1, cz, 0.04, 0.03, or_, n=12, m=6)
    # La console qui la porte, accrochée à l'arc nord.
    g.boite(cx - 0.12, cx + 0.12, y + 0.02, y + 0.35, cz + 1.95, S + R - ARC_E - 0.05, or_)
    return g.objet("Nef_Horloge", [or_, cadran, fonte], lisse=math.radians(40))


def tour(g, profil, cx, cy, mat, n=24):
    """Un solide de révolution autour de la verticale : (rayon, hauteur)."""
    anneaux = [[(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), h) for i in range(n)] for r, h in profil]
    g.prisme(anneaux, mat)


def lanternes(bronze, opale):
    """
    Six lanternes de bronze à globe d'opale, en deux files de part et d'autre de
    l'axe : l'axe reste dégagé pour l'horloge, vue depuis l'entrée.
    """
    g = Maillage()
    for zp, cx in ((z + TRAVEE / 2, CX + d) for z in (ARCS[2], ARCS[4], ARCS[6]) for d in (-3.5, 3.5)):
        y = -zp
        plafond = S + math.sqrt(R * R - (cx - CX) ** 2)  # accrochée à la résille de la verrière
        b = 6.9  # le bas du globe : au-dessus des regards des balcons
        tour(g, [(0.018, b + 1.9), (0.018, plafond)], cx, y, bronze, n=8)
        # Le fût : culot, bague, porte-globe, chapeau, fleuron.
        tour(g, [(0.0, b - 0.18), (0.05, b - 0.12), (0.09, b - 0.02), (0.12, b + 0.05)], cx, y, bronze)
        globe = [(0.34 * math.sin(math.pi * k / 16) * (1 - 0.12 * k / 16), b + 0.05 + 0.82 * (1 - math.cos(math.pi * k / 16)) / 2) for k in range(17)]
        tour(g, globe, cx, y, opale)
        tour(g, [(0.08, b + 0.85), (0.24, b + 0.9), (0.28, b + 0.98), (0.1, b + 1.08), (0.05, b + 1.3), (0.09, b + 1.42), (0.03, b + 1.9)], cx, y, bronze)
        # La couronne de bras en volutes, et leurs petites tulipes.
        for i in range(4):
            a = math.pi / 4 + math.pi / 2 * i
            c, s = math.cos(a), math.sin(a)
            pts = [(0.06 + 0.5 * math.sin(math.pi * k / 10) * (k / 10) ** 0.5, b + 1.25 - 0.35 * math.sin(math.pi * k / 20)) for k in range(11)]
            anneaux = []
            for r, h in pts:
                w = 0.02
                anneaux.append([(cx + r * c - w * s, y + r * s + w * c, h - w), (cx + r * c + w * s, y + r * s - w * c, h - w),
                                (cx + r * c + w * s, y + r * s - w * c, h + w), (cx + r * c - w * s, y + r * s + w * c, h + w)])
            g.prisme(anneaux, bronze)
            r_ext = pts[-1][0]
            tour(g, [(0.0, b + 1.0), (0.05, b + 1.02), (0.07, b + 1.12)], cx + (r_ext - 0.06) * c, y + (r_ext - 0.06) * s, bronze, n=10)
            tour(g, [(0.0, b + 1.1), (0.06, b + 1.14), (0.06, b + 1.26), (0.0, b + 1.3)], cx + (r_ext - 0.06) * c, y + (r_ext - 0.06) * s, opale, n=10)
    return g.objet("Nef_Lanternes", [bronze, opale], lisse=math.radians(50))


def construire():
    repartir()
    staff = matiere("Nef_Staff", (0.80, 0.67, 0.46), 0.7)
    ocre = matiere("Nef_Ocre", (0.66, 0.51, 0.30), 0.65)
    fond = matiere("Nef_Fond", (0.52, 0.39, 0.23), 0.8)
    or_ = matiere("Nef_Or", (0.86, 0.64, 0.30), 0.32, metallique=1.0)
    fonte = matiere("Nef_Fonte", (0.10, 0.10, 0.09), 0.5, metallique=0.6)
    pierre = matiere("Nef_Pierre", (0.82, 0.76, 0.65), 0.75)
    verre = matiere("Nef_Verre", (0.93, 0.95, 0.96), 0.15, alpha=0.55, emission=(0.93, 0.96, 1.0), force=0.55)
    cadran = matiere("Nef_Cadran", (0.95, 0.92, 0.83), 0.5, emission=(1.0, 0.96, 0.86), force=0.35)
    bronze = matiere("Nef_Bronze", (0.30, 0.22, 0.13), 0.4, metallique=1.0)
    opale = matiere("Nef_Opale", (1.0, 0.97, 0.9), 0.3, emission=(1.0, 0.9, 0.72), force=3.0)
    voute(staff, ocre, fond, or_, fonte, verre)
    attique(pierre, fonte, verre)
    pignons(pierre, fonte, verre)
    horloge(or_, cadran, fonte)
    lanternes(bronze, opale)


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
    )
    print(f"nef : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


if __name__ == "__main__":
    construire()
    import sys
    if "--no-export" not in sys.argv:
        exporter()
