"""
Les grandes plantes d'intérieur : un palmier kentia dans une vasque de bronze,
un figuier lyre et un olivier dans des cuves de pierre.

    blender --background --factory-startup --python tools/blender/build-plantes.py -- <dossier des sources>

Produit `public/assets/architecture/plantes.glb`, une pièce par nœud (`Kentia`,
`Lyrata`, `Olivier`), instanciées par `src/scene/MobilierLayer.tsx` aux places
de `src/plan/mobilier.ts`.

── Pourquoi pas tout en Meshy ──

Un image → 3D rend une plante comme une sculpture : des feuilles pleines,
épaisses, collées en carton. Les jardinières, elles, sont des volumes pleins —
exactement ce que Meshy fait bien. Donc :

- les deux jardinières sont des modèles Meshy (image Nano Banana → 3D), mis à
  l'échelle réelle et allégés comme les accessoires ;
- le feuillage est modelé ici : des cartes de feuilles découpées à l'alpha
  (une fronde de kentia, une feuille de figuier lyre, un rameau d'olivier,
  photos « planche botanique » générées par Nano Banana, fond retiré), pliées le
  long de la nervure et arquées par leur poids. Quelques centaines de
  triangles par plante au lieu de dizaines de milliers.

Le dossier des sources contient les deux GLB Meshy et les trois PNG de
feuilles (`vasque-bronze.glb`, `cuve-pierre.glb`, `kentia.png`, `lyrata.png`,
`olivier.png`). Ils ne sont pas dans le dépôt ; les prompts sont dans le
manifeste `tools/fetch-assets.ts`.

Déterministe : un seul générateur, semé.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "plantes.glb"

# Les jardinières : (fichier Meshy, hauteur réelle en m, plafond de triangles).
VASQUE = ("vasque-bronze.glb", 0.55, 6000)
CUVE = ("cuve-pierre.glb", 0.72, 5000)

rng = np.random.default_rng(1900)


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def vide(nom, parent=None):
    o = bpy.data.objects.new(nom, None)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    return o


def objet(nom, bm, mat, parent=None, lisse=True):
    me = bpy.data.meshes.new(nom)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = lisse
    o = bpy.data.objects.new(nom, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    o.parent = parent
    return o


# ── Les jardinières Meshy ────────────────────────────────────────────────────

def jardiniere(nom, fichier, hauteur, plafond, source):
    """Le modèle Meshy à l'échelle réelle, l'origine au sol au centre ; rend (objet, cote de la terre)."""
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / fichier))
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    maillages = [o for o in nouveaux if o.type == "MESH"]
    for o in maillages:
        m = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = m
    for o in nouveaux:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in maillages:
        o.select_set(True)
    bpy.context.view_layer.objects.active = maillages[0]
    if len(maillages) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo = Vector([min(v.co[i] for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in o.data.vertices) for i in range(3)])
    k = hauteur / (hi.z - lo.z)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in o.data.vertices:
        v.co = (v.co - centre) * k
    depart = triangles(o)
    if depart > plafond:
        d = o.modifiers.new("Alleger", "DECIMATE")
        d.ratio = plafond / depart
        bpy.ops.object.modifier_apply(modifier=d.name)
    o.name = o.data.name = nom
    for i, mat in enumerate(o.data.materials):
        mat.name = f"{nom}-{i}"
        # Un volume fermé : une seule face suffit (la découpe des feuilles, elle, reste double).
        mat.use_backface_culling = True
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                n.image.name = f"{nom}-{n.label or n.name}"
                if max(n.image.size) > 1024:
                    n.image.scale(1024, 1024)
    # La terre : là où un rayon tiré d'en haut, un peu à côté de l'axe, touche le modèle.
    bvh = BVHTree.FromPolygons([v.co for v in o.data.vertices], [p.vertices for p in o.data.polygons])
    cotes = []
    for a in range(24):
        r = 0.05 + 0.2 * (a % 4) / 3
        p = Vector((r * math.cos(a), r * math.sin(a), 5))
        hit = bvh.ray_cast(p, Vector((0, 0, -1)))
        # Le fond du pot, vu par un trou du maillage de la terre, ne compte pas.
        if hit[0] is not None and hit[0].z > hauteur / 2:
            cotes.append(hit[0].z)
    terre = float(np.median(cotes))
    dims = (hi - lo) * k
    print(f"JARDINIERE {nom:16s} {depart:6d} -> {triangles(o):6d} tri, {dims.x:.2f} × {dims.y:.2f} × {dims.z:.2f} m, terre à {terre:.2f} m")
    return o, terre


# ── Les feuilles : une photo détourée devenue carte ─────────────────────────

def feuille(nom, png, largeur_max):
    """
    La photo détourée, recadrée sur son alpha, ramenée à `largeur_max` : la
    couleur des bords est tirée de l'intérieur (sinon le liseré blanc du
    détourage et le noir des pixels vides bavent dans les mipmaps).
    Rend (image, rapport largeur / hauteur).
    """
    src = bpy.data.images.load(str(png))
    w, h = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(h, w, 4)
    a = px[..., 3]
    ys, xs = np.nonzero(a > 0.1)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    px = px[y0:y1, x0:x1].copy()
    # Le liseré du détourage : les pixels à demi transparents prennent la couleur de leurs voisins pleins.
    plein = px[..., 3] > 0.85
    coul = np.where(plein[..., None], px[..., :3], 0)
    poids = plein.astype(np.float32)
    for _ in range(12):
        c = sum(np.roll(np.roll(coul, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        p = sum(np.roll(np.roll(poids, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        neuf = (~plein) & (p > 0)
        coul[neuf] = c[neuf] / p[neuf][:, None]
        poids = np.maximum(poids, (p > 0).astype(np.float32))
        plein = plein | neuf
    px[..., :3] = coul
    # Le détourage laisse un halo clair : on resserre un peu l'alpha.
    px[..., 3] = np.clip((px[..., 3] - 0.25) / 0.6, 0, 1)
    hh, ww = px.shape[:2]
    img = bpy.data.images.new(nom, ww, hh, alpha=True)
    img.pixels.foreach_set(px.ravel())
    k = largeur_max / max(ww, hh)
    img.scale(max(8, round(ww * k)), max(8, round(hh * k)))
    img.pack()
    bpy.data.images.remove(src)
    return img, ww / hh


def matiere_feuille(nom, img, rugosite, teinte=(1, 1, 1)):
    """Découpe binaire (glTF `MASK`), vue des deux côtés."""
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    m.use_backface_culling = False
    m.surface_render_method = "DITHERED"
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = rugosite
    tex = t.nodes.new("ShaderNodeTexImage")
    tex.image = img
    if teinte != (1, 1, 1):
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1
        mix.inputs["B"].default_value = (*teinte, 1)
        t.links.new(tex.outputs["Color"], mix.inputs["A"])
        t.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    else:
        t.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    seuil = t.nodes.new("ShaderNodeMath")
    seuil.operation = "GREATER_THAN"
    seuil.inputs[1].default_value = 0.5
    t.links.new(tex.outputs["Alpha"], seuil.inputs[0])
    t.links.new(seuil.outputs[0], b.inputs["Alpha"])
    return m


def matiere(nom, rgb, rugosite=0.8, couleur=None):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rugosite
    if couleur is not None:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = couleur
        m.node_tree.links.new(n.outputs["Color"], b.inputs["Base Color"])
    return m


def ecorce(nom, fond, stries):
    """
    Une écorce : des stries en long, bruitées, plus sombres au creux. Le bruit
    est tiré sur un cylindre : raccord parfait autour du tronc (u), et la
    texture est assez longue (v) pour que son raccord vertical ne se voie pas.
    """
    n = 256
    ys, xs = np.mgrid[0:n, 0:n] / n

    def cyl(x, y, rayon, hauteur, graine):
        a = 2 * math.pi * x
        return noise.noise(Vector((math.cos(a) * rayon, math.sin(a) * rayon, y * hauteur + graine)))
    v = np.array([[cyl(x, y, 2.2, 1.5, 0.5) for x in xs[0]] for y in ys[:, 0]])
    f = np.array([[cyl(x, y, 1.0, 5, 4.2) for x in xs[0]] for y in ys[:, 0]])
    t = np.clip(0.55 + 0.45 * v + 0.2 * f, 0, 1)[..., None]
    rgb = np.array(fond)[None, None] * (1 - t) + np.array(stries)[None, None] * t
    img = bpy.data.images.new(nom, n, n, alpha=False)
    img.pixels.foreach_set(np.concatenate([rgb, np.ones((n, n, 1))], axis=2).astype(np.float32).ravel())
    img.pack()
    return img


def carte(bm, uv, base, tige, cote, longueur, largeur, pli, courbure, nl=6, nw=2, u0=0.0, u1=1.0, v0=0.0, v1=1.0):
    """
    Une carte de feuille le long d'un arc : du `base` dans la direction `tige`,
    qui s'infléchit de `courbure` radians sur sa longueur (vers le bas si
    positive) ; `cote` est l'axe transversal ; les bords descendent de `pli`
    (fraction de la demi-largeur) — la feuille pliée le long de sa nervure.
    La texture : v le long de la tige, u en travers.
    """
    tige = tige.normalized()
    cote = (cote - cote.project(tige)).normalized()
    normale = tige.cross(cote).normalized()
    if normale.z < 0:
        normale, cote = -normale, -cote
    lignes = []
    p = base.copy()
    d = tige.copy()
    ds = longueur / nl
    for i in range(nl + 1):
        s = i / nl
        # La nervure plie les bords vers l'arrière de la face (vers le bas).
        n_loc = d.cross(cote).normalized()
        if n_loc.dot(normale) < 0:
            n_loc = -n_loc
        rangee = []
        for j in range(nw + 1):
            t = j / nw * 2 - 1  # −1 … 1 en travers
            # La feuille s'effile : le pli se relâche vers la pointe.
            q = p + cote * (t * largeur / 2) - n_loc * (abs(t) * pli * largeur / 2)
            rangee.append((bm.verts.new(q), (u0 + (u1 - u0) * (t + 1) / 2, v0 + (v1 - v0) * s)))
        lignes.append(rangee)
        # L'arc : la direction tourne vers le bas (rotation autour de d × −z).
        axe = d.cross(Vector((0, 0, -1)))
        axe = axe.normalized() if axe.length > 1e-6 else cote
        p = p + d * ds
        d = (Matrix.Rotation(courbure / nl, 3, axe) @ d).normalized()
    for i in range(nl):
        for j in range(nw):
            vs = [lignes[i][j], lignes[i][j + 1], lignes[i + 1][j + 1], lignes[i + 1][j]]
            f = bm.faces.new([v for v, _ in vs])
            for lp, (_, c) in zip(f.loops, vs):
                lp[uv].uv = c


def tronc(bm, uv, points, rayons, seg=8, tex=0.25):
    """Un tube le long d'une polyligne, rayon variable, UV déroulées (écorce)."""
    anneaux = []
    long = 0.0
    for i, (p, r) in enumerate(zip(points, rayons)):
        a = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        a.normalize()
        x = a.orthogonal().normalized()
        y = a.cross(x)
        if i > 0:
            long += (p - points[i - 1]).length
        anneaux.append([(bm.verts.new(p + (x * math.cos(k / seg * 2 * math.pi) + y * math.sin(k / seg * 2 * math.pi)) * r),
                         (k / seg, long / tex)) for k in range(seg + 1)])
    for i in range(len(anneaux) - 1):
        for k in range(seg):
            vs = [anneaux[i][k], anneaux[i][k + 1], anneaux[i + 1][k + 1], anneaux[i + 1][k]]
            f = bm.faces.new([v for v, _ in vs])
            for lp, (_, c) in zip(f.loops, vs):
                lp[uv].uv = c


