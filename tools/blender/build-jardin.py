"""
Le jardin japonais du parc, généré par Blender en headless.

    node tools/fetch-assets.ts --sources-vegetation   # rochers et fougère Poly Haven
    blender --background --python tools/blender/build-jardin.py

Produit `public/assets/jardin/jardin.glb`, d'après le jardin japonais de
Hasselt : un ruisseau qui serpente, passe sous un pont de bois et tombe en
petite cascade dans un étang sombre ; une lanterne de pierre,
des pas japonais. Et les sujets que `src/scene/JardinLayer.tsx` instancie :
érables du Japon rouge et vert, boules taillées (buis, azalée en fleur),
rochers moussus et fougère.

Le tracé est lu dans `src/plan/jardin.json`, la même source que la marche
(`src/plan/jardin.ts`) : la berge qu'on voit est celle qui arrête le visiteur.

Tout est modélisé DANS le repère du plan : x Blender = x du plan,
y Blender = -z du plan, z Blender = la hauteur. L'export glTF (+Y en haut) le
pose donc dans three sans transformation. Les sujets à instancier sont au
contraire modélisés à l'origine, pied à z = 0.

Déterministe : des tirages semés, aucune horloge.
"""

import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:  # exécuté depuis le MCP, sans __file__
    ROOT = Path(bpy.path.abspath("//")).resolve()
JARDIN = json.loads((ROOT / "src" / "plan" / "jardin.json").read_text())
PLANTES = ROOT / "public" / "assets" / "plants"
SORTIE = ROOT / "public" / "assets" / "jardin" / "jardin.glb"

ETANG = JARDIN["etang"]["niveau"]
RUISSEAU = JARDIN["ruisseau"]["niveau"]
PAS_GRILLE = 0.25  # divise toutes les bornes de zones : les coutures tombent sur des sommets communs

# Les sujets Poly Haven : (fichier, nœud, nom exporté, triangles gardés).
POLYHAVEN = [
    ("rock_moss_set_01", "rock_moss_set_01_rock01", "src_rocher_1", 900),
    ("rock_moss_set_01", "rock_moss_set_01_rock04", "src_rocher_2", 900),
    ("rock_moss_set_02", "rock_moss_set_02_rock11", "src_rocher_3", 900),
    ("rock_moss_set_02", "rock_moss_set_02_rock13", "src_rocher_4", 900),
    ("boulder_01", "boulder_01", "src_rocher_5", 1200),
    ("fern_02", "fern_02_b", "src_fougere", 1400),
]


# ── Géométrie du plan, en miroir de src/plan/jardin.ts ────────────────────

def lisser(pts, fermee, iterations=3):
    """Chaikin, exactement comme `lisser()` de jardin.ts."""
    p = [tuple(q) for q in pts]
    for _ in range(iterations):
        out = [] if fermee else [p[0]]
        n = len(p) if fermee else len(p) - 1
        for i in range(n):
            a, b = p[i], p[(i + 1) % len(p)]
            out.append(tuple(0.75 * u + 0.25 * v for u, v in zip(a, b)))
            out.append(tuple(0.25 * u + 0.75 * v for u, v in zip(a, b)))
        if not fermee:
            out.append(p[-1])
        p = out
    return p


def spline(pts, pas=0.5):
    """Catmull-Rom centripète (Barry-Goldman), exactement comme `spline()` de jardin.ts."""
    n = len(pts)

    def P(i):
        if i < 0:
            return [2 * v - w for v, w in zip(pts[0], pts[1])]
        if i >= n:
            return [2 * v - w for v, w in zip(pts[n - 1], pts[n - 2])]
        return list(pts[i])

    def noeud(a, b):
        return math.sqrt(math.hypot(b[0] - a[0], b[1] - a[1])) or 1e-6

    def lerp(a, b, ta, tb, t):
        return [((tb - t) * v + (t - ta) * w) / (tb - ta) for v, w in zip(a, b)]

    out = []
    for i in range(n - 1):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        t1 = noeud(p0, p1)
        t2 = t1 + noeud(p1, p2)
        t3 = t2 + noeud(p2, p3)
        m = max(1, math.ceil(math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / pas))
        for j in range(m):
            t = t1 + (t2 - t1) * j / m
            a1, a2, a3 = lerp(p0, p1, 0, t1, t), lerp(p1, p2, t1, t2, t), lerp(p2, p3, t2, t3, t)
            b1, b2 = lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t)
            out.append(tuple(lerp(b1, b2, t1, t2, t)))
    out.append(tuple(pts[-1]))
    return out


CONTOUR = np.array(lisser(JARDIN["etang"]["contour"], True))
TRACE = np.array(spline(JARDIN["ruisseau"]["trace"]))
BERGE_RUISSEAU = 1.3  # comme jardin.ts
LEVRE_BERGE = 0.45
FIL_DE_L_EAU = RUISSEAU - 0.03
SOUS_LA_RIVE = 0.25
BOMBE_LEVRE = 0.16  # comme jardin.ts


def dist_segments(px, pz, a, b):
    """Distance de chaque point (px, pz) à chaque segment [a, b] ; renvoie (min, t, indice)."""
    d = b - a
    l2 = (d ** 2).sum(1)
    t = ((px[:, None] - a[None, :, 0]) * d[None, :, 0] + (pz[:, None] - a[None, :, 1]) * d[None, :, 1]) / l2[None]
    t = np.clip(t, 0, 1)
    qx = a[None, :, 0] + t * d[None, :, 0]
    qz = a[None, :, 1] + t * d[None, :, 1]
    dist = np.hypot(px[:, None] - qx, pz[:, None] - qz)
    i = dist.argmin(1)
    r = np.arange(len(px))
    return dist[r, i], t[r, i], i


def sdf_etang(px, pz):
    """Distance signée au bord de l'étang : négative dans l'eau."""
    a, b = CONTOUR, np.roll(CONTOUR, -1, axis=0)
    d, _, _ = dist_segments(px, pz, a, b)
    dedans = np.zeros(len(px), bool)
    for (xi, zi), (xj, zj) in zip(a, b):
        croise = ((zi > pz) != (zj > pz)) & (px < (xj - xi) * (pz - zi) / (zj - zi + 1e-12) + xi)
        dedans ^= croise
    return np.where(dedans, -d, d)


