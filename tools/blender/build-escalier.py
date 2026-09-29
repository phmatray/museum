"""
L'escalier impérial du hall, en marbre, à la manière du Grand Escalier de
l'Opéra Garnier, généré par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-escalier.py

Produit `public/assets/architecture/escalier.glb` : les trois volées et le
palier. Marches de marbre crème à nez arrondi (un demi-rond qui déborde), les
trois premières marches de la volée centrale évasées en bulbe comme la cascade
de Garnier, limons de griotte rouge veinée soulignés d'une moulure crème, et
un palier poli bordé d'un filet de griotte, sa rive tenue par une corniche.

Les garde-corps de verre ne sont PAS ici : `plan/mesh.ts` les calcule toujours.

Le fichier est modélisé DANS le repère du plan : x Blender = x du plan,
y Blender = -z du plan, z Blender = la hauteur. L'export glTF (+Y en haut) le
rend donc directement dans le repère de three, sans aucune transformation.

Les marches sont celles de `marches()` (src/plan/mesh.ts) : 15 parts égales
par volée, le dessus de la marche k au haut de la rampe que suit la marche du
visiteur. Rien ne dépasse la rampe de plus d'une contremarche.

Déterministe : le veinage vient d'un bruit à graine fixe, aucune horloge.
"""

import math
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:  # exécuté depuis le MCP, sans __file__
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "escalier.glb"

# ── L'escalier, lu dans src/plan/musee.ts ─────────────────────────────────
PALIER = 2.4                 # le palier, à mi-étage
ETAGE = 4.8
DALLE = 0.3
RISERS = 15
# (id, x, z, largeur, profondeur, sens de la montée, bas, haut)
VOLEES = [
    ("centrale", 21.0, 15.5, 6.0, 4.5, "north", 0.0, PALIER),
    ("ouest", 16.0, 15.5, 3.0, 4.5, "south", PALIER, ETAGE),
    ("est", 29.0, 15.5, 3.0, 4.5, "south", PALIER, ETAGE),
]
PAL = (16.0, 32.0, 12.0, 15.5)   # x0, x1, z0, z1 du palier

# ── Le dessin ─────────────────────────────────────────────────────────────
NEZ = 0.035          # débord du nez de marche au-delà de la contremarche
EP_NEZ = 0.05        # épaisseur du nez : un demi-rond de 2,5 cm de rayon
SAILLIE = 0.06       # le limon de griotte sort du nu des marches
PAILLASSE = 0.36     # épaisseur (verticale) de la paillasse des volées latérales
# L'évasement des marches du bas de la volée centrale : de chaque côté, la
# saillie du bulbe. Tout rentre dans z > 18,95, et jamais à l'ouest de x 20,2 :
# la niche de Bavette, sous la volée ouest, reste dégagée.
EVASEMENT = [0.8, 0.52, 0.27]
FOND_BULBE = 18.95