def horizontale(phi):
    return Vector((math.cos(phi), math.sin(phi), 0))


# ── Le kentia ────────────────────────────────────────────────────────────────

def kentia(source, vasque, terre):
    """
    Howea forsteriana, le palmier des palaces : plusieurs pieds dans la même
    vasque, de longs pétioles nus qui montent en gerbe, et des frondes qui
    s'arquent et retombent. ≈ 2,70 m hors tout.
    """
    racine = vide("Kentia")
    vasque.parent = racine
    img, rapport = feuille("Kentia-fronde", source / "kentia.png", 1024)
    mat = matiere_feuille("Kentia-fronde", img, 0.62)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    tiges = bmesh.new()
    uvt = tiges.loops.layers.uv.verify()
    n = 17
    for i in range(n):
        phi = i * 2.39996 + rng.uniform(-0.25, 0.25)
        # Les jeunes frondes au centre, dressées ; les vieilles dehors, qui s'inclinent.
        age = i / (n - 1)
        pied = Vector((0.1 * math.cos(phi * 1.7), 0.1 * math.sin(phi * 1.7), terre - 0.02))
        haut_petiole = 0.9 + 0.95 * (1 - age) + rng.uniform(-0.12, 0.12)
        elev = math.radians(88 - 20 * age + rng.uniform(-3, 3))
        d = horizontale(phi) * math.cos(elev) + Vector((0, 0, math.sin(elev)))
        tete = pied + d * haut_petiole
        tronc(tiges, uvt, [pied, (pied + tete) / 2, tete], [0.016, 0.012, 0.009], 6)
        # La fronde part un peu plus couchée que son pétiole, puis s'arque et retombe.
        e2 = elev - math.radians(rng.uniform(6, 14))
        d2 = horizontale(phi) * math.cos(e2) + Vector((0, 0, math.sin(e2)))
        longueur = rng.uniform(1.35, 1.65)
        carte(bm, uv, tete - d2 * 0.25 * longueur, d2, horizontale(phi + math.pi / 2), longueur, longueur * rapport,
              pli=rng.uniform(0.4, 0.6), courbure=math.radians(45 + 50 * age), nl=10, nw=2)
    objet("Kentia-frondes", bm, mat, racine, lisse=True)
    objet("Kentia-petioles", tiges, matiere("Kentia-petiole", (0.12, 0.16, 0.07), 0.6), racine)
    return racine


