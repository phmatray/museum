"""
La végétation du parc et du jardin japonais, générée par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-vegetation.py -- <dossier des planches>
    node tools/compresser-glb.ts public/assets/jardin/vegetation.glb

Produit `public/assets/jardin/vegetation.glb`, des sujets à instancier, tous à
l'origine, pied à z = 0 (`src/scene/parkAssets.ts` les lit par leur nom) :

- `src_erable_rouge`, `src_erable_vert` : l'érable du Japon (Acer palmatum),
  4,5 m, plus large que haut. Un vrai squelette — un fût court et évasé au
  pied, des charpentières qui s'arquent, des branches presque à plat qui
  portent le feuillage en étages, des rameaux, des brindilles — et le feuillage
  en RAMEAUX FEUILLUS : des cartes découpées dans des photos de rameaux,
  accrochées au bout de chaque brindille, la tige tournée vers le bois qui les
  porte. `loin_erable_*` : le même arbre (mêmes tirages), une carte sur deux,
  de surface double, et sans les brindilles, pour le voir au-delà de 36 m.
- `src_buis`, `src_azalee` : des touffes bosselées (trois à cinq bosses), un
  cœur sombre qui bouche les jours, des cartes plaquées dessus et d'autres qui
  dépassent, de chant : la silhouette montre des feuilles, pas une boule.
- `src_lierre` : une plaque de lierre grimpant, 2,2 m de large, dans le plan
  x (le long du mur) et z (la hauteur), qui s'écarte du mur vers −y (+z dans
  three, `plan/enceinte.ts` la tourne vers le parc).
- `src_roseaux`, `src_herbes` : une touffe de roseaux de berge (1,2 à 1,9 m,
  quelques plumets) et une touffe d'herbe du Japon (Hakonechloa) en fontaine.
  Des lames effilées, sans texture, colorées au sommet (attribut de couleur).

Les planches sont des photos « planche botanique » générées par Nano Banana 2
(fond retiré) : `erable-vert-0.png`, `erable-vert-1.png`, `erable-rouge-0.png`,
`erable-rouge-1.png`, `buis-0.png`, `azalee-1.png`, `azalee-0.png`,
`lierre-0.png`. Elles ne sont pas dans le dépôt ; les prompts sont dans le
manifeste `tools/fetch-assets.ts`. Assemblées ici en un atlas 2048 × 1024 :
un seul matériau de feuillage (`Jardin_Feuillage`) pour tous les sujets.

Les noms de matériaux sont ceux que le site reconnaît : `Jardin_Feuillage*`
(saison des érables et des azalées, `intemperies.ts`), `Jardin_Ecorce`,
`Jardin_Herbe` (le vent et la saison des herbes).

Déterministe : des tirages semés, aucune horloge.
"""

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "jardin" / "vegetation.glb"
HAUT = Vector((0, 0, 1))

