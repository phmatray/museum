"""
Le pavillon du belvédère, la palissade du roji et sa porte, générés par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-belvedere.py
    blender --background --factory-startup --python tools/blender/build-belvedere.py -- --apercu /tmp/belvedere

Produit `public/assets/architecture/belvedere.glb`, posé tel quel par
`src/scene/BelvedereLayer.tsx` : tout est modelé dans le repère du plan, d'après
`src/plan/belvedere.json` (x Blender = x du plan, y = −z, z = hauteur). La
terrasse de pierre, elle, est faite de boîtes (`pierresDuBelvedere`, `ParkLayer`).

- Le PAVILLON (azumaya) : quatre poteaux de cèdre sur des dés de pierre, deux
  entraits, un toit en pavillon (hōgyō-zukuri) au galbe creux, couvert de
  tuiles sombres, ses arêtiers soulignés, un épi de bronze au sommet ; un banc
  le long du fond ; une lanterne de papier pendue au milieu.
- La PALISSADE (kenninji-gaki) : des lattes de bambou refendu, serrées,
  debout, tenues par trois paires de lisses de demi-bambou et coiffées d'un
  bambou entier, entre des poteaux ronds tous les 1,80 m.
- La PORTE du roji (kabuki-mon) : deux poteaux, une traverse qui les déborde,
  un petit toit à deux pans.

Quatre matières, que la scène reconnaît à leur nom : `Belvedere_Bois` (le cèdre
teinté, les cordes, l'épi), `Belvedere_Toit` (tuiles et dés de pierre),
`Belvedere_Bambou` (couleurs par latte, en couleurs de sommets),
`Belvedere_Lueur` (le papier de la lanterne, émissif — la scène ne l'allume
qu'au crépuscule).

Déterministe : le seul aléa est haché de l'indice de chaque latte.
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "belvedere.glb"
B = json.loads((ROOT / "src" / "plan" / "belvedere.json").read_text())
H = B["cote"]


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def matiere(nom, couleur, rugosite, metallique=0.0, emission=None, force=0.0):
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


def hache(i, k=0):
    """Un aléa dans [0, 1) tiré de l'entier i : la même latte a toujours la même teinte."""
    return (math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1.0


class Maillage:
    """Sommets et faces d'une matière, avec une couleur par sommet ; un objet à la fin."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def quad(self, pts, couleur=(1, 1, 1)):
        n = len(self.v)
        self.v += pts
        self.c += [couleur] * len(pts)
        self.f.append(tuple(range(n, n + len(pts))))

    def boite(self, x0, x1, y0, y1, z0, z1, couleur=(1, 1, 1)):
        """Une boîte en coordonnées du PLAN : x, y la hauteur, z vers le sud."""
        p = [(x, -z, y) for y in (y0, y1) for z in (z0, z1) for x in (x0, x1)]
        n = len(self.v)
        self.v += p
        self.c += [couleur] * 8
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.f.append(tuple(n + i for i in f))

    def cylindre(self, a, b, r, n=8, couleur=(1, 1, 1), bouts=True):
        """Un cylindre de rayon r de a à b, (x, y, z) du plan."""
        ax, ay, az = a
        bx, by, bz = b
        d = [bx - ax, by - ay, bz - az]
        l = math.sqrt(sum(c * c for c in d))
        u = [c / l for c in d]
        # Deux vecteurs normaux à l'axe.
        t = [0, 1, 0] if abs(u[1]) < 0.9 else [1, 0, 0]
        v1 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]]
        l1 = math.sqrt(sum(c * c for c in v1))
        v1 = [c / l1 for c in v1]
        v2 = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]]
        base = len(self.v)
        for (px, py, pz) in (a, b):
            for k in range(n):
                ang = 2 * math.pi * k / n
                ox = r * (math.cos(ang) * v1[0] + math.sin(ang) * v2[0])
                oy = r * (math.cos(ang) * v1[1] + math.sin(ang) * v2[1])
                oz = r * (math.cos(ang) * v1[2] + math.sin(ang) * v2[2])
                self.v.append((px + ox, -(pz + oz), py + oy))
                self.c.append(couleur)
        for k in range(n):
            self.f.append((base + k, base + (k + 1) % n, base + n + (k + 1) % n, base + n + k))
        if bouts:
            self.f.append(tuple(base + k for k in range(n))[::-1])
            self.f.append(tuple(base + n + k for k in range(n)))

    def objet(self, nom, mat, lisse=35):
        me = bpy.data.meshes.new(nom)
        me.from_pydata(self.v, [], self.f)
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(self.c):
            attr.data[i].color = (*c, 1.0)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(lisse))
        o = bpy.data.objects.new(nom, me)
        bpy.context.collection.objects.link(o)
        return o


# ── Le pavillon ─────────────────────────────────────────────────────────────

def pavillon(bois, toit, lueur):
    P = B["pavillon"]
    cx, cz, p = P["x"], P["z"], P["cote"] / 2
    po = P["poteau"] / 2
    egout, faite = H + P["egout"], H + P["faitage"]
    R = p + P["debord"]
    # Les dés de pierre, les poteaux, et les deux rangs d'entraits qui les lient.
    for u in (-1, 1):
        for v in (-1, 1):
            x, z = cx + u * p, cz + v * p
            toit.boite(x - 0.15, x + 0.15, H - 0.02, H + 0.16, z - 0.15, z + 0.15, (0.55, 0.55, 0.55))
            bois.boite(x - po, x + po, H + 0.16, egout + 0.05, z - po, z + po)
    for y0, h in ((H + 2.02, 0.1), (egout - 0.16, 0.2)):
        for v in (-1, 1):
            bois.boite(cx - p - 0.12, cx + p + 0.12, y0, y0 + h, cz + v * p - 0.055, cz + v * p + 0.055)
            bois.boite(cx + v * p - 0.055, cx + v * p + 0.055, y0, y0 + h, cz - p - 0.12, cz + p + 0.12)
    # Le toit : des anneaux carrés du sommet à l'égout, la pente se creuse vers le bas (teri).
    N = 12
    anneaux = []
    for k in range(N + 1):
        t = k / N
        anneaux.append((R * t, faite - (faite - egout) * (1 - (1 - t) ** 1.45)))
    coins = ((1, 1), (-1, 1), (-1, -1), (1, -1))

    def anneau(s, y):
        return [(cx + a * s, -(cz + b * s), y) for a, b in coins]

    ep = 0.14
    for k in range(N):
        (s0, y0), (s1, y1) = anneaux[k], anneaux[k + 1]
        a0, a1 = anneau(s0, y0), anneau(s1, y1)
        d0, d1 = anneau(s0, y0 - ep), anneau(s1, y1 - ep)
        for i in range(4):
            j = (i + 1) % 4
            teinte = (0.95 + 0.05 * (k % 2),) * 3
            toit.quad([a0[i], a1[i], a1[j], a0[j]], teinte)
            # Le dessous : le lambris du plafond, en cèdre.
            bois.quad([d0[i], d0[j], d1[j], d1[i]])
    # La rive de l'égout : un bandeau d'épaisseur.
    s, y = anneaux[-1]
    haut, bas = anneau(s, y), anneau(s, y - ep)
    for i in range(4):
        j = (i + 1) % 4
        toit.quad([bas[i], bas[j], haut[j], haut[i]], (0.8, 0.8, 0.8))
    # Les tuiles : de fins rangs en saillie, parallèles à l'égout, sur chaque pan.
    for k in range(2, N + 1, 1):
        s, y = anneaux[k]
        for i in range(4):
            j = (i + 1) % 4
            (xa, ya, za), (xb, yb, zb) = anneau(s, y + 0.035)[i], anneau(s, y + 0.035)[j]
            toit.cylindre((xa, za, -ya), (xb, zb, -yb), 0.035, n=5, couleur=(0.75, 0.75, 0.78))
    # Les arêtiers, un gros boudin le long de chaque diagonale, et l'épi de bronze.
    for a, b in coins:
        for k in range(N):
            (s0, y0), (s1, y1) = anneaux[k], anneaux[k + 1]
            toit.cylindre((cx + a * s0, y0 + 0.07, cz + b * s0), (cx + a * s1, y1 + 0.07, cz + b * s1), 0.075, n=6, couleur=(0.7, 0.7, 0.72))
    bois.cylindre((cx, faite - 0.05, cz), (cx, faite + 0.28, cz), 0.07, n=10, couleur=(0.9, 0.7, 0.4))
    bois.cylindre((cx, faite + 0.28, cz), (cx, faite + 0.34, cz), 0.12, n=12, couleur=(0.9, 0.7, 0.4))
    bois.cylindre((cx, faite + 0.34, cz), (cx, faite + 0.55, cz), 0.06, n=10, couleur=(0.9, 0.7, 0.4))
    # Le banc, le long du côté sud, entre les poteaux.
    bp, bh = P["banc"]["profondeur"], P["banc"]["hauteur"]
    z1 = cz + p - po
    bois.boite(cx - p + po, cx + p - po, H + bh - 0.05, H + bh, z1 - bp, z1)
    for x in (cx - p + 0.4, cx, cx + p - 0.4):
        bois.boite(x - 0.05, x + 0.05, H, H + bh - 0.05, z1 - bp + 0.05, z1 - 0.05)
    # La lanterne de papier, pendue à l'entrait par un cordon.
    yc, r, hl = egout - 0.75, 0.21, 0.36
    bois.cylindre((cx, yc + hl / 2, cz), (cx, egout - 0.16, cz), 0.008, n=4)
    bois.cylindre((cx, yc + hl / 2, cz), (cx, yc + hl / 2 + 0.04, cz), r * 0.55, n=12)
    bois.cylindre((cx, yc - hl / 2 - 0.04, cz), (cx, yc - hl / 2, cz), r * 0.55, n=12)
    anneaux_l = [(r * math.sin(math.pi * (0.18 + 0.64 * k / 8)), yc - hl / 2 + hl * k / 8) for k in range(9)]
    for k in range(8):
        (r0, y0), (r1, y1) = anneaux_l[k], anneaux_l[k + 1]
        for i in range(16):
            a, b2 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16
            lueur.quad([(cx + r0 * math.cos(a), -(cz + r0 * math.sin(a)), y0), (cx + r0 * math.cos(b2), -(cz + r0 * math.sin(b2)), y0),
                        (cx + r1 * math.cos(b2), -(cz + r1 * math.sin(b2)), y1), (cx + r1 * math.cos(a), -(cz + r1 * math.sin(a)), y1)])


# ── La palissade et la porte du roji ────────────────────────────────────────

def lin(r, g, b):
    """Une couleur sRGB 0-255 en linéaire : la couleur de sommet multiplie la matière."""
    return tuple(((c / 255 + 0.055) / 1.055) ** 2.4 for c in (r, g, b))


# Le bambou qui a vécu : du blond doré au vert passé, jusqu'au gris argent des tiges les plus exposées.
TEINTES_BAMBOU = [lin(196, 162, 104), lin(180, 158, 92), lin(168, 160, 102), lin(158, 150, 128), lin(142, 138, 124), lin(202, 172, 118)]
RAIL = lin(74, 52, 32)
CORDE = lin(14, 13, 12)
POTEAU = lin(120, 110, 88)


def melange(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def teinte_du_pan(sx, k):
    """
    La teinte d'une tige : par plages le long de la palissade, du blond doré au
    gris argent (le soleil et la pluie n'ont pas frappé partout pareil), un
    reste de vert par endroits, et chaque tige un peu plus claire ou plus sombre
    que sa voisine — pas de rayures.
    """
    gris = 0.5 + 0.5 * math.sin(sx * 0.37 + 1.3) * math.cos(sx * 0.11 + 0.4)
    vert = max(0.0, math.sin(sx * 0.23 + 2.1)) ** 2 * 0.6
    c = melange(melange(lin(196, 164, 106), lin(150, 146, 128), gris), lin(160, 158, 96), vert)
    return tuple(x * (0.9 + 0.2 * hache(k, 7)) for x in c)


def chaume(m, cx, cz, ux, uz, nx, nz, w, d, haut, k, base):
    """
    Une demi-tige de bambou refendu, debout, la peau vers le dehors : section en
    demi-lentille (bombée devant, plate au dos), ses NŒUDS tous les 28 à 62 cm,
    un bourrelet sombre et net ; le pied grisé par les éclaboussures.

    Chaque tige a son propre pas : d'une latte à l'autre, les nœuds ne
    tombent jamais en rangs. L'entre-nœud reste d'une seule teinte, le nœud
    n'assombrit que ses deux centimètres (sinon le dégradé de sommet à sommet
    dessine de grandes bandes).
    """
    pied = lin(96, 92, 80)
    # Les anneaux : (hauteur, renflement, assombrissement).
    anneaux = [(0.02, 1.0, 0.0)]
    h = 0.05 + 0.55 * hache(k, 8)
    j = 0
    while h < haut - 0.12:
        anneaux += [(h - 0.015, 1.0, 0.0), (h, 1.12, 0.36), (h + 0.02, 1.0, 0.0)]
        j += 1
        h += 0.28 + 0.34 * hache(k * 7 + j, 9)
    anneaux.append((haut, 1.0, 0.0))
    # La section : le dos plat contre l'âme, la peau bombée vers `n`.
    sec = [(0.5, 0.0), (0.22, 0.85), (-0.22, 0.85), (-0.5, 0.0)]
    n0 = len(m.v)
    for y, r, sombre in anneaux:
        c = melange(base, pied, max(0.0, 1 - y / 0.35) * 0.7)
        c = tuple(x * (1 - sombre) for x in c)
        for a, b in sec:
            du, dv = a * w * r, b * d * r
            m.v.append((cx + ux * du + nx * dv, -(cz + uz * du + nz * dv), y))
            m.c.append(c)
    for i in range(len(anneaux) - 1):
        for j in range(3):
            a, b = n0 + i * 4 + j, n0 + i * 4 + j + 1
            m.f.append((a, b, b + 4, a + 4))


def pan(bambou, bois, x0, z0, x1, z1, haut, depart=0):
    """
    Un pan de kenninji-gaki de (x0, z0) à (x1, z1), au sol (cote 0) : des demi-
    tiges de bambou debout, serrées, en quinconce ; trois paires de lisses de
    bambou sombre, liées de corde noire ; un chapeau de bambou ; des poteaux ronds.
    """
    l = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / l, (z1 - z0) / l
    nx, nz = -uz, ux
    pt = lambda s, v: (x0 + ux * s + nx * v, z0 + uz * s + nz * v)
    LARGE = 0.085
    n = int(l / LARGE)
    # Deux faces de tiges jointives, dos à dos, la seconde décalée d'une demi-tige.
    for face, decale in ((1, 0.0), (-1, 0.5)):
        for i in range(n):
            k = depart + i + (0 if face > 0 else 100000)
            cx, cz = pt((i + 0.5 + decale) % n * LARGE if decale else (i + 0.5) * LARGE, 0.012 * face)
            sx = (i + 0.5) * LARGE + depart * LARGE
            chaume(bambou, cx, cz, ux, uz, nx * face, nz * face, LARGE * 1.06, 0.022, haut - 0.02 - 0.05 * hache(k, 3), k, teinte_du_pan(sx, k))
    # L'âme de la palissade : un fond sombre entre les deux faces de tiges, qu'on ne voit qu'entre elles.
    (ax, az), (bx, bz) = pt(0, -0.006), pt(l, 0.006)
    bambou.boite(min(ax, bx), max(ax, bx), 0.03, haut - 0.04, min(az, bz), max(az, bz), lin(48, 38, 26))
    # Les lisses (oshibuchi) : trois rangs, un bambou sombre de chaque côté.
    for y in (0.38, 1.0, 1.55):
        for v in (-0.045, 0.045):
            a, b = pt(0, v), pt(l, v)
            bambou.cylindre((a[0], y, a[1]), (b[0], y, b[1]), 0.022, n=6, couleur=RAIL)
        # Les ligatures de corde noire, tous les 30 cm environ : un nœud croisé qui traverse.
        m = max(2, round(l / 0.3))
        for j in range(1, m):
            x, z = pt(l * j / m, 0)
            dx, dz = ux * 0.011, uz * 0.011
            ex, ez = nx * 0.07, nz * 0.07
            xs = [x - dx - ex, x + dx - ex, x - dx + ex, x + dx + ex]
            zs = [z - dz - ez, z + dz - ez, z - dz + ez, z + dz + ez]
            bois.boite(min(xs), max(xs), y - 0.018, y + 0.018, min(zs), max(zs), CORDE)
    # Le chapeau (tamabuchi) : un gros bambou refendu à cheval sur les tiges, et un plus mince dessus.
    a, b = pt(0, 0), pt(l, 0)
    bambou.cylindre((a[0], haut + 0.0, a[1]), (b[0], haut + 0.0, b[1]), 0.05, n=8, couleur=RAIL)
    bambou.cylindre((a[0], haut + 0.06, a[1]), (b[0], haut + 0.06, b[1]), 0.022, n=6, couleur=melange(RAIL, CORDE, 0.3))
    # Les poteaux ronds, tous les 1,80 m, gris d'avoir vécu, liés au chapeau.
    m = max(1, round(l / 1.8))
    for j in range(m + 1):
        x, z = pt(l * j / m, 0)
        bambou.cylindre((x, 0, z), (x, haut + 0.12, z), 0.052, n=8, couleur=POTEAU)
        bois.boite(x - 0.06, x + 0.06, haut - 0.03, haut + 0.05, z - 0.06, z + 0.06, CORDE)
    return n


def roji(bambou, bois, toit):
    F, G, J = B["palissade"], B["porte"], B["roji"]
    E = B["emprise"]
    ga, gb = J["x"] - G["passage"] / 2, J["x"] + G["passage"] / 2
    n = pan(bambou, bois, F["x"], F["z0"], F["x"], F["z1"], F["haut"])
    n += pan(bambou, bois, F["x"], G["z"], ga - 0.1, G["z"], F["haut"], n)
    pan(bambou, bois, gb + 0.1, G["z"], E["x"] + E["width"] + 1.95, G["z"], F["haut"], n)
    # La porte : deux poteaux, une traverse débordante, un toit à deux pans sur ses chevrons.
    po, hp, z = G["poteau"] / 2, G["haut"], G["z"]
    for x in (ga, gb):
        toit.boite(x - 0.16, x + 0.16, -0.05, 0.12, z - 0.16, z + 0.16, (0.55, 0.55, 0.55))
        bois.boite(x - po, x + po, 0.12, hp, z - po, z + po)
    bois.boite(ga - 0.45, gb + 0.45, hp - 0.42, hp - 0.24, z - 0.07, z + 0.07)
    bois.boite(ga - 0.3, gb + 0.3, hp - 0.05, hp + 0.05, z - 0.09, z + 0.09)
    xa, xb = ga - 0.7, gb + 0.7
    faite, egout, prof = hp + 0.62, hp + 0.12, 0.85
    for s in (-1, 1):
        for y_off, mat, teinte in ((0.0, toit, (0.85, 0.85, 0.85)), (-0.07, bois, (1, 1, 1))):
            a = [(xa, -(z), faite + y_off), (xb, -(z), faite + y_off), (xb, -(z + s * prof), egout + y_off), (xa, -(z + s * prof), egout + y_off)]
            mat.quad(a if (s > 0) == (y_off == 0) else a[::-1], teinte)
        # La rive : l'épaisseur du pan, au bas et aux pignons.
        toit.quad([(xa, -(z + s * prof), egout - 0.07), (xb, -(z + s * prof), egout - 0.07), (xb, -(z + s * prof), egout), (xa, -(z + s * prof), egout)], (0.7, 0.7, 0.7))
        for k in range(1, 8):
            zz = z + s * prof * k / 8
            yy = faite + (egout - faite) * k / 8 + 0.03
            toit.cylindre((xa, yy, zz), (xb, yy, zz), 0.03, n=5, couleur=(0.75, 0.75, 0.78))
    toit.cylindre((xa - 0.05, faite + 0.04, z), (xb + 0.05, faite + 0.04, z), 0.07, n=6, couleur=(0.7, 0.7, 0.72))


def lanterne(pierre, lueur):
    """
    La lanterne de pierre du coin de la terrasse (ishi-dōrō), 1,35 m : un socle
    hexagonal, un fût, une tablette, le foyer ajouré — le papier y luit la nuit —,
    un chapeau à six pans et son bouton. Du granit, en couleur de sommets.
    """
    L = B["lanterne"]
    x, z = L["x"], L["z"]
    gris = lin(150, 148, 140)
    sombre = lin(118, 116, 108)
    y = H
    pierre.cylindre((x, y - 0.02, z), (x, y + 0.12, z), 0.24, n=6, couleur=sombre)
    pierre.cylindre((x, y + 0.12, z), (x, y + 0.6, z), 0.075, n=8, couleur=gris)
    pierre.cylindre((x, y + 0.6, z), (x, y + 0.7, z), 0.2, n=6, couleur=gris)
    pierre.cylindre((x, y + 0.7, z), (x, y + 0.75, z), 0.16, n=6, couleur=gris)
    lueur.cylindre((x, y + 0.75, z), (x, y + 0.95, z), 0.13, n=6)
    for k in range(6):
        a = math.pi / 6 + k * math.pi / 3
        px, pz = x + 0.145 * math.cos(a), z + 0.145 * math.sin(a)
        pierre.cylindre((px, y + 0.75, pz), (px, y + 0.95, pz), 0.028, n=5, couleur=gris)
    pierre.cylindre((x, y + 0.95, z), (x, y + 1.0, z), 0.17, n=6, couleur=gris)
    # Le chapeau : un bord épais, puis six pans jusqu'à la pointe.
    r, y0, y1 = 0.33, y + 1.0, y + 1.05
    pierre.cylindre((x, y0, z), (x, y1, z), r, n=6, couleur=sombre)
    pointe = (x, -z, y + 1.22)
    for k in range(6):
        a, b2 = k * math.pi / 3, (k + 1) * math.pi / 3
        pa = (x + r * 0.98 * math.cos(a), -(z + r * 0.98 * math.sin(a)), y1)
        pb = (x + r * 0.98 * math.cos(b2), -(z + r * 0.98 * math.sin(b2)), y1)
        pierre.quad([pa, pb, pointe], sombre)
    pierre.cylindre((x, y + 1.18, z), (x, y + 1.27, z), 0.055, n=8, couleur=gris)
    pierre.cylindre((x, y + 1.27, z), (x, y + 1.35, z), 0.035, n=8, couleur=gris)


def construire():
    mats = {
        "bois": matiere("Belvedere_Bois", (0.16, 0.085, 0.05), 0.72),
        "toit": matiere("Belvedere_Toit", (0.1, 0.1, 0.11), 0.55),
        "bambou": matiere("Belvedere_Bambou", (1.0, 1.0, 1.0), 0.48),
        "lueur": matiere("Belvedere_Lueur", (0.95, 0.88, 0.72), 0.6, emission=(1.0, 0.62, 0.3), force=3.0),
    }
    m = {k: Maillage() for k in mats}
    pavillon(m["bois"], m["toit"], m["lueur"])
    roji(m["bambou"], m["bois"], m["toit"])
    lanterne(m["bambou"], m["lueur"])
    racine = bpy.data.objects.new("Belvedere", None)
    bpy.context.collection.objects.link(racine)
    total = 0
    for k, mm in m.items():
        o = mm.objet(f"Belvedere_{k.capitalize()}", mats[k])
        o.parent = racine
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        total += tris
        print(f"  {o.name}: {tris} triangles")
    print(f"  total {total} triangles")


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_vertex_color="ACTIVE", export_draco_mesh_compression_enable=True)
    print(f"belvedere : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


def apercu(dossier):
    from mathutils import Vector

    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    monde = bpy.data.worlds.new("Ciel")
    scene.world = monde
    monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.62, 0.72, 0.85, 1)
    fond.inputs["Strength"].default_value = 0.8
    soleil = bpy.data.lights.new("Soleil", "SUN")
    soleil.energy = 4
    so = bpy.data.objects.new("Soleil", soleil)
    so.rotation_euler = (math.radians(45), 0, math.radians(-30))
    scene.collection.objects.link(so)
    # La terrasse, en blocs gris, pour situer le pavillon.
    E = B["emprise"]
    bpy.ops.mesh.primitive_cube_add(location=(E["x"] + E["width"] / 2, -(E["z"] + E["depth"] / 2), H / 2 - 0.2))
    t = bpy.context.active_object
    t.scale = (E["width"] / 2, E["depth"] / 2, H / 2 + 0.2)
    mt = matiere("Pierre", (0.72, 0.68, 0.6), 0.8)
    t.data.materials.append(mt)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(75, -45, 0))
    bpy.context.active_object.data.materials.append(matiere("Herbe", (0.2, 0.32, 0.12), 0.9))
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 32
    scene.collection.objects.link(cam)
    scene.camera = cam
    P, G = B["pavillon"], B["porte"]
    for nom, cible, depuis in (
        ("pavillon", Vector((P["x"], -P["z"], H + 2.2)), Vector((P["x"] - 9, -(P["z"] - 8), H + 3.5))),
        ("roji", Vector((B["roji"]["x"], -(G["z"] + 6), 1.3)), Vector((B["roji"]["x"] - 0.3, -(G["z"] - 5), 1.6))),
        ("palissade", Vector((B["palissade"]["x"], -38, 1.0)), Vector((B["palissade"]["x"] - 4, -35, 1.6))),
    ):
        cam.location = depuis
        cam.rotation_euler = (cible - depuis).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(dossier / f"{nom}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    repartir()
    construire()
    if "--apercu" in args:
        apercu(args[args.index("--apercu") + 1])
    else:
        exporter()