def repartir():
    """Vide la scène sans `read_factory_settings`, qui déchargerait l'addon MCP."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


# ── Le veinage : un bruit périodique, donc une texture qui se répète sans couture ──


def bruit(u, v, periode, rng):
    """Bruit de valeurs périodique : une grille `periode`², lue en (u, v) modulo 1, en douceur."""
    g = rng.random((periode, periode))
    x, y = u * periode, v * periode
    i, j = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - i, y - j
    fx, fy = [f * f * f * (f * (6 * f - 15) + 10) for f in (fx, fy)]  # quintique : pas de grille visible
    i0, j0, i1, j1 = i % periode, j % periode, (i + 1) % periode, (j + 1) % periode
    a = g[i0, j0] * (1 - fx) + g[i1, j0] * fx
    b = g[i0, j1] * (1 - fx) + g[i1, j1] * fx
    return a * (1 - fy) + b * fy


def fbm(u, v, rng, base=4, octaves=6):
    s = np.zeros_like(u)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s += amp * bruit(u, v, base * 2 ** o, rng)
        tot += amp
        amp *= 0.5
    return s / tot


def grille(n):
    v, u = np.meshgrid(np.arange(n) / n, np.arange(n) / n)
    return u, v


def veines(u, v, rng, frequence, trouble, finesse):
    """
    Des veines : les zéros d'un sinus froissé par un bruit lui-même déformé
    (domain warping) — des filets qui serpentent, s'épaississent et s'effacent.
    Rend le filet et son voile, plus large et plus pâle.
    """
    wu, wv = fbm(u, v, rng, base=2), fbm(u, v, rng, base=2)
    froisse = fbm(u + 0.35 * wu, v + 0.35 * wv, rng, base=3)
    fx, fy = frequence
    t = np.sin(2 * np.pi * (fx * u + fy * v) + trouble * froisse)
    largeur = finesse * (0.35 + 1.3 * fbm(u, v, rng, base=4))
    return np.exp(-(t / largeur) ** 2), np.exp(-(t / (5 * largeur)) ** 2)


def image(nom, rgb):
    """Une image Blender en sRGB, enregistrée en JPEG puis embarquée dans le .blend."""
    n = rgb.shape[0]
    img = bpy.data.images.new(nom, n, n, alpha=False)
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, n, 1))], axis=2)
    # Blender range les pixels du bas vers le haut : on retourne, pour rester lisible.
    img.pixels.foreach_set(px[::-1].astype(np.float32).ravel())
    chemin = Path(tempfile.gettempdir()) / f"{nom}.jpg"
    img.filepath_raw = str(chemin)
    img.file_format = "JPEG"
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 82
    scene.view_settings.view_transform = "Standard"  # les pixels tels quels, sans courbe de film
    img.save_render(str(chemin), scene=scene)
    bpy.data.images.remove(img)
    img = bpy.data.images.load(str(chemin))
    img.name = nom
    img.pack()
    return img


def marbre_blanc(n=1024):
    """Le marbre des marches : un crème chaud, nuagé, veiné de gris doré, sans excès."""
    rng = np.random.default_rng(1875)  # l'année de l'inauguration de Garnier
    u, v = grille(n)
    nuage = fbm(u, v, rng, base=3)[..., None]
    fond = np.array([0.95, 0.92, 0.85]) + (nuage - 0.5) * np.array([0.08, 0.08, 0.10])
    fil, voile = veines(u, v, rng, (2, 1), 5.0, 0.05)
    fil2, voile2 = veines(u, v, rng, (1, -3), 8.0, 0.03)
    k = (0.36 * fil + 0.08 * voile + 0.2 * fil2 + 0.04 * voile2)[..., None]
    return fond * (1 - k) + np.array([0.66, 0.61, 0.52]) * k


def griotte(n=512):
    """La griotte des limons : un rouge profond marbré de sombre, veiné de rose pâle."""
    rng = np.random.default_rng(1669)
    u, v = grille(n)
    nuage = np.clip((fbm(u, v, rng, base=3) - 0.3) * 2.2, 0, 1)[..., None]
    fond = np.array([0.50, 0.12, 0.09]) * (1 - nuage) + np.array([0.26, 0.05, 0.05]) * nuage
    fil, voile = veines(u, v, rng, (1, 2), 6.0, 0.04)
    k = (0.42 * fil + 0.08 * voile)[..., None]
    return fond * (1 - k) + np.array([0.88, 0.70, 0.62]) * k


def matiere(nom, img, rugosite, tuile):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = rugosite
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    m["tuile"] = tuile  # mètres couverts par une répétition de la carte
    return m


# ── Le maillage ───────────────────────────────────────────────────────────


class Maillage:
    """Accumule sommets et faces par matériau, puis un seul objet."""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def face(self, pts, mat):
        i = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(i, i + len(pts))))
        self.m.append(mat)

    def balayage(self, anneaux, mats, fermer=True, boucle=False):
        """
        Relie des anneaux successifs de même nombre de sommets. `mats` donne le
        matériau de chaque côté d'anneau (un seul pour tous, ou un par côté).
        """
        n = len(anneaux[0])
        cotes = n if boucle else n - 1
        if not isinstance(mats, list):
            mats = [mats] * cotes
        for k in range(len(anneaux) - 1):
            for j in range(cotes):
                a, b = anneaux[k][j], anneaux[k][(j + 1) % n]
                c, d = anneaux[k + 1][(j + 1) % n], anneaux[k + 1][j]
                self.face([a, b, c, d], mats[j])
        if fermer:
            self.face(list(anneaux[0])[::-1], mats[0])
            self.face(list(anneaux[-1]), mats[0])

    def objet(self, nom, mats, lisse=math.radians(35), orienter=True):
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
        if orienter:  # des solides fermés : les normales vers le dehors, quel que soit le sens de saisie
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # Des UV « en boîte » : chaque face prend les deux axes de sa normale
        # dominante, en mètres divisés par la tuile de son matériau. Le veinage
        # court ainsi d'une marche à l'autre sans étirement.
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            tuile = mats[f.material_index]["tuile"]
            ax = max(range(3), key=lambda i: abs(f.normal[i]))
            a, b = [i for i in range(3) if i != ax]
            for lo in f.loops:
                co = lo.vert.co
                lo[uv].uv = (co[a] / tuile, co[b] / tuile)
        bm.to_mesh(me)
        bm.free()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=lisse)
        o = bpy.data.objects.new(nom, me)
        bpy.context.collection.objects.link(o)
        return o


def pt(x, z, y):
    """Un point du plan (x, z, hauteur) dans le repère Blender."""
    return (x, -z, y)


def demi_rond(cx, cy, r, a0, a1, n=10):
    """Un arc (w, y) du profil, de l'angle a0 à a1."""
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def profil_marche(dessus, bas, giron):
    """
    Le profil d'une marche en (w, y) : w compte vers l'AVAL depuis la ligne de
    contremarche, y est la hauteur. Du fond bas à l'avant, le nez en demi-rond,
    puis le dessus jusqu'au fond (1 cm sous la contremarche suivante).
    """
    r = EP_NEZ / 2
    p = [(-giron - 0.01, bas), (0.0, bas), (0.0, dessus - EP_NEZ), (NEZ - r, dessus - EP_NEZ)]
    p += demi_rond(NEZ - r, dessus - r, r, -math.pi / 2, math.pi / 2)[1:]
    p += [(-giron - 0.01, dessus)]
    return p