# ── L'atlas ───────────────────────────────────────────────────────────────
# Tuile : (fichier, colonne, rangée depuis le bas, sens de pousse dans la tuile
# — de la tige vers la pointe, en UV —, ou None si la touffe n'a pas de sens).
COTE = 512
TUILES = {
    "erable-vert-a": ("erable-vert-0.png", 0, 1, (-1.0, 0.0)),
    "erable-vert-b": ("erable-vert-1.png", 1, 1, (0.7, -0.7)),
    "erable-rouge-a": ("erable-rouge-0.png", 2, 1, (0.0, 1.0)),
    "erable-rouge-b": ("erable-rouge-1.png", 3, 1, (0.0, 1.0)),
    "buis": ("buis-0.png", 0, 0, None),
    "azalee-a": ("azalee-1.png", 1, 0, None),
    "azalee-b": ("azalee-0.png", 2, 0, None),
    "lierre": ("lierre-0.png", 3, 0, (-0.75, 0.66)),
}
COLS, RANGS = 4, 2
MARGE = 8  # px : les mips d'une tuile ne bavent pas sur la voisine
RECT = {}  # tuile -> (u0, v0, u1, v1) du contenu, et rapport largeur / hauteur


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def detourer(png):
    """La planche recadrée sur son alpha, bords recolorés de l'intérieur, halo resserré."""
    src = bpy.data.images.load(str(png))
    w, h = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(src)
    ys, xs = np.nonzero(px[..., 3] > 0.1)
    px = px[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
    plein = px[..., 3] > 0.85
    coul = np.where(plein[..., None], px[..., :3], 0)
    poids = plein.astype(np.float32)
    for _ in range(16):
        c = sum(np.roll(np.roll(coul, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        p = sum(np.roll(np.roll(poids, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        neuf = (~plein) & (p > 0)
        coul[neuf] = c[neuf] / p[neuf][:, None]
        poids = np.maximum(poids, (p > 0).astype(np.float32))
        plein = plein | neuf
    px[..., :3] = coul
    px[..., 3] = np.clip((px[..., 3] - 0.25) / 0.6, 0, 1)
    return px


def reduire(px, ww, hh):
    """Réduction par moyenne de boîtes (anti-crénelage), sans dépendance."""
    h, w = px.shape[:2]
    ys = (np.arange(hh + 1) * h / hh).astype(int)
    xs = (np.arange(ww + 1) * w / ww).astype(int)
    cum = np.pad(px.cumsum(0).cumsum(1), ((1, 0), (1, 0), (0, 0)))
    s = cum[ys[1:]][:, xs[1:]] - cum[ys[:-1]][:, xs[1:]] - cum[ys[1:]][:, xs[:-1]] + cum[ys[:-1]][:, xs[:-1]]
    aire = ((ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :])[..., None]
    return s / aire


def atlas(dossier):
    img = np.zeros((RANGS * COTE, COLS * COTE, 4), np.float32)
    for nom, (fichier, c, r, _) in TUILES.items():
        chemin = Path(dossier) / fichier
        if not chemin.exists():
            print(f"VEGETATION_MANQUANT {chemin}")
            sys.exit(1)
        px = detourer(chemin)
        h, w = px.shape[:2]
        k = (COTE - 2 * MARGE) / max(w, h)
        ww, hh = max(8, round(w * k)), max(8, round(h * k))
        px = reduire(px, ww, hh)
        if nom.startswith("erable-rouge"):
            # Le pourpre de la planche, photographié à plat, sortait presque noir sous le houppier.
            px[..., :3] = np.clip(px[..., :3] * 1.15, 0, 1)
        elif nom.startswith("erable-vert"):
            # Le vert tendre de la planche, rétroéclairé, criait au soleil : un peu éteint.
            gris = px[..., :3].mean(axis=2, keepdims=True)
            px[..., :3] = (gris + (px[..., :3] - gris) * 0.82) * 0.86
        x0 = c * COTE + (COTE - ww) // 2
        y0 = r * COTE + (COTE - hh) // 2
        # Le fond de la tuile : la couleur moyenne de ses feuilles (les mips n'y voient pas de noir).
        a = px[..., 3:4]
        moy = (px[..., :3] * a).sum((0, 1)) / max(1e-6, a.sum())
        img[r * COTE:(r + 1) * COTE, c * COTE:(c + 1) * COTE, :3] = moy
        zone = img[y0:y0 + hh, x0:x0 + ww]
        zone[..., :3] = np.where(a > 0.02, px[..., :3], moy)
        zone[..., 3] = px[..., 3]
        RECT[nom] = ((x0 / (COLS * COTE), y0 / (RANGS * COTE), (x0 + ww) / (COLS * COTE), (y0 + hh) / (RANGS * COTE)), ww / hh)
    image = bpy.data.images.new("Jardin_Vegetation", COLS * COTE, RANGS * COTE, alpha=True)
    image.pixels.foreach_set(img.ravel())
    image.pack()
    return image


def ecorce_image():
    """
    L'écorce de l'érable du Japon : lisse, gris-brun, de fines stries en long
    et des taches plus claires (lichen). Bruit tiré sur un cylindre : raccord
    parfait autour de la branche (u) ; assez long en v pour ne pas se répéter.
    """
    n = 256
    img = np.zeros((n, n, 4), np.float32)
    for j in range(n):
        y = j / n
        for i in range(n):
            a = 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            v = noise.noise(Vector((ca * 3.0, sa * 3.0, y * 2.0)))
            f = noise.noise(Vector((ca * 0.8, sa * 0.8, y * 22.0 + 4.2)))
            t = min(1.0, max(0.0, 0.5 + 0.35 * v + 0.3 * f))
            lichen = max(0.0, noise.noise(Vector((ca * 1.6, sa * 1.6, y * 3.0 + 9.0))) - 0.25) * 1.6
            c = [0.2 + 0.14 * t, 0.17 + 0.13 * t, 0.145 + 0.11 * t]
            c = [c[0] + 0.12 * lichen, c[1] + 0.15 * lichen, c[2] + 0.1 * lichen]
            img[j, i] = (*c, 1.0)
    image = bpy.data.images.new("Jardin_Ecorce", n, n, alpha=False)
    image.pixels.foreach_set(img.ravel())
    image.pack()
    return image


def matiere(nom, couleur, rugosite, image=None, alpha=False, couleurs=False):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*couleur, 1.0)
    b.inputs["Roughness"].default_value = rugosite
    if image is not None:
        tex = t.nodes.new("ShaderNodeTexImage")
        tex.image = image
        t.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if alpha:
            seuil = t.nodes.new("ShaderNodeMath")
            seuil.operation = "GREATER_THAN"
            seuil.inputs[1].default_value = 0.5
            t.links.new(tex.outputs["Alpha"], seuil.inputs[0])
            t.links.new(seuil.outputs[0], b.inputs["Alpha"])
            m.surface_render_method = "DITHERED"
    if couleurs:
        attr = t.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        t.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    m.use_backface_culling = not (alpha or couleurs)
    return m


# ── Géométrie ─────────────────────────────────────────────────────────────

class Piece:
    """Un bmesh et ses couches : UV, couleur ; les normales de ses cartes, à part."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = None
        self.normales = {}  # BMVert -> normale d'éclairage (cartes de feuillage)

    def objet(self, nom, mat, parent=None, lisse=True):
        me = bpy.data.meshes.new(nom)
        verts_normales = [self.normales.get(v) for v in self.bm.verts] if self.normales else None
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(mat)
        if "Col" in me.color_attributes:
            # La seule couleur exportée (`COLOR_0`) : l'active, celle que lit le matériau.
            me.color_attributes.active_color_name = "Col"
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for p in me.polygons:
            p.use_smooth = lisse
        if verts_normales is not None:
            me.normals_split_custom_set_from_vertices([n if n is not None else (0, 0, 1) for n in verts_normales])
        o = bpy.data.objects.new(nom, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = parent
        return o


def vide(nom):
    o = bpy.data.objects.new(nom, None)
    bpy.context.scene.collection.objects.link(o)
    return o


def tube(pc, pts, rayons, n, flare=None, v0=0.0):
    """
    Une branche : des anneaux le long d'une polyligne, repères transportés (pas
    de torsion d'un anneau au suivant), UV déroulées pour l'écorce. `flare` :
    (lobes, amplitude, phase) — le pied évasé d'un tronc, en contreforts.
    """
    bm, uv = pc.bm, pc.uv
    tangente = (pts[1] - pts[0]).normalized()
    x = tangente.orthogonal().normalized()
    anneaux, long = [], v0
    for i, (p, r) in enumerate(zip(pts, rayons)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        # Transport parallèle : x tourne avec la tangente, sans vriller.
        x = (x - t * x.dot(t)).normalized()
        y = t.cross(x)
        if i > 0:
            long += (p - pts[i - 1]).length
        anneau = []
        for k in range(n + 1):
            a = 2 * math.pi * k / n
            rr = r
            if flare is not None:
                lobes, amp, phase, hauteur = flare
                chute = max(0.0, 1 - (p.z - pts[0].z) / hauteur)
                rr = r * (1 + amp * chute * chute * max(0.0, math.cos(lobes * a + phase)) ** 2)
            anneau.append((bm.verts.new(p + (x * math.cos(a) + y * math.sin(a)) * rr), (k / n, long / 0.6)))
        anneaux.append(anneau)
    for i in range(len(anneaux) - 1):
        for k in range(n):
            vs = [anneaux[i][k], anneaux[i][k + 1], anneaux[i + 1][k + 1], anneaux[i + 1][k]]
            f = bm.faces.new([v for v, _ in vs])
            for lp, (_, c) in zip(f.loops, vs):
                lp[uv].uv = c
    return long


def chemin(p0, d0, longueur, n, rng, flechir=0.0, sinueux=0.12, zmin=-0.3):
    """Une polyligne qui part selon `d0` et fléchit de `flechir` (vers le bas si négatif)."""
    pts, d = [p0.copy()], d0.normalized()
    for _ in range(n):
        d = (d + Vector((rng.gauss(0, sinueux), rng.gauss(0, sinueux), rng.gauss(0, sinueux * 0.5) + flechir / n))).normalized()
        if d.z < zmin:
            d.z = zmin
            d.normalize()
        pts.append(pts[-1] + d * (longueur / n))
    return pts


def le_long(pts, t):
    """Le point à la fraction `t` de la longueur d'une polyligne, et sa direction."""
    longs = [0.0]
    for a, b in zip(pts, pts[1:]):
        longs.append(longs[-1] + (b - a).length)
    cible = t * longs[-1]
    for i in range(len(pts) - 1):
        if longs[i + 1] >= cible:
            f = (cible - longs[i]) / max(1e-9, longs[i + 1] - longs[i])
            return pts[i].lerp(pts[i + 1], f), (pts[i + 1] - pts[i]).normalized()
    return pts[-1].copy(), (pts[-1] - pts[-2]).normalized()


def carte(pc, tuile, centre, normale, pousse, taille, eclairage, rng, pli=0.12):
    """
    Une carte de feuillage : le rectangle de la tuile, centré en `centre`,
    face à `normale`, sa pousse (tige -> pointe, `TUILES`) tournée selon
    `pousse`. Pliée en V le long de la pousse : un peu de volume, de biais.
    Toute la carte est éclairée comme `eclairage` (normale d'un volume).
    `pli=0` : un simple quad (deux triangles au lieu de huit), pour les sujets
    nombreux ou lointains.
    """
    (u0, v0, u1, v1), aspect = RECT[tuile]
    sens = TUILES[tuile][3]
    n = normale.normalized()
    a = pousse - n * pousse.dot(n)
    if a.length < 1e-4:
        a = n.orthogonal()
    a.normalize()
    b = n.cross(a)
    if sens is None:
        th = rng.uniform(0, 2 * math.pi)
        a, b = a * math.cos(th) + b * math.sin(th), b * math.cos(th) - a * math.sin(th)
        sens = (1.0, 0.0)
    th = math.atan2(sens[1], sens[0])
    eu = a * math.cos(th) - b * math.sin(th)
    ev = a * math.sin(th) + b * math.cos(th)
    w, h = (taille, taille / aspect) if aspect >= 1 else (taille * aspect, taille)
    # Le pli : la ligne de pousse (passant par le centre) relevée vers la normale.
    axe = (eu * sens[0] + ev * sens[1]).normalized()
    travers = n.cross(axe)
    en = eclairage.normalized()

    def pt(s, t):  # s, t dans [0, 1] sur la tuile
        p = centre + eu * ((s - 0.5) * w) + ev * ((t - 0.5) * h)
        d = (p - centre).dot(travers)
        demi = max(1e-6, abs(travers.dot(eu)) * w / 2 + abs(travers.dot(ev)) * h / 2)
        return p + n * (pli * taille * (1 - min(1.0, abs(d) / demi)))

    # Deux triangles de chaque côté du pli : un quad découpé en 2 × 2, milieu relevé.
    k = 2 if pli > 0 else 1
    grille = {}
    for i in range(k + 1):
        for j in range(k + 1):
            v = pc.bm.verts.new(pt(i / k, j / k))
            grille[i, j] = (v, (u0 + (u1 - u0) * i / k, v0 + (v1 - v0) * j / k))
    for i in range(k):
        for j in range(k):
            vs = [grille[i, j], grille[i + 1, j], grille[i + 1, j + 1], grille[i, j + 1]]
            f = pc.bm.faces.new([v for v, _ in vs])
            for lp, (_, c) in zip(f.loops, vs):
                lp[pc.uv].uv = c
    for v, _ in grille.values():
        pc.normales[v] = tuple(en)


# ── L'érable du Japon ─────────────────────────────────────────────────────

def erable(nom, rouge, graine, ecorce, feuilles, loin=False):
    rng = random.Random(graine)
    bois, feuillage = Piece(), Piece()
    tuiles = ("erable-rouge-a", "erable-rouge-b") if rouge else ("erable-vert-a", "erable-vert-b")
    sec = lambda n: max(3, n - 2) if loin else n  # noqa: E731 — moins de pans, de loin

    # Le fût : court, penché, qui se divise bas. Des contreforts au pied.
    fourche = rng.uniform(0.95, 1.3)
    penche = Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 1)).normalized()
    fut = chemin(Vector((0, 0, -0.15)), penche, fourche + 0.15, 5, rng, sinueux=0.05)
    tube(bois, fut, [0.17, 0.125, 0.11, 0.1, 0.095, 0.09], sec(12), flare=(5, 0.7, rng.uniform(0, 6.28), 0.75))
    sommet = fut[-1]

    pousses = []  # (polyligne, début feuillu en fraction, densité) : où pousse le feuillage
    brindilles = []  # (point, direction) : le chevelu nu de l'hiver

    def branche(p0, d0, longueur, r0, r1, n, flechir, niveau):
        pts = chemin(p0 - d0 * r0 * 0.6, d0, longueur, n, rng, flechir=flechir, sinueux=0.1 if niveau < 2 else 0.18)
        rayons = [r0 + (r1 - r0) * (i / n) ** 0.8 for i in range(n + 1)]
        tube(bois, pts, rayons, sec((8, 6, 4, 3)[niveau]))
        return pts

    nb = 3 + rng.randrange(3)
    az0 = rng.uniform(0, 2 * math.pi)
    etendue = []
    for i in range(nb):
        az = az0 + 2 * math.pi * i / nb + rng.uniform(-0.35, 0.35)
        inc = math.radians(rng.uniform(22, 42))
        d = Vector((math.cos(az) * math.sin(inc), math.sin(az) * math.sin(inc), math.cos(inc)))
        base = le_long(fut, rng.uniform(0.8, 1.0))[0]
        charp = branche(base, d, rng.uniform(1.7, 2.3), 0.08, 0.025, 6, -0.8, 0)
        pousses.append((charp, 0.55, 1.0))
        etendue.append(charp[-1])
        # Les branches : presque à plat, en éventail, qui portent chacune un étage.
        for k in range(3 + rng.randrange(2)):
            t = 0.3 + 0.62 * (k + rng.random() * 0.6) / 4
            p, dp = le_long(charp, t)
            a2 = math.atan2(dp.y, dp.x) + rng.choice((-1, 1)) * rng.uniform(0.35, 1.25)
            d2 = Vector((math.cos(a2), math.sin(a2), rng.uniform(-0.05, 0.3)))
            r2 = 0.04 * (1 - 0.5 * t)
            br = branche(p, d2, rng.uniform(0.7, 1.15) * (1.1 - 0.4 * t), r2, 0.012, 4, -0.35, 1)
            pousses.append((br, 0.45, 1.0))
            etendue.append(br[-1])
            # Les rameaux : deux ou trois, qui s'écartent et se relèvent du bout.
            for m in range(2 + rng.randrange(2)):
                q, dq = le_long(br, rng.uniform(0.35, 0.95))
                a3 = math.atan2(dq.y, dq.x) + rng.choice((-1, 1)) * rng.uniform(0.4, 1.1)
                d3 = Vector((math.cos(a3), math.sin(a3), rng.uniform(0.0, 0.35)))
                rm = branche(q, d3, rng.uniform(0.3, 0.55), 0.013, 0.004, 3, 0.15, 2)
                pousses.append((rm, 0.0, 1.0))
                brindilles.append((rm[-1], (rm[-1] - rm[-2]).normalized()))
    # La flèche, au centre : elle porte le sommet du houppier.
    haut = max(p.z for p in etendue)
    fleche = branche(sommet, Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 1)), haut + 0.25 - sommet.z, 0.07, 0.015, 5, 0.0, 1)
    pousses.append((fleche, 0.75, 1.0))
    for k in range(3):
        p, _ = le_long(fleche, 0.45 + 0.18 * k)
        a = rng.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), 0.25))
        br = branche(p, d, rng.uniform(0.6, 1.0), 0.025, 0.006, 3, -0.2, 2)
        pousses.append((br, 0.2, 1.0))
        brindilles.append((br[-1], d.normalized()))
    # Le chevelu de l'hiver : de chaque bout de rameau, des brindilles en zigzag.
    # Tirées d'un aléa à part : le feuillage ne dépend pas du nombre de brindilles.
    rng_b = random.Random(graine * 7 + 1)
    for p, d in brindilles + [(pts[-1], (pts[-1] - pts[-2]).normalized()) for pts, debut, _ in pousses if debut > 0.4]:
        for _ in range(3):
            a = math.atan2(d.y, d.x) + rng_b.gauss(0, 0.9)
            dd = Vector((math.cos(a), math.sin(a), rng_b.uniform(-0.05, 0.45)))
            pts = chemin(p, dd, rng_b.uniform(0.2, 0.42), 2, rng_b, sinueux=0.25)
            if not loin:
                tube(bois, pts, [0.005, 0.0035, 0.002], 3)

    # Le feuillage : des rameaux feuillus le long des pousses, en éventail au bout,
    # comme sur l'arbre — les étages suivent les branches, le jour passe entre eux.
    centre = sum((pts[-1] for pts, _, _ in pousses), Vector()) / len(pousses)
    rayon = max(Vector((pts[-1].x - centre.x, pts[-1].y - centre.y, 0)).length for pts, _, _ in pousses) + 0.5
    n_carte = 0

    def poser(c, pousse, nrm):
        nonlocal n_carte
        taille = rng.uniform(0.34, 0.52)
        tuile = tuiles[rng.randrange(2)]
        # Éclairée comme un volume : la normale fuit le cœur du houppier, le dessous d'un étage reste sombre.
        rel = c - Vector((centre.x, centre.y, centre.z - 0.5))
        ecl = Vector((rel.x / rayon, rel.y / rayon, rel.z / 1.6)) + nrm.normalized() * 0.5 + HAUT * 0.3
        if not loin or n_carte % 2 == 0:
            carte(feuillage, tuile, c, nrm, pousse, taille * (math.sqrt(2) if loin else 1), ecl, rng, pli=0)
        n_carte += 1

    for pts, debut, poids in pousses:
        longueur = sum((b - a).length for a, b in zip(pts, pts[1:])) * (1 - debut)
        for k in range(max(1, round(longueur * 20 * poids))):
            q, dq = le_long(pts, debut + (1 - debut) * rng.random())
            cote = Vector((-dq.y, dq.x, 0))
            cote = cote.normalized() if cote.length > 1e-3 else Vector((1, 0, 0))
            s = 1 if k % 2 else -1  # alternes, d'un côté puis de l'autre
            c = q + cote * s * rng.uniform(0.08, 0.3) + Vector((0, 0, rng.gauss(0.05, 0.08)))
            pousse = (dq + cote * s * rng.uniform(0.3, 1.2)).normalized()
            # Plutôt à plat, face au ciel, penchée de son côté ; quelques-unes dressées de biais.
            penche = rng.uniform(0.15, 0.75) if rng.random() < 0.7 else rng.uniform(0.9, 2.2)
            nrm = HAUT + cote * s * penche + Vector((rng.gauss(0, 0.25), rng.gauss(0, 0.25), 0))
            poser(c, pousse, nrm)
        # Le bout : un éventail de trois ou quatre rameaux.
        q, dq = pts[-1], (pts[-1] - pts[-2]).normalized()
        for k in range(3 + rng.randrange(2)):
            a = math.atan2(dq.y, dq.x) + (k - 1.5) * 0.6 + rng.gauss(0, 0.2)
            pousse = Vector((math.cos(a), math.sin(a), dq.z * 0.5 + rng.uniform(-0.1, 0.25)))
            nrm = HAUT + Vector((math.cos(a), math.sin(a), 0)) * rng.uniform(0.2, 1.0) + Vector((rng.gauss(0, 0.3), rng.gauss(0, 0.3), 0))
            poser(q + pousse * rng.uniform(0.1, 0.2), pousse, nrm)

    racine = vide(nom)
    bois.objet(f"{nom}_bois", ecorce, racine)
    feuillage.objet(f"{nom}_feuilles", feuilles, racine, lisse=True)
    # Dessiné à 3,5 m, porté à 4,5 m : un vieil érable de jardin. Dans les
    # maillages : `parkAssets.ts` cuit les transformations SOUS le nœud, pas la sienne.
    for o in racine.children:
        o.data.transform(Matrix.Scale(1.3, 4))
    return racine