def sdf_ruisseau(px, pz, trace=TRACE, largeur=False):
    a, b = trace[:-1, :2], trace[1:, :2]
    d, t, i = dist_segments(px, pz, a, b)
    w = trace[i, 2] + t * (trace[i + 1, 2] - trace[i, 2])
    return (d - w / 2, w) if largeur else d - w / 2


def creux_ruisseau(px, pz):
    """Le lit creusé : le miroir exact de `creuxDuRuisseau` (jardin.ts)."""
    d, w = sdf_ruisseau(px, pz, largeur=True)
    berge = FIL_DE_L_EAU * (0.55 * np.clip(1 - d / LEVRE_BERGE, 0, 1) ** 2 + 0.45 * np.clip(1 - d / BERGE_RUISSEAU, 0, 1) ** 2)
    fond = 0.07 + 0.2 * np.clip((w - 1.4) / 1.4, 0, 1)
    s = np.clip(-d / np.minimum(0.7, w / 2), 0, 1)
    lit = FIL_DE_L_EAU - fond * s * s * (3 - 2 * s)
    return np.where(d >= 0, berge, lit)


def hauteur(px, pz):
    """
    Le sol du jardin. Une berge d'étang BOMBÉE — pente nulle côté pelouse,
    raide au fil de l'eau — comme les rives gazonnées de Hasselt ; le lit du
    ruisseau creusé d'une vingtaine de centimètres sous la pelouse, sa berge
    raide au fil de l'eau, son fond plus creux dans les mouilles.
    """
    sp = sdf_etang(px, pz)
    s = np.clip(sp / 1.8, 0, 1)
    hp = np.where(sp >= 0, ETANG * (1 - s) ** 2, np.maximum(-0.9, ETANG + 0.5 * sp))
    return np.minimum(hp, creux_ruisseau(px, pz))


# ── Outils Blender ────────────────────────────────────────────────────────

def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def matiere(nom, couleur, rugosite, emission=None, force=1.0, image=None):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = force
    if image is not None:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        m.node_tree.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
        m.use_backface_culling = False
    return m


class Maillage:
    """Accumule sommets, faces, matériaux et normales, puis un objet."""

    def __init__(self):
        self.v, self.f, self.m, self.uv, self.n = [], [], [], [], []

    def face(self, pts, mat, uvs=None, normales=None):
        i0 = len(self.v)
        self.v.extend(pts)
        self.f.append(list(range(i0, i0 + len(pts))))
        self.m.append(mat)
        self.uv.append(uvs)
        self.n.extend(normales or [None] * len(pts))

    def objet(self, nom, lisse=None):
        mats = list(dict.fromkeys(self.m))
        me = bpy.data.meshes.new(nom)
        me.from_pydata(self.v, [], self.f)
        for m in mats:
            me.materials.append(m)
        for p, m in zip(me.polygons, self.m):
            p.material_index = mats.index(m)
        if any(u is not None for u in self.uv):
            couche = me.uv_layers.new(name="UVMap")
            for p, uvs in zip(me.polygons, self.uv):
                for k, li in enumerate(p.loop_indices):
                    couche.data[li].uv = uvs[k] if uvs else (0.5, 0.5)
        me.validate()
        # Les faces se tournent vers l'extérieur, et une nappe (l'eau) vers le ciel :
        # three ne dessine que les faces avant.
        bm = bmesh.new()
        bm.from_mesh(me)
        if not any(n is not None for n in self.n):
            # Chaque face a ses propres sommets : recollés, les prismes redeviennent
            # des volumes fermés dont Blender sait trouver l'extérieur.
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        if nom.startswith(("Jardin_Eau", "Jardin_Cascade")):
            for f in bm.faces:
                if f.normal.z < -0.5:
                    f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        if any(n is not None for n in self.n):
            me.normals_split_custom_set_from_vertices([tuple(c / (math.sqrt(sum(d * d for d in n)) or 1) for c in n) if n else (0, 0, 1) for n in self.n])
        elif lisse is not None:
            for p in me.polygons:
                p.use_smooth = True
            me.set_sharp_from_angle(angle=lisse)
        o = bpy.data.objects.new(nom, me)
        bpy.context.collection.objects.link(o)
        return o


def prisme(g, pts_bas, z0, z1, mat, pts_haut=None):
    """Un prisme à base polygonale (plan x, y Blender), faces fermées."""
    pts_haut = pts_haut or pts_bas
    n = len(pts_bas)
    bas = [(x, y, z0) for x, y in pts_bas]
    haut = [(x, y, z1) for x, y in pts_haut]
    g.face(list(reversed(bas)), mat)
    g.face(haut, mat)
    for i in range(n):
        j = (i + 1) % n
        g.face([bas[i], bas[j], haut[j], haut[i]], mat)


def cercle(cx, cy, r, n, phase=0.0, ry=None):
    ry = ry if ry is not None else r
    return [(cx + r * math.cos(phase + 2 * math.pi * k / n), cy + ry * math.sin(phase + 2 * math.pi * k / n)) for k in range(n)]


def boite(g, x0, x1, y0, y1, z0, z1, mat):
    prisme(g, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat)


# ── Le sol ────────────────────────────────────────────────────────────────