def marches(volee):
    """Comme `marches()` de mesh.ts : (ligne de contremarche, sens aval en z, dessus, h)."""
    _, x, z, w, d, sens, bas, haut = volee
    giron, h = d / RISERS, (haut - bas) / RISERS
    out = []
    for k in range(RISERS):
        if sens == "north":  # on monte vers le nord : l'aval est au sud (+z)
            out.append((z + d - k * giron, 1.0, bas + (k + 1) * h, h, giron))
        else:
            out.append((z + k * giron, -1.0, bas + (k + 1) * h, h, giron))
    return out


def rampe(volee, zz):
    """La ligne des pieds de contremarche : la rampe de `flightElevation`, une marche plus bas."""
    _, x, z, w, d, sens, bas, haut = volee
    t = (z + d - zz) / d if sens == "north" else (zz - z) / d
    return bas + (haut - bas) * t


def marche_droite(g, x0, x1, zr, sd, profil, mat):
    """Le profil balayé en travers de la volée, de x0 à x1."""
    anneaux = [[pt(x, zr + sd * w, y) for w, y in profil] for x in (x0, x1)]
    g.balayage(anneaux, mat, boucle=True)


def contour_bulbe(zf, e, n=14):
    """
    Le contour en plan d'une marche évasée : le devant droit en z = zf, puis
    à chaque bout un bulbe — deux quarts d'ellipse — qui rentre au nu de la
    volée en z = FOND_BULBE. Rend la liste (x, z, normale) de l'est à l'ouest
    par le devant, la normale pointant vers le dehors.
    """
    d1 = 0.55 * (zf - FOND_BULBE)
    d2 = (zf - FOND_BULBE) - d1
    zc = zf - d1

    def bout(x0, s):  # s = -1 à l'ouest, +1 à l'est
        pts = []
        for i in range(2 * n + 1):
            th = math.pi * i / (2 * n)
            dd = d1 if th <= math.pi / 2 else d2
            px, pz = x0 + s * e * math.sin(th), zc + dd * math.cos(th)
            # Normale de l'ellipse : le gradient de ((x-x0)/e)² + ((z-zc)/dd)².
            nx, nz = s * math.sin(th) / e, math.cos(th) / dd
            ln = math.hypot(nx, nz)
            pts.append((px, pz, nx / ln, nz / ln))
        return pts

    est = bout(27.0, 1.0)[::-1]           # du fond au devant
    ouest = bout(21.0, -1.0)              # du devant au fond
    return est + ouest