# ── Les touffes : buis et azalée ──────────────────────────────────────────

def touffe(nom, tuiles, graine, fond, feuilles, r=0.8, h=0.62, bosses=4, cartes=190, chant=70, taille=(0.34, 0.46)):
    rng = random.Random(graine)
    # Des bosses : des ellipsoïdes qui se chevauchent, plus hautes au centre.
    ell = [(Vector((0, 0, h * 0.35)), Vector((r * 0.75, r * 0.75, h * 0.7)))]
    for k in range(bosses):
        a = 2 * math.pi * k / bosses + rng.uniform(-0.5, 0.5)
        d = rng.uniform(0.3, 0.5) * r
        rr = rng.uniform(0.45, 0.65) * r
        ell.append((Vector((math.cos(a) * d, math.sin(a) * d, rng.uniform(0.15, 0.3) * h)), Vector((rr, rr * rng.uniform(0.85, 1.15), rng.uniform(0.5, 0.75) * h))))
    o = Vector((0, 0, h * 0.3))

    def surface(u):
        """Le bord de l'union des bosses sur le rayon partant de `o` selon `u`, et sa normale."""
        meilleur, nrm = 0.0, u
        for c, e in ell:
            # Rayon o + t u dans l'ellipsoïde (c, e) : racine la plus lointaine.
            q = Vector(((o.x - c.x) / e.x, (o.y - c.y) / e.y, (o.z - c.z) / e.z))
            w = Vector((u.x / e.x, u.y / e.y, u.z / e.z))
            A, B, C = w.dot(w), 2 * q.dot(w), q.dot(q) - 1
            disc = B * B - 4 * A * C
            if disc < 0:
                continue
            t = (-B + math.sqrt(disc)) / (2 * A)
            if t > meilleur:
                p = o + u * t
                meilleur, nrm = t, Vector(((p.x - c.x) / e.x ** 2, (p.y - c.y) / e.y ** 2, (p.z - c.z) / e.z ** 2)).normalized()
        return o + u * meilleur, nrm

    coeur, fe = Piece(), Piece()
    # Le cœur : une coque sombre un peu en retrait, qui bouche les jours entre les cartes.
    nu, nv = 14, 7
    anneaux = []
    for j in range(nv + 1):
        phi = -0.35 + (math.pi / 2 + 0.35) * j / nv
        anneau = []
        for k in range(nu):
            th = 2 * math.pi * k / nu
            u = Vector((math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th), math.sin(phi)))
            p, _ = surface(u)
            p = o + (p - o) * 0.86
            p.z = max(p.z, -0.03)
            anneau.append(coeur.bm.verts.new(p))
        anneaux.append(anneau)
    for a, b in zip(anneaux, anneaux[1:]):
        for k in range(nu):
            coeur.bm.faces.new([a[k], a[(k + 1) % nu], b[(k + 1) % nu], b[k]])
    bmesh.ops.recalc_face_normals(coeur.bm, faces=coeur.bm.faces)

    def direction():
        while True:
            u = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.25, 1)))
            if 0.05 < u.length <= 1:
                return u.normalized()

    for i in range(cartes + chant):
        u = direction()
        p, nrm = surface(u)
        if i < cartes:
            # Plaquées : face au dehors, un peu dans le feuillage.
            c = o + (p - o) * rng.uniform(0.9, 1.02)
            n_geo = nrm + Vector((rng.gauss(0, 0.3), rng.gauss(0, 0.3), rng.gauss(0, 0.3)))
            t = rng.uniform(*taille)
        else:
            # De chant : debout sur la surface, elles dépassent et découpent la silhouette.
            c = o + (p - o) * rng.uniform(1.0, 1.08)
            n_geo = nrm.cross(Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))).normalized() + nrm * 0.4
            t = rng.uniform(*taille) * 0.8
        if c.z < 0.02:
            continue
        carte(fe, tuiles[rng.randrange(len(tuiles))], c, n_geo, nrm, t, nrm + HAUT * 0.25, rng, pli=0)
    racine = vide(nom)
    coeur.objet(f"{nom}_coeur", fond, racine)
    fe.objet(f"{nom}_feuilles", feuilles, racine)
    return racine