def terrain(sol):
    """
    Une grille par zone, creusée par `hauteur`, puis dissoute là où elle est
    plane : la pelouse loin de l'eau tient en quelques grands polygones.
    Une jupe de 40 cm borde chaque zone, comme l'épaisseur de la pelouse
    (ParkLayer) : du bord du monde, on ne voit pas une feuille de papier.
    """
    objets = []
    for k, z in enumerate(JARDIN["zones"]):
        nx, nz = round(z["width"] / PAS_GRILLE), round(z["depth"] / PAS_GRILLE)
        xs = z["x"] + np.arange(nx + 1) * PAS_GRILLE
        zs = z["z"] + np.arange(nz + 1) * PAS_GRILLE
        gx, gz = np.meshgrid(xs, zs, indexing="ij")
        h = hauteur(gx.ravel(), gz.ravel()).reshape(gx.shape)
        # Le bord de zone reste au niveau de la pelouse — sauf la couture entre
        # deux zones, que le ruisseau traverse : forcée à 0, elle barrait le lit
        # d'un seuil de gazon (la « dent » de la capture de Philippe).
        autres = [r for r in JARDIN["zones"] if r is not z]
        bord = np.zeros(gx.shape, bool)
        bord[0, :] = bord[-1, :] = bord[:, 0] = bord[:, -1] = True
        couture = np.zeros(gx.shape, bool)
        for r in autres:
            couture |= (gx >= r["x"] - 1e-6) & (gx <= r["x"] + r["width"] + 1e-6) & (gz >= r["z"] - 1e-6) & (gz <= r["z"] + r["depth"] + 1e-6)
        h[bord & ~couture] = 0
        bm = bmesh.new()
        vs = [[bm.verts.new((float(gx[i, j]), float(-gz[i, j]), float(h[i, j]))) for j in range(nz + 1)] for i in range(nx + 1)]
        for i in range(nx):
            for j in range(nz):
                bm.faces.new((vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j]))
        bm.normal_update()
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        bm.normal_update()
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts, edges=bm.edges)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bord = [e for e in bm.edges if e.is_boundary]
        r = bmesh.ops.extrude_edge_only(bm, edges=bord)
        for v in (e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)):
            v.co.z = min(-0.4, v.co.z - 0.2)
        # Arête vive entre le sol et sa jupe : sans elle, la normale lissée d'un
        # sommet de bord penche vers la jupe, et les grands triangles de la
        # pelouse plane l'étalent sur des mètres — une nappe qui brille au soleil.
        for e in bord:
            e.smooth = False
        bm.normal_update()
        for f in bm.faces:
            f.smooth = abs(f.normal.z) < 0.9999 or any(abs(v.co.z) > 1e-6 for v in f.verts)
        me = bpy.data.meshes.new(f"Jardin_Sol_{k}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(sol)
        o = bpy.data.objects.new(f"Jardin_Sol_{k}", me)
        bpy.context.collection.objects.link(o)
        objets.append(o)
    return objets


# ── L'eau ─────────────────────────────────────────────────────────────────

def normales_contour(pts):
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        tx, tz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, tz)
        out.append((tz / l, -tx / l))
    # Orientées vers l'extérieur : on teste un point décalé.
    i = 0
    px, pz = pts[i][0] + out[i][0] * 0.5, pts[i][1] + out[i][1] * 0.5
    if sdf_etang(np.array([px]), np.array([pz]))[0] < 0:
        out = [(-x, -z) for x, z in out]
    return out


def indice_cascade():
    """Le point du ruisseau où il atteint la berge de l'étang : la lèvre de la cascade."""
    sp = sdf_etang(TRACE[:, 0], TRACE[:, 1])
    return int(np.argmax(sp < 0.5))


def eau(mat_eau, mat_cascade):
    # L'étang : le contour élargi de 30 cm, pour que le bord de l'eau passe SOUS la berge.
    nrm = normales_contour(CONTOUR)
    g = Maillage()
    g.face([(float(x + nx * 0.3), float(-(z + nz * 0.3)), ETANG) for (x, z), (nx, nz) in zip(CONTOUR, nrm)], mat_eau)
    etang = g.objet("Jardin_Eau_Etang")
    bm = bmesh.new()
    bm.from_mesh(etang.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(etang.data)
    bm.free()

    # Le ruisseau n'est plus ici : son ruban, UV le long du courant, est tissé
    # par `rubanDuRuisseau` (jardin.ts). Seul le bord de sa lèvre sert à la cascade.
    fin = indice_cascade()
    x, z = TRACE[fin][0], TRACE[fin][1]
    a, b = TRACE[fin - 1], TRACE[fin]  # comme `rubanDuRuisseau` : son dernier travers
    dx, dz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dz)
    nx, nz = -dz / l, dx / l
    r = TRACE[fin][2] / 2 + SOUS_LA_RIVE
    bords = [((x + nx * r, z + nz * r), (x - nx * r, z - nz * r), (dx / l, dz / l))]

    # La cascade : une nappe qui tombe de la lèvre au niveau de l'étang, et son écume.
    # Sa lèvre suit le bord bombé du ruban (`BOMBE_LEVRE`, jardin.ts) : le milieu
    # avance vers l'étang, les bords restent sous la berge ; et l'eau s'y enroule
    # en un profil arrondi avant de tomber, plus une arête tirée au cordeau.
    ux, uz = bords[-1][2]
    colonnes = [1 - 2 * j / 8 for j in range(9)]
    profil = [(0.0, 0.0), (0.03, -0.004), (0.06, -0.014), (0.09, -0.03), (0.12, -0.05), (0.15, -0.072), (0.19, ETANG - RUISSEAU - 0.02)]
    g = Maillage()

    def point(k, a, h):
        s = BOMBE_LEVRE * (1 - k * k) + a
        return (x + nx * k * r + ux * s, -(z + nz * k * r + uz * s), RUISSEAU + h)

    for k0, k1 in zip(colonnes, colonnes[1:]):
        u0, u1 = (1 - k0) / 2, (1 - k1) / 2
        for (a0, h0), (a1, h1) in zip(profil, profil[1:]):
            g.face([point(k0, a0, h0), point(k1, a0, h0), point(k1, a1, h1), point(k0, a1, h1)],
                   mat_cascade, uvs=[(u0, a0 - h0), (u1, a0 - h0), (u1, a1 - h1), (u0, a1 - h1)])
    cascade = g.objet("Jardin_Cascade")
    return [etang, cascade]


# ── Le pont, la lanterne, les pas japonais ─────────────────────────────────