def marche_evasee(g, zf, e, dessus, h, mat):
    """
    Une marche du bas, pleine jusqu'au sol, balayée le long de son contour :
    le nez arrondi suit le devant ET les bulbes. Le dos est une corde droite,
    cachée sous la marche suivante.
    """
    r = EP_NEZ / 2
    prof = [(0.0, 0.0), (0.0, dessus - EP_NEZ), (NEZ - r, dessus - EP_NEZ)]
    prof += demi_rond(NEZ - r, dessus - r, r, -math.pi / 2, math.pi / 2, n=8)[1:]
    prof += [(-0.02, dessus)]
    anneaux = [[pt(x + nx * w, z + nz * w, y) for w, y in prof] for x, z, nx, nz in contour_bulbe(zf, e)]
    g.balayage(anneaux, mat, fermer=False)
    g.balayage([anneaux[-1], anneaux[0]], mat, fermer=False)  # le dos
    # Le dessus et le dessous : les polygones du dernier et du premier point du profil.
    g.face([a[-1] for a in anneaux][::-1], mat)
    g.face([a[0] for a in anneaux], mat)


def moulure(g, a, b, n_dehors, profil, mat):
    """
    Un profil (w, y) balayé en ligne droite de a à b (points du plan (x, z, y)) :
    w sort selon la normale horizontale `n_dehors`, y monte d'aplomb. Sur une
    pente, le profil reste vertical : un cisaillement, comme les garde-corps.
    """
    nx, nz = n_dehors
    anneaux = [[pt(x + nx * w, z + nz * w, y + dy) for w, dy in profil] for x, z, y in (a, b)]
    g.balayage(anneaux, mat, boucle=True)


# Le tore qui coiffe un limon : un demi-rond sur un listel.
TORE = [(-0.01, -0.02), (0.012, -0.02)] + demi_rond(0.012, 0.0, 0.02, -math.pi / 2, math.pi / 2, n=8)[1:] + [(-0.01, 0.02)]
# La corniche du palier, du dessus (0) vers le bas : listel arrondi, gorge, baguette.
CORNICHE = (
    [(-0.01, 0.0), (0.055, 0.0)]
    + demi_rond(0.055, -0.03, 0.03, math.pi / 2, -math.pi / 2, n=8)[1:]
    + [(0.05, -0.06), (0.05, -0.08)]
    + [(0.05 - 0.05 * math.sin(t), -0.13 + 0.05 * math.cos(t)) for t in (math.pi / 2 * i / 6 for i in range(1, 7))]
    + [(0.0, -0.22)]
    + demi_rond(0.0, -0.245, 0.025, math.pi / 2, -math.pi / 2, n=6)[1:]
    + [(-0.01, -0.27)]
)


# ── Les pièces ────────────────────────────────────────────────────────────


def volee_centrale(g, blanc, rouge):
    v = VOLEES[0]
    _, x, z, w, d, _, bas, haut = v
    x0, x1 = x, x + w
    # Le massif : de la griotte du sol jusque sous les marches, un peu plus large
    # qu'elles. Son dessus suit la rampe ; ses flancs sont les limons.
    xa, xb = x0 - SAILLIE, x1 + SAILLIE
    za, zb = z, z + d
    g.balayage([[pt(xx, za, 0.0), pt(xx, zb, 0.0), pt(xx, za, rampe(v, za))] for xx in (xa, xb)], rouge, boucle=True)
    # Le tore crème qui borde chaque limon, juste sous le nez des marches, et la plinthe.
    for xx, s in ((xa, -1.0), (xb, 1.0)):
        zt = FOND_BULBE + 0.1  # devant, les bulbes couvrent le limon
        moulure(g, (xx, zt, rampe(v, zt)), (xx, za, rampe(v, za)), (s, 0.0), TORE, blanc)
        plinthe = [(-0.01, 0.0), (0.03, 0.0), (0.03, 0.14)] + demi_rond(0.015, 0.14, 0.015, 0.0, math.pi / 2, n=4)[1:] + [(-0.01, 0.155)]
        moulure(g, (xx, zt, 0.0), (xx, za, 0.0), (s, 0.0), plinthe, rouge)
    # Les marches : les trois du bas en bulbe, pleines jusqu'au sol, les autres droites.
    for k, (zr, sd, dessus, h, giron) in enumerate(marches(v)):
        if k < len(EVASEMENT):
            marche_evasee(g, zr, EVASEMENT[k], dessus, h, blanc)
        else:
            marche_droite(g, x0, x1, zr, sd, profil_marche(dessus, dessus - 2 * h, giron), blanc)