# ── Le lierre ─────────────────────────────────────────────────────────────

def lierre(nom, feuilles):
    """
    Une plaque de lierre sur un mur (le plan y = 0, le parc côté −y) : des tiges
    qui partent du pied en éventail et montent en ondulant, serrées en bas,
    effilochées en haut, des rameaux qui s'écartent du mur de quelques centimètres.
    """
    rng = random.Random("lierre")
    pc = Piece()
    for k in range(14):
        x0 = rng.gauss(0, 0.6)
        hauteur = rng.uniform(1.1, 2.1)
        pts = [Vector((x0, 0, 0))]
        d = Vector((rng.uniform(-0.6, 0.6), 0, 1)).normalized()
        n = 7
        for i in range(n):
            d = Vector((d.x + rng.gauss(0, 0.35), 0, d.z + 0.15)).normalized()
            pts.append(pts[-1] + d * hauteur / n)
        for i in range(1, n + 1):
            p, dp = pts[i], (pts[i] - pts[i - 1]).normalized()
            dense = 1.0 - i / (n + 1) * 0.6
            for _ in range(1 + (rng.random() < dense) + (rng.random() < dense * 0.8) + (rng.random() < dense * 0.4)):
                ecart = rng.uniform(0.02, 0.14)
                c = p + Vector((rng.gauss(0, 0.12), -ecart, rng.gauss(0, 0.08)))
                # Face au parc (−y), penchée vers le ciel et de biais.
                nrm = Vector((rng.gauss(0, 0.35), -1, rng.uniform(0.0, 0.6)))
                pousse = dp + Vector((rng.gauss(0, 0.5), 0, 0))
                carte(pc, "lierre", c, nrm, pousse, rng.uniform(0.38, 0.55), Vector((rng.gauss(0, 0.3), -1, 0.25 + 0.15 * i / n)), rng, pli=0)
    racine = vide(nom)
    pc.objet(f"{nom}_feuilles", feuilles, racine)
    return racine