def pont(bois, pierre):
    """
    Un pont de bois en dos d'âne, d'une rive à l'autre du ruisseau, sur l'allée
    est. Le tablier monte de 20 cm au milieu : assez pour qu'on le lise cintré,
    assez peu pour que le visiteur, qui marche à la cote du parc, n'y enfonce
    que les chevilles.
    """
    p = JARDIN["pont"]
    L, W = p["longueur"], p["largeur"]
    cx, cz = p["x"], p["z"]
    g = Maillage()
    fleche = lambda u: 0.07 + 0.2 * (1 - (2 * u / L) ** 2)  # noqa: E731
    # Les planches, en travers.
    n = 24
    for k in range(n):
        u0, u1 = -L / 2 + L * k / n + 0.015, -L / 2 + L * (k + 1) / n - 0.015
        y0, y1 = fleche(u0), fleche(u1)
        pts = [(cx + u0, -(cz - W / 2)), (cx + u1, -(cz - W / 2)), (cx + u1, -(cz + W / 2)), (cx + u0, -(cz + W / 2))]
        g.face([(x, y, (y0 if i in (0, 3) else y1)) for i, (x, y) in enumerate(pts)], bois)
        for (a, b, ya, yb) in ((pts[0], pts[1], y0, y1), (pts[2], pts[3], y1, y0)):
            g.face([(a[0], a[1], ya - 0.06), (b[0], b[1], yb - 0.06), (b[0], b[1], yb), (a[0], a[1], ya)], bois)
    # Deux longerons cintrés sous le tablier, et les garde-corps.
    for dz in (-W / 2 + 0.05, W / 2 - 0.05):
        segs = 12
        for k in range(segs):
            u0, u1 = -L / 2 + L * k / segs, -L / 2 + L * (k + 1) / segs
            for z0, z1 in ((cz + dz - 0.07, cz + dz + 0.07),):
                a0, a1 = fleche(u0) - 0.06, fleche(u1) - 0.06
                g.face([(cx + u0, -z0, a0 - 0.22), (cx + u1, -z0, a1 - 0.22), (cx + u1, -z0, a1), (cx + u0, -z0, a0)], bois)
                g.face([(cx + u1, -z1, a1 - 0.22), (cx + u0, -z1, a0 - 0.22), (cx + u0, -z1, a0), (cx + u1, -z1, a1)], bois)
                g.face([(cx + u0, -z1, a0 - 0.22), (cx + u1, -z1, a1 - 0.22), (cx + u1, -z0, a1 - 0.22), (cx + u0, -z0, a0 - 0.22)], bois)
        # Garde-corps : cinq poteaux, une main courante et une lisse.
        poteaux = [-L / 2 + 0.25, -L / 4, 0.0, L / 4, L / 2 - 0.25]
        for u in poteaux:
            b0 = fleche(u)
            boite(g, cx + u - 0.06, cx + u + 0.06, -(cz + dz) - 0.06, -(cz + dz) + 0.06, b0 - 0.3, b0 + 0.82, bois)
        for haut, ep in ((0.82, 0.06), (0.42, 0.04)):
            for k in range(segs):
                u0, u1 = poteaux[0] + (poteaux[-1] - poteaux[0]) * k / segs, poteaux[0] + (poteaux[-1] - poteaux[0]) * (k + 1) / segs
                a0, a1 = fleche(u0) + haut, fleche(u1) + haut
                y0, y1 = -(cz + dz) - 0.05, -(cz + dz) + 0.05
                for (ya, yb) in ((y0, y1),):
                    g.face([(cx + u0, ya, a0 + ep), (cx + u1, ya, a1 + ep), (cx + u1, yb, a1 + ep), (cx + u0, yb, a0 + ep)], bois)
                    g.face([(cx + u0, ya, a0 - ep), (cx + u0, yb, a0 - ep), (cx + u1, yb, a1 - ep), (cx + u1, ya, a1 - ep)], bois)
                    g.face([(cx + u0, ya, a0 - ep), (cx + u1, ya, a1 - ep), (cx + u1, ya, a1 + ep), (cx + u0, ya, a0 + ep)], bois)
                    g.face([(cx + u1, yb, a1 - ep), (cx + u0, yb, a0 - ep), (cx + u0, yb, a0 + ep), (cx + u1, yb, a1 + ep)], bois)
    # Les culées : deux dalles de pierre qui reçoivent le pont sur chaque rive.
    for s in (-1, 1):
        x0 = cx + s * (L / 2 - 0.35)
        boite(g, x0 - 0.45, x0 + 0.45, -(cz + W / 2 + 0.2), -(cz - W / 2 - 0.2), -0.3, 0.06, pierre)
    return g.objet("Jardin_Pont")


def lanterne(granit, lueur):
    """Une lanterne de pierre (kasuga-dōrō) : socle, fût, plateau, foyer, toit, joyau."""
    p = JARDIN["lanterne"]
    x, y = p["x"], -p["z"]
    g = Maillage()
    hexa = lambda r, ph=0.0: cercle(x, y, r, 6, ph)  # noqa: E731
    prisme(g, hexa(0.42), -0.1, 0.12, granit, hexa(0.36))
    prisme(g, hexa(0.3), 0.12, 0.24, granit, hexa(0.2))
    prisme(g, cercle(x, y, 0.13, 10), 0.24, 1.0, granit, cercle(x, y, 0.11, 10))
    prisme(g, hexa(0.2), 1.0, 1.08, granit, hexa(0.36))
    prisme(g, hexa(0.36), 1.08, 1.18, granit)
    prisme(g, hexa(0.22), 1.18, 1.48, lueur)
    for k in range(6):
        cx_, cy_ = hexa(0.25)[k]
        prisme(g, cercle(cx_, cy_, 0.045, 4, math.pi / 4), 1.18, 1.48, granit)
    # Le toit : large, aux angles relevés, puis la pointe.
    prisme(g, hexa(0.3), 1.48, 1.52, granit, hexa(0.56))
    prisme(g, hexa(0.56), 1.52, 1.58, granit, hexa(0.6))
    prisme(g, hexa(0.6), 1.58, 1.8, granit, hexa(0.12))
    prisme(g, cercle(x, y, 0.09, 8), 1.8, 1.86, granit, cercle(x, y, 0.1, 8))
    prisme(g, cercle(x, y, 0.1, 8), 1.86, 1.96, granit, cercle(x, y, 0.02, 8))
    return g.objet("Jardin_Lanterne")