# ── Le figuier lyre ──────────────────────────────────────────────────────────

def lyrata(source, cuve, terre):
    """
    Ficus lyrata : trois tiges d'inégale hauteur, les grandes feuilles en
    violon disposées en spirale, inclinées vers la lumière, la pointe qui ploie.
    ≈ 2,40 m hors tout.
    """
    racine = vide("Lyrata")
    cuve.parent = racine
    img, rapport = feuille("Lyrata-feuille", source / "lyrata.png", 512)
    mat = matiere_feuille("Lyrata-feuille", img, 0.42)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    bois = bmesh.new()
    uvb = bois.loops.layers.uv.verify()
    for k, (hauteur, dx, dy) in enumerate([(1.95, 0.03, 0.02), (1.6, -0.09, 0.05), (1.25, 0.05, -0.09)]):
        # La tige, un peu sinueuse.
        pts = []
        for i in range(7):
            s = i / 6
            pts.append(Vector((dx * (1 + 1.5 * s) + 0.03 * noise.noise(Vector((k, s * 3, 0))),
                               dy * (1 + 1.5 * s) + 0.03 * noise.noise(Vector((k, s * 3, 5))),
                               terre - 0.02 + hauteur * s)))
        tronc(bois, uvb, pts, [0.03 - 0.018 * i / 6 for i in range(7)], 7, 0.9)
        # Les feuilles, de 55 cm au-dessus de la terre jusqu'au sommet.
        nb = int(hauteur * 17)
        for i in range(nb):
            s = 0.35 + 0.65 * i / (nb - 1)
            j = min(int(s * 6), 5)
            p = pts[j].lerp(pts[j + 1], s * 6 - j)
            phi = i * 2.39996 + k * 1.3
            elev = math.radians(18 + 30 * s + rng.uniform(-10, 10))
            d = horizontale(phi) * math.cos(elev) + Vector((0, 0, math.sin(elev)))
            longueur = (0.34 + 0.14 * s) * rng.uniform(0.9, 1.1)
            carte(bm, uv, p, d, horizontale(phi + math.pi / 2).lerp(Vector((0, 0, 0.2)), 0.1), longueur, longueur * rapport,
                  pli=rng.uniform(0.15, 0.3), courbure=math.radians(rng.uniform(25, 50)), nl=4, nw=2)
    objet("Lyrata-feuilles", bm, mat, racine, lisse=True)
    objet("Lyrata-tiges", bois, matiere("Lyrata-ecorce", (1, 1, 1), 0.85,
                                        ecorce("Lyrata-ecorce", (0.22, 0.19, 0.15), (0.42, 0.38, 0.31))), racine)
    return racine