def volee_laterale(g, v, blanc, rouge):
    _, x, z, w, d, _, bas, haut = v
    # Le côté du hall prend le limon de griotte ; l'autre est contre le mur.
    cote_hall, s = (x + w, 1.0) if x < 24 else (x, -1.0)
    x0, x1 = x, x + w
    xa, xb = (x0, x1 + SAILLIE) if s > 0 else (x0 - SAILLIE, x1)
    za, zb = z, z + d
    # La paillasse : une dalle inclinée sous les marches. Dessous crème — c'est
    # le plafond de la niche de la sculpture, qu'il faut garder clair.
    # Au départ, la paillasse naît de la dalle du palier : son dessous part de la
    # sous-face du palier, sans dépasser dessous (elle pendait de 6 cm sous la
    # corniche, sa baguette finissant dans le vide).
    for_ = [(za, rampe(v, za)), (zb, rampe(v, zb))]
    sous = [PALIER - DALLE, for_[1][1] - PAILLASSE]
    anneaux = []
    for xx in (xa, xb):
        anneaux.append([pt(xx, za, sous[0]), pt(xx, zb, sous[1]), pt(xx, zb, for_[1][1]), pt(xx, za, for_[0][1])])
    g.balayage(anneaux, [blanc, rouge, rouge, rouge], boucle=True)
    # Les flancs (faces d'about) sont les limons : on les repeint en griotte.
    g.m[-2] = rouge
    g.m[-1] = rouge
    xl = xb if s > 0 else xa
    zt = zb - 0.12  # le tore s'arrête avant le balcon, sans dépasser son sol
    moulure(g, (xl, za, rampe(v, za)), (xl, zt, rampe(v, zt)), (s, 0.0), TORE, blanc)
    moulure(g, (xl, za, sous[0]), (xl, zb, sous[1]), (s, 0.0), TORE, blanc)
    for zr, sd, dessus, h, giron in marches(v):
        marche_droite(g, x0, x1, zr, sd, profil_marche(dessus, dessus - 2 * h, giron), blanc)


def palier(g, moulures, blanc, rouge):
    x0, x1, z0, z1 = PAL
    y1, y0 = PALIER, PALIER - DALLE
    # Le dessus : un dallage poli, bordé d'un filet de griotte de 20 cm.
    xs = [x0, x0 + 0.3, x0 + 0.5, x1 - 0.5, x1 - 0.3, x1]
    zs = [z0, z0 + 0.3, z0 + 0.5, z1 - 0.5, z1 - 0.3, z1]
    for i in range(5):
        for j in range(5):
            filet = (i in (1, 3) and 1 <= j <= 3) or (j in (1, 3) and 1 <= i <= 3)
            a, b, c, e = xs[i], xs[i + 1], zs[j], zs[j + 1]
            g.face([pt(a, e, y1), pt(b, e, y1), pt(b, c, y1), pt(a, c, y1)], rouge if filet else blanc)
    # La sous-face et les rives.
    g.face([pt(x0, z0, y0), pt(x1, z0, y0), pt(x1, z1, y0), pt(x0, z1, y0)], blanc)
    g.face([pt(x0, z1, y0), pt(x1, z1, y0), pt(x1, z1, y1), pt(x0, z1, y1)], blanc)
    # La corniche, sur la rive vue du hall : entre les volées, de limon à limon.
    for a, b in ((19.0 + SAILLIE, 21.0 - SAILLIE), (27.0 + SAILLIE, 29.0 - SAILLIE)):
        moulure(moulures, (b, z1, y1), (a, z1, y1), (0.0, 1.0), CORNICHE, blanc)


def construire():
    repartir()
    blanc = matiere("Escalier_Marbre", image("escalier-marbre", marbre_blanc()), 0.22, 1.6)
    rouge = matiere("Escalier_Griotte", image("escalier-griotte", griotte()), 0.25, 0.9)
    g, p = Maillage(), Maillage()
    volee_centrale(g, blanc, rouge)
    for v in VOLEES[1:]:
        volee_laterale(g, v, blanc, rouge)
    palier(p, g, blanc, rouge)
    objets = [g.objet("Escalier_Volees", [blanc, rouge], lisse=math.radians(40)),
              # Le palier n'est pas un solide fermé (ses côtés sont dans les murs) : saisi dans le bon sens.
              p.objet("Escalier_Palier", [blanc, rouge], orienter=False)]
    print(f"escalier : {sum(len(q.vertices) - 2 for o in objets for q in o.data.polygons)} triangles")


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_image_format="AUTO",
        export_draco_mesh_compression_enable=True,
    )
    print(f"escalier : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio)")


if __name__ == "__main__":
    construire()
    import sys
    if "--no-export" not in sys.argv:
        exporter()