def pas_japonais(pierre):
    """Les tobi-ishi : des dalles plates, posées de la grande allée jusqu'au bord de l'étang."""
    rng = random.Random("pas")
    g = Maillage()
    for x, z in JARDIN["pas"]:
        r = rng.uniform(0.34, 0.44)
        bord = [(r * rng.uniform(0.88, 1.08) * math.cos(t), r * rng.uniform(0.78, 0.95) * math.sin(t))
                for t in (2 * math.pi * k / 16 + rng.uniform(-0.06, 0.06) for k in range(16))]
        # Un chanfrein doux sur le dessus : une pierre roulée, pas une dalle sciée.
        prisme(g, [(x + u, -z + v) for u, v in bord], -0.12, 0.02, pierre)
        prisme(g, [(x + u, -z + v) for u, v in bord], 0.02, 0.05, pierre, [(x + 0.85 * u, -z + 0.85 * v) for u, v in bord])
    return g.objet("Jardin_Pas", lisse=math.radians(40))


# ── Le feuillage : un atlas de feuilles dessiné ici ───────────────────────

TUILES = {
    # Tuile : (colonne, rangée) dans l'atlas 2 × 2.
    "erable-rouge": (0, 1),
    "erable-vert": (1, 1),
    "azalee": (0, 0),
    "buis": (1, 0),
}
COTE = 512
T = COTE // 2


def atlas():
    """
    Quatre tuiles de 256 px, dessinées feuille à feuille : l'érable du Japon
    (sept lobes pointus) en pourpre et en vert tendre, l'azalée en fleur, le
    buis taillé. Une carte de feuillage montre une grappe, pas une feuille.
    """
    img = np.zeros((COTE, COTE, 4), np.float32)
    rng = random.Random("atlas")
    Y, X = np.mgrid[0:COTE, 0:COTE].astype(np.float32)

    def poser(ox, oy, cx, cy, R, rot, forme, couleur):
        x0, x1 = int(max(ox, cx - R - 2)), int(min(ox + T, cx + R + 3))
        y0, y1 = int(max(oy, cy - R - 2)), int(min(oy + T, cy + R + 3))
        xx, yy = X[y0:y1, x0:x1] - cx, Y[y0:y1, x0:x1] - cy
        u = xx * math.cos(rot) - yy * math.sin(rot)
        v = xx * math.sin(rot) + yy * math.cos(rot)
        r = np.hypot(u, v)
        th = np.arctan2(u, v)
        rr, teinte = forme(r, th, u, v, R)
        a = np.clip((rr - r) / 1.2 + 0.5, 0, 1)
        c = np.array(couleur, np.float32)[None, None, :] * teinte[..., None]
        zone = img[y0:y1, x0:x1]
        zone[..., :3] = zone[..., :3] * (1 - a[..., None]) + np.clip(c, 0, 1) * a[..., None]
        zone[..., 3] = np.maximum(zone[..., 3], a)

    def erable(r, th, u, v, R):
        lobes = np.abs(np.cos(3.5 * th))
        rr = R * (0.26 + 0.74 * lobes ** 2.4) * np.where(np.abs(th) > 2.75, 0.35, 1.0)
        return rr, 0.78 + 0.3 * lobes ** 0.5 - 0.12 * (r / R)

    def ovale(r, th, u, v, R):
        rr = np.where(np.hypot(u / 0.42, v) < R, r + 1, 0)
        return rr, 0.85 + 0.2 * (v / R)

    def fleur(r, th, u, v, R):
        rr = R * (0.55 + 0.45 * np.abs(np.cos(2.5 * th)) ** 0.6)
        return rr, 0.75 + 0.3 * np.clip(r / R, 0, 1)

    rouges = [(0.46, 0.04, 0.05), (0.56, 0.07, 0.06), (0.38, 0.03, 0.06), (0.64, 0.13, 0.06), (0.50, 0.05, 0.09)]
    verts = [(0.28, 0.46, 0.09), (0.36, 0.53, 0.12), (0.22, 0.39, 0.08), (0.43, 0.58, 0.15)]
    feuilles_azalee = [(0.17, 0.32, 0.09), (0.23, 0.40, 0.11)]
    roses = [(0.95, 0.48, 0.68), (0.98, 0.62, 0.78), (0.88, 0.36, 0.58)]
    buis = [(0.16, 0.32, 0.07), (0.22, 0.40, 0.09), (0.13, 0.27, 0.06), (0.28, 0.45, 0.11)]

    def tuile(nom):
        c, l = TUILES[nom]
        return c * T, l * T

    M = 10  # marge : les mips d'une tuile ne bavent pas sur la voisine
    for nom, palette in (("erable-rouge", rouges), ("erable-vert", verts)):
        ox, oy = tuile(nom)
        for _ in range(75):
            R = rng.uniform(15, 25)
            cx, cy = rng.uniform(ox + M + R, ox + T - M - R), rng.uniform(oy + M + R, oy + T - M - R)
            poser(ox, oy, cx, cy, R, rng.uniform(0, 2 * math.pi), erable, rng.choice(palette))
    ox, oy = tuile("azalee")
    for _ in range(170):
        R = rng.uniform(9, 14)
        cx, cy = rng.uniform(ox + M + R, ox + T - M - R), rng.uniform(oy + M + R, oy + T - M - R)
        poser(ox, oy, cx, cy, R, rng.uniform(0, 2 * math.pi), ovale, rng.choice(feuilles_azalee))
    for _ in range(46):
        R = rng.uniform(10, 15)
        cx, cy = rng.uniform(ox + M + R, ox + T - M - R), rng.uniform(oy + M + R, oy + T - M - R)
        poser(ox, oy, cx, cy, R, rng.uniform(0, 2 * math.pi), fleur, rng.choice(roses))
    ox, oy = tuile("buis")
    for _ in range(420):
        R = rng.uniform(6, 10)
        cx, cy = rng.uniform(ox + M + R, ox + T - M - R), rng.uniform(oy + M + R, oy + T - M - R)
        poser(ox, oy, cx, cy, R, rng.uniform(0, 2 * math.pi), ovale, rng.choice(buis))

    # Sous les feuilles, la couleur moyenne de la tuile : pas de liseré noir dans les mips.
    for nom in TUILES:
        ox, oy = tuile(nom)
        z = img[oy:oy + T, ox:ox + T]
        a = z[..., 3:4]
        moy = (z[..., :3] * a).sum((0, 1)) / max(1e-6, a.sum())
        z[..., :3] = np.where(a > 0.01, z[..., :3], moy)

    image = bpy.data.images.new("Jardin_Feuilles", COTE, COTE, alpha=True)
    image.pixels.foreach_set(img.ravel())
    image.pack()
    return image