# ── L'olivier ────────────────────────────────────────────────────────────────

def olivier(source, cuve, terre):
    """
    Un olivier d'orangerie : un tronc court et tors, trois charpentières, une
    couronne ronde et argentée de rameaux. ≈ 2,40 m hors tout.
    """
    racine = vide("Olivier")
    cuve.parent = racine
    img, rapport = feuille("Olivier-rameau", source / "olivier.png", 512)
    mat = matiere_feuille("Olivier-rameau", img, 0.8)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    bois = bmesh.new()
    uvb = bois.loops.layers.uv.verify()
    h0 = terre - 0.02
    # Le tronc tors, jusqu'à la fourche : trois brins qui s'enroulent l'un autour de l'autre.
    fourche = Vector((0.04, -0.02, h0 + 0.85))
    axe = [Vector((0.06 * noise.noise(Vector((s * 3, 0, 1))), 0.06 * noise.noise(Vector((s * 3, 0, 7))), h0 + 0.85 * s)).lerp(fourche, s * s)
           for s in np.linspace(0, 1, 9)]
    for b in range(3):
        brin = [p + Vector((math.cos(b * 2.1 + 2.6 * s), math.sin(b * 2.1 + 2.6 * s), 0)) * 0.035 * (1.2 - 0.5 * s)
                for p, s in zip(axe, np.linspace(0, 1, 9))]
        tronc(bois, uvb, brin, [0.062 - 0.02 * s + 0.006 * noise.noise(Vector((b, s * 6, 3))) for s in np.linspace(0, 1, 9)], 8, 0.9)
    couronne = Vector((0, 0, h0 + 1.45))
    bouts = []
    for k in range(3):
        phi = k * 2.1 + 0.4
        bout = couronne + horizontale(phi) * 0.3 + Vector((0, 0, 0.12 * (k - 1)))
        milieu = fourche.lerp(bout, 0.5) + horizontale(phi + 1) * 0.05
        tronc(bois, uvb, [fourche, milieu, bout], [0.05, 0.036, 0.02], 7, 0.9)
        bouts.append(bout)
        for m in range(3):
            psi = phi + (m - 1) * 0.9
            fin = bout + horizontale(psi) * 0.22 + Vector((0, 0, 0.05 + 0.06 * m))
            tronc(bois, uvb, [bout, fin], [0.02, 0.008], 5, 0.9)
    # La couronne : des rameaux rayonnants, leur tige vers le cœur.
    for i in range(320):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        r = rng.uniform(0.2, 0.6)
        dirv = Vector((u[0], u[1], u[2] * 0.75)).normalized()
        base = couronne + Vector((dirv.x * r, dirv.y * r, dirv.z * r * 0.75))
        # Pas une étoile : chaque rameau part dans son sens, un peu vers le dehors et vers le haut.
        d = (dirv * 0.6 + Vector(rng.normal(size=3)).normalized() * 0.8 + Vector((0, 0, 0.2))).normalized()
        longueur = rng.uniform(0.26, 0.38)
        cote = d.cross(Vector(rng.normal(size=3))).normalized()
        carte(bm, uv, base - d * 0.08, d, cote, longueur, longueur * rapport, pli=0.1,
              courbure=math.radians(rng.uniform(10, 35)), nl=2, nw=1)
    objet("Olivier-rameaux", bm, mat, racine, lisse=True)
    objet("Olivier-bois", bois, matiere("Olivier-ecorce", (1, 1, 1), 0.9,
                                        ecorce("Olivier-ecorce", (0.18, 0.17, 0.14), (0.45, 0.43, 0.38))), racine)
    return racine


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        print("usage : blender --background --factory-startup --python build-plantes.py -- <dossier des sources>")
        sys.exit(1)
    source = Path(args[0])
    repartir()
    vasque, terre_v = jardiniere("Kentia-vasque", *VASQUE, source)
    kentia(source, vasque, terre_v)
    cuve, terre_c = jardiniere("Lyrata-cuve", *CUVE, source)
    lyrata(source, cuve, terre_c)
    # L'olivier dans la même cuve : une copie qui partage le maillage (un seul dans le fichier).
    cuve2 = bpy.data.objects.new("Olivier-cuve", cuve.data)
    bpy.context.scene.collection.objects.link(cuve2)
    olivier(source, cuve2, terre_c)
    for o in bpy.data.objects:
        if o.type == "MESH":
            print(f"  {o.name:22s} {triangles(o):6d} tri")
    bpy.ops.object.select_all(action="SELECT")
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="WEBP", export_image_quality=82,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    print(f"PLANTES {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(ROOT)}")


main()