# ── Les herbes de berge ───────────────────────────────────────────────────

def lame(pc, base, direction, longueur, largeur, arc, segments, bas, pointe, rng):
    """Une lame effilée qui s'arque sous son poids ; la couleur passe du pied à la pointe."""
    d = direction.normalized()
    cote = d.cross(HAUT)
    cote = cote.normalized() if cote.length > 1e-3 else Vector((1, 0, 0))
    cote.rotate(Matrix.Rotation(rng.uniform(-0.6, 0.6), 3, d))
    pts, p = [], base.copy()
    for i in range(segments + 1):
        t = i / segments
        pts.append((p.copy(), d.copy(), t))
        p = p + d * (longueur / segments)
        # L'arc : la lame se couche vers le bas en avançant.
        axe = d.cross(Vector((0, 0, -1)))
        if axe.length > 1e-4:
            d = (Matrix.Rotation(arc / segments, 3, axe.normalized()) @ d).normalized()
    rangs = []
    for p, dd, t in pts:
        w = largeur * (1 - t) ** 0.7 * (0.6 + 0.4 * math.sin(math.pi * min(1.0, t * 1.4 + 0.2)))
        c = [bas[k] + (pointe[k] - bas[k]) * t for k in range(3)]
        rangs.append([(pc.bm.verts.new(p - cote * w / 2), c), (pc.bm.verts.new(p + cote * w / 2), c)])
    for a, b in zip(rangs, rangs[1:]):
        vs = [a[0], a[1], b[1], b[0]]
        f = pc.bm.faces.new([v for v, _ in vs])
        for lp, (_, c) in zip(f.loops, vs):
            lp[pc.col] = (*c, 1.0)