def uv_tuile(nom, rot=0):
    c, l = TUILES[nom]
    m = 12 / COTE
    u0, v0 = c * 0.5 + m, l * 0.5 + m
    u1, v1 = u0 + 0.5 - 2 * m, v0 + 0.5 - 2 * m
    coins = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return coins[rot:] + coins[:rot]


def carte(g, rng, p, n, taille, mat, tuile, normale):
    """Un quad de feuillage centré en p, de normale géométrique n, éclairé comme `normale`."""
    nx, ny, nz = n
    l = math.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / l, ny / l, nz / l
    ax, ay, az = (1, 0, 0) if abs(nx) < 0.9 else (0, 1, 0)
    t1 = (ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx)
    l = math.sqrt(sum(c * c for c in t1))
    t1 = tuple(c / l for c in t1)
    t2 = (ny * t1[2] - nz * t1[1], nz * t1[0] - nx * t1[2], nx * t1[1] - ny * t1[0])
    a = rng.uniform(0, 2 * math.pi)
    e1 = tuple(math.cos(a) * u + math.sin(a) * v for u, v in zip(t1, t2))
    e2 = tuple(-math.sin(a) * u + math.cos(a) * v for u, v in zip(t1, t2))
    h = taille / 2
    coins = [tuple(p[i] + s1 * h * e1[i] + s2 * h * e2[i] for i in range(3)) for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    l = math.sqrt(sum(c * c for c in normale))
    g.face(coins, mat, uvs=uv_tuile(tuile, rng.randrange(4)), normales=[tuple(c / l for c in normale)] * 4)


def tube(g, pts, rayons, mat, n=6):
    """Une branche : des anneaux le long d'une polyligne, raccordés."""
    anneaux = []
    for i, (p, r) in enumerate(zip(pts, rayons)):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        d = [b[k] - a[k] for k in range(3)]
        l = math.sqrt(sum(c * c for c in d)) or 1
        d = [c / l for c in d]
        ref = (0, 0, 1) if abs(d[2]) < 0.9 else (1, 0, 0)
        u = (d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0])
        lu = math.sqrt(sum(c * c for c in u))
        u = tuple(c / lu for c in u)
        v = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
        rad = [tuple(math.cos(2 * math.pi * j / n) * u[k] + math.sin(2 * math.pi * j / n) * v[k] for k in range(3)) for j in range(n)]
        anneaux.append([(tuple(p[k] + r * q[k] for k in range(3)), q) for q in rad])
    # Les normales sont données (rayonnantes) : l'arbre porte des normales
    # explicites pour son feuillage, et une écorce sans normale sortirait éclairée
    # comme un sol, tout en blanc.
    for r0, r1 in zip(anneaux, anneaux[1:]):
        for j in range(n):
            q = [r0[j], r0[(j + 1) % n], r1[(j + 1) % n], r1[j]]
            g.face([a for a, _ in q], mat, normales=[b for _, b in q])


def courbe(p0, direction, longueur, montee, rng, n=4):
    """Une branche qui s'arque : elle part selon `direction` et se couche peu à peu."""
    dx, dy, dz = direction
    pts = [p0]
    for k in range(1, n + 1):
        t = k / n
        x, y, z = pts[-1]
        pts.append((x + dx * longueur / n + rng.uniform(-0.06, 0.06), y + dy * longueur / n + rng.uniform(-0.06, 0.06),
                    z + (dz * (1 - t) + montee * t) * longueur / n))
    return pts


def brindilles(g, rng, nuages, ecorce, loin=False):
    """
    Le chevelu d'un érable nu : de chaque bout de branche (le cœur d'un nuage de
    feuilles) partent des rameaux fins, en éventail, presque à plat et relevés
    du bout, qui se fourchent encore une fois. Ils remplissent le nuage : l'hiver,
    l'érable garde sa silhouette en étages, en dentelle au lieu de feuilles.
    L'été ils disparaissent dans le feuillage. Prismes à trois pans, même écorce :
    aucun appel de dessin de plus. `loin` : sans les fourches, trop fines
    pour couvrir un pixel au-delà de 35 m ; les tirages restent les mêmes.
    """
    for c, R in nuages:
        dehors = math.atan2(c[1], c[0]) if c[0] * c[0] + c[1] * c[1] > 0.04 else rng.uniform(0, 2 * math.pi)
        for _ in range(int(6 * R) + 2):
            # Surtout vers le dehors, un peu tout autour ; à peine relevés, pour
            # rester dans le nuage (large et plat) que le feuillage habille.
            a = dehors + rng.gauss(0, 1.0)
            h = rng.uniform(-0.05, 0.25)
            longueur = R * rng.uniform(0.5, 0.8)
            r = courbe(c, (math.cos(a), math.sin(a), h), longueur, h + 0.1, rng, n=2)
            tube(g, r, [0.012, 0.007, 0.0035], ecorce, n=3)
            # Une fourche au coude, deux au bout : le rameau se ramifie en zigzag.
            # Jamais symétriques : l'une courte, l'autre longue, des angles inégaux.
            cote = rng.choice((-1, 1))
            for k, s, l in ((1, cote, (0.22, 0.38)), (2, -cote, (0.22, 0.38)), (2, cote, (0.1, 0.2))):
                a2 = a + s * rng.uniform(0.25, 1.0)
                fin = courbe(r[k], (math.cos(a2), math.sin(a2), h + rng.uniform(0.0, 0.25)), R * rng.uniform(*l), 0.15, rng, n=1)
                if not loin:
                    tube(g, fin, [0.006, 0.003], ecorce, n=3)