def touffe_herbe(nom, mat, graine, lames, longueur, largeur, arc, evase, plumets=0):
    rng = random.Random(graine)
    pc = Piece()
    pc.col = pc.bm.loops.layers.float_color.new("Col")
    for _ in range(lames):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.12)
        base = Vector((math.cos(a) * r, math.sin(a) * r, -0.02))
        penche = rng.uniform(*evase)
        d = Vector((math.cos(a) * penche, math.sin(a) * penche, 1))
        l = rng.uniform(*longueur)
        vert = rng.uniform(0.85, 1.15)
        lame(pc, base, d, l, rng.uniform(*largeur), rng.uniform(*arc), 5, (0.06 * vert, 0.12 * vert, 0.03), (0.22 * vert, 0.36 * vert, 0.08), rng)
    for _ in range(plumets):
        # Le plumet du roseau : une hampe fine, puis un épi brun qui penche.
        a = rng.uniform(0, 2 * math.pi)
        base = Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0))
        d = Vector((math.cos(a) * 0.08, math.sin(a) * 0.08, 1))
        h = rng.uniform(1.55, 1.95)
        lame(pc, base, d, h, 0.012, 0.15, 4, (0.12, 0.17, 0.06), (0.3, 0.3, 0.14), rng)
        tete = base + d.normalized() * h
        for _ in range(12):
            dd = Vector((math.cos(a) * 0.6 + rng.gauss(0, 0.35), math.sin(a) * 0.6 + rng.gauss(0, 0.35), rng.uniform(0.3, 1.0)))
            lame(pc, tete - Vector((0, 0, rng.uniform(0.0, 0.2))), dd, rng.uniform(0.16, 0.3), 0.03, 1.4, 3, (0.26, 0.18, 0.14), (0.45, 0.36, 0.3), rng)
    racine = vide(nom)
    pc.objet(f"{nom}_lames", mat, racine)
    return racine