def erable(nom, tuile, graine, ecorce, feuilles, loin=False):
    """
    Un érable du Japon (Acer palmatum) : un tronc court qui se divise bas en
    charpentières obliques, des rameaux qui partent à l'horizontale, et le
    feuillage en ÉTAGES — des nuages larges et peu épais, superposés, entre
    lesquels on devine les branches. ~4,5 m de haut, 6 m d'envergure : plus
    large que haut, comme dans tous les jardins japonais.

    `loin` : le même arbre, pour le voir de loin (l’ancien build-erables-loin.py) —
    mêmes tirages, donc mêmes branches et mêmes nuages ; une carte de feuillage
    sur deux, de surface double (la couverture ne change pas), et des rameaux
    fins sans leurs fourches.
    """
    rng = random.Random(graine)
    g = Maillage()
    tronc = [(0, 0, -0.2), (0.06, 0.02, 0.5), (0.12, 0.05, 0.95)]
    tube(g, tronc, [0.19, 0.15, 0.12], ecorce, n=8)
    nuages = []
    nb = 4 + (graine % 2)
    for i in range(nb):
        az = 2 * math.pi * i / nb + rng.uniform(-0.3, 0.3)
        inc = math.radians(rng.uniform(42, 62))
        d = (math.cos(az) * math.sin(inc), math.sin(az) * math.sin(inc), math.cos(inc))
        charp = courbe(tronc[-1], d, rng.uniform(2.0, 2.7), 0.35, rng)
        tube(g, charp, [0.1, 0.085, 0.07, 0.055, 0.04], ecorce)
        nuages.append((charp[-1], rng.uniform(0.95, 1.15)))
        for k in (1, 2, 3, 4):
            if k == 1 and rng.random() < 0.5:
                continue
            a2 = az + rng.choice((-1, 1)) * rng.uniform(0.3, 1.0)
            d2 = (math.cos(a2), math.sin(a2), rng.uniform(-0.05, 0.2))
            rameau = courbe(charp[k], d2, rng.uniform(0.9, 1.5), 0.0, rng, n=3)
            tube(g, rameau, [0.04, 0.03, 0.022, 0.014], ecorce, n=5)
            nuages.append((rameau[-1], rng.uniform(0.75, 1.0)))
    haut = max(p[2] for p, _ in nuages)
    nuages.append(((0.15, 0.05, haut + 0.35), 1.0))
    # Tirés d'un aléa à part : le feuillage reste celui d'avant. La flèche porte le
    # nuage du sommet (l'hiver le laissait en l'air), puis les rameaux fins.
    rng_nu = random.Random(graine * 7 + 1)
    fleche = courbe(tronc[-1], (0.02, 0.0, 1.0), haut + 0.3 - tronc[-1][2], 1.0, rng_nu, n=3)
    tube(g, fleche, [0.07, 0.05, 0.035, 0.02], ecorce, n=5)
    brindilles(g, rng_nu, nuages, ecorce, loin)
    rebut = Maillage()
    n_carte = 0
    centre = [sum(p[k] for p, _ in nuages) / len(nuages) for k in range(3)]
    for c, R in nuages:
        for _ in range(int(60 * R * R) + 10):
            # Un nuage : large et peu épais. Les cartes, plutôt à plat, pas toutes.
            while True:
                ox, oy, oz = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)
                if ox * ox + oy * oy + oz * oz <= 1:
                    break
            p = (c[0] + ox * R, c[1] + oy * R, c[2] + 0.15 + oz * R * 0.55)
            n_geo = (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1.4))
            # Éclairées comme un volume : la normale fuit le centre du houppier et
            # celui du nuage — le dessous d'un étage reste dans l'ombre du dessus.
            eclairage = tuple(0.45 * (p[k] - centre[k]) / 3 + 0.55 * (ox, oy, oz * 1.6)[k] + (0.15 if k == 2 else 0) for k in range(3))
            garder = not loin or n_carte % 2 == 0
            n_carte += 1
            carte(g if garder else rebut, rng, p, n_geo, rng.uniform(0.36, 0.54) * (math.sqrt(2) if loin else 1), feuilles, tuile, eclairage)
    o = g.objet(nom)
    # Dessiné à 3,4 m, porté à 4,5 m : la taille d'un vieil érable de jardin.
    o.data.transform(Matrix.Scale(1.3, 4))
    return o


def petales(nom, rose):
    """
    Des pétales tombés sur la mousse, sous une azalée : quatre-vingts ovales de
    4 cm posés à plat, plus serrés au centre. Un seul sujet, instancié partout.
    """
    rng = random.Random("petales")
    g = Maillage()
    for _ in range(80):
        r = 1.3 * math.sqrt(rng.random()) * rng.uniform(0.6, 1.0)
        a = rng.uniform(0, 2 * math.pi)
        x, y = r * math.cos(a), r * math.sin(a)
        t = rng.uniform(0, math.pi)
        l, w = rng.uniform(0.025, 0.04), rng.uniform(0.015, 0.025)
        z = 0.012 + rng.uniform(0, 0.004)
        ovale = [(l * math.cos(k * math.pi / 3), w * math.sin(k * math.pi / 3)) for k in range(6)]
        g.face([(x + u * math.cos(t) - v * math.sin(t), y + u * math.sin(t) + v * math.cos(t), z) for u, v in ovale], rose)
    return g.objet(nom)