# ── Tout ──────────────────────────────────────────────────────────────────

def construire(dossier):
    repartir()
    image = atlas(dossier)
    feuilles = matiere("Jardin_Feuillage", (1, 1, 1), 0.92, image=image, alpha=True)
    fond = matiere("Jardin_Feuillage_Fond", (0.06, 0.13, 0.035), 1.0)
    ecorce = matiere("Jardin_Ecorce", (1, 1, 1), 0.85, image=ecorce_image())
    herbe = matiere("Jardin_Herbe", (1, 1, 1), 0.75, couleurs=True)
    erable("src_erable_rouge", True, 11, ecorce, feuilles)
    erable("src_erable_vert", False, 12, ecorce, feuilles)
    erable("loin_erable_rouge", True, 11, ecorce, feuilles, loin=True)
    erable("loin_erable_vert", False, 12, ecorce, feuilles, loin=True)
    touffe("src_buis", ("buis",), 21, fond, feuilles, cartes=300, chant=90, taille=(0.24, 0.34))
    touffe("src_azalee", ("azalee-a", "azalee-b"), 22, fond, feuilles, r=0.75, h=0.58, bosses=5, cartes=240, chant=90, taille=(0.28, 0.4))
    lierre("src_lierre", feuilles)
    touffe_herbe("src_roseaux", herbe, 31, 64, (0.8, 1.6), (0.026, 0.04), (0.3, 1.1), (0.04, 0.3), plumets=6)
    touffe_herbe("src_herbes", herbe, 32, 110, (0.45, 0.8), (0.018, 0.03), (1.2, 2.0), (0.3, 1.0))


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_image_format="WEBP",
        export_image_quality=90,
        export_vertex_color="ACTIVE",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    for o in bpy.data.objects:
        if o.type == "MESH":
            print(f"VEGETATION {o.name:26} {triangles(o):6} triangles")
    print(f"VEGETATION {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(ROOT)}")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        print("usage : blender --background --factory-startup --python tools/blender/build-vegetation.py -- <dossier des planches>")
        sys.exit(1)
    construire(args[0])
    if "--no-export" not in args:
        exporter()