def boule(nom, tuile, graine, fond, feuilles, r=0.8, h=0.62):
    """Une boule taillée (tamamono) : un noyau sombre, couvert de cartes plaquées à sa surface."""
    rng = random.Random(graine)
    g = Maillage()
    # Le noyau : une demi-ellipsoïde bosselée, qui bouche les jours entre les cartes.
    n, m = 12, 5
    anneaux = []
    for j in range(m + 1):
        phi = math.pi / 2 * j / m
        anneaux.append([(r * 0.9 * math.cos(phi) * math.cos(2 * math.pi * k / n) * rng.uniform(0.94, 1.04),
                         r * 0.9 * math.cos(phi) * math.sin(2 * math.pi * k / n) * rng.uniform(0.94, 1.04),
                         -0.05 + h * 0.92 * math.sin(phi)) for k in range(n)])
    for a, b in zip(anneaux, anneaux[1:]):
        for k in range(n):
            q = [a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]]
            g.face(q, fond, normales=[(x / r ** 2, y / r ** 2, (z + 0.05) / h ** 2) for x, y, z in q])
    for _ in range(170):
        th = rng.uniform(0, 2 * math.pi)
        phi = math.asin(rng.uniform(0.05, 1.0))
        nx, ny, nz = math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th), math.sin(phi)
        p = (r * nx, r * ny, -0.05 + h * nz)
        normale = (nx / r, ny / r, nz / h)
        n_geo = tuple(c + rng.uniform(-0.35, 0.35) for c in normale)
        carte(g, rng, p, n_geo, rng.uniform(0.34, 0.46), feuilles, tuile, normale)
    return g.objet(nom)


# ── Les sujets Poly Haven ─────────────────────────────────────────────────

def triangles(o):
    return sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)


def importer_polyhaven():
    objets = []
    for fichier in dict.fromkeys(f for f, _, _, _ in POLYHAVEN):
        chemin = PLANTES / f"{fichier}.gltf"
        if not chemin.exists():
            print(f"JARDIN_MANQUANT {chemin.name} — lance `node tools/fetch-assets.ts --sources-vegetation`")
            sys.exit(1)
        avant = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(chemin))
        nouveaux = [o for o in bpy.data.objects if o not in avant]
        gardes = {noeud: (nom, budget) for f, noeud, nom, budget in POLYHAVEN if f == fichier}
        for o in nouveaux:
            if o.name not in gardes:
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            nom, budget = gardes[o.name]
            o.name = nom
            # L'import coupe le maillage à chaque couture d'UV : sans recoller, le
            # collapse bute sur ces bords et le rocher ne descend pas.
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bm.to_mesh(o.data)
            bm.free()
            depart = triangles(o)
            if depart > budget:
                mod = o.modifiers.new("Allegement", "DECIMATE")
                mod.ratio = budget / depart
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=mod.name)
            print(f"JARDIN_SUJET {nom:14} {depart:6} -> {triangles(o):5} tri")
            objets.append(o)
    # La carte de rugosité seule (rock_moss_set_*) ne s'exporte pas en WebP (Blender
    # échoue à la recombiner) ; une pierre moussue est mate partout, 0,9 suffit.
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for lien in list(m.node_tree.links):
            if lien.to_socket.name == "Roughness" and lien.to_node.type == "BSDF_PRINCIPLED":
                m.node_tree.links.remove(lien)
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is not None and not b.inputs["Roughness"].is_linked:
            b.inputs["Roughness"].default_value = 0.9
    # Rochers et fougère sont vus à quelques mètres : 512 px suffisent largement.
    for img in bpy.data.images:
        if img.name != "Jardin_Feuilles" and max(img.size) > 512:
            f = 512 / max(img.size)
            img.scale(int(img.size[0] * f), int(img.size[1] * f))
    return objets


# ── Tout ──────────────────────────────────────────────────────────────────

def construire():
    repartir()
    importer_polyhaven()
    sol = matiere("Jardin_Sol", (0.25, 0.4, 0.12), 1.0)
    eau_ = matiere("Jardin_Eau", (0.02, 0.05, 0.035), 0.05)
    cascade_ = matiere("Jardin_Cascade", (0.9, 0.95, 0.95), 0.3)
    bois = matiere("Jardin_Bois", (0.2, 0.13, 0.08), 0.75)
    granit = matiere("Jardin_Granit", (0.47, 0.46, 0.42), 0.9)
    lueur = matiere("Jardin_Lueur", (0.9, 0.8, 0.6), 0.6, emission=(1.0, 0.72, 0.4), force=0.6)
    ecorce = matiere("Jardin_Ecorce", (0.07, 0.055, 0.045), 0.9)
    fond = matiere("Jardin_Feuillage_Fond", (0.07, 0.15, 0.04), 1.0)
    image = atlas()
    feuilles = matiere("Jardin_Feuillage", (1, 1, 1), 0.75, image=image)

    terrain(sol)
    eau(eau_, cascade_)
    # Les galets de l'étang et du lit ne sont plus taillés ici : les galets de
    # rivière Meshy de ruisseau.glb, instanciés par `RuisseauLayer`, les remplacent.
    pont(bois, granit)
    lanterne(granit, lueur)
    pas_japonais(granit)
    erable("src_erable_rouge", "erable-rouge", 11, ecorce, feuilles)
    erable("src_erable_vert", "erable-vert", 12, ecorce, feuilles)
    boule("src_buis", "buis", 21, fond, feuilles)
    boule("src_azalee", "azalee", 22, fond, feuilles, r=0.75, h=0.55)
    petales("src_petales", matiere("Jardin_Petale", (0.93, 0.55, 0.7), 0.7))


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_image_format="WEBP",
        export_image_quality=82,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    tri = sum(triangles(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"JARDIN_POIDS {SORTIE.stat().st_size // 1024} Kio, {tri} triangles -> {SORTIE.relative_to(ROOT)}")


if __name__ == "__main__":
    construire()
    if "--no-export" not in sys.argv:
        exporter()
