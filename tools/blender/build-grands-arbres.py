"""
Les grands arbres du parc, générés par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-grands-arbres.py -- <dossier des planches>
    node tools/compresser-glb.ts public/assets/jardin/grands-arbres.glb

Produit `public/assets/jardin/grands-arbres.glb`, des sujets à instancier, tous
à l'origine, pied à z = 0 (`src/scene/parkAssets.ts` les lit par leur nom). Le
jardin était plat : des érables de 4,5 m, des boules, le ciel. Trois essences
lui donnent une ligne d'horizon :

- `src_cedre` : le cèdre du Liban (Cedrus libani), 21 m, le grand solitaire des
  parcs. Un fût massif, évasé au pied, et des étages de branches presque à plat,
  de plus en plus courts vers la cime, qui portent le feuillage en PLATEAUX
  horizontaux : des cartes de rameaux couchées face au ciel ;
- `src_ginkgo` : le ginkgo (Ginkgo biloba), 16 m, élancé : un fût droit
  jusqu'en haut, des branches qui montent à 40°, des rameaux courts couverts
  d'éventails. Il passe d'un coup au jaune d'or à l'automne (`intemperies.ts`) ;
- `src_pin` : le pin noir du Japon (Pinus thunbergii), 7 m, taillé en nuages
  (niwaki) : un tronc sinueux qui penche (vers +x : la scène le tourne vers
  l'eau), quelques branches presque à plat, et au bout de chacune un nuage
  d'aiguilles en coupole, sur un cœur sombre qui bouche les jours.

`loin_*` : le même arbre (mêmes tirages), une carte sur deux, de surface double,
pour le voir au-delà de 36 m (`ParkLayer`).

Le feuillage : des cartes découpées dans des planches botaniques Nano Banana 2
(Meshy, fond retiré), `ginkgo-0/1.png`, `cedre-0/1.png`, `pin-0/1.png` ; les
prompts sont dans le manifeste `tools/fetch-assets.ts`. Les outils (fût, cartes,
atlas) sont ceux de `build-vegetation.py`.

Déterministe : des tirages semés, aucune horloge.
"""

import importlib.util
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

ICI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("vegetation", ICI / "build-vegetation.py")
V = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(V)

SORTIE = V.ROOT / "public" / "assets" / "jardin" / "grands-arbres.glb"
HAUT = V.HAUT

# L'atlas des grands arbres : ses propres tuiles, dans les outils de `build-vegetation.py`.
V.TUILES.clear()
V.TUILES.update({
    "ginkgo-a": ("ginkgo-0.png", 0, 1, (-0.9, 0.45)),
    "ginkgo-b": ("ginkgo-1.png", 1, 1, (0.0, 1.0)),
    "cedre-a": ("cedre-0.png", 2, 1, (1.0, 0.0)),
    "cedre-b": ("cedre-1.png", 3, 1, (1.0, 0.0)),
    "pin-a": ("pin-0.png", 0, 0, (0.0, 1.0)),
    "pin-b": ("pin-1.png", 1, 0, (0.0, 1.0)),
})
V.COLS, V.RANGS = 4, 2
V.RECT.clear()


def ecorce_rugueuse():
    """
    L'écorce des vieux arbres : gris-brun sombre, crevassée en long, des plaques
    plus claires entre les crevasses. Raccord parfait autour du fût (u), long en v.
    """
    n = 256
    img = np.zeros((n, n, 4), np.float32)
    for j in range(n):
        y = j / n
        for i in range(n):
            a = 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            # Les crevasses : un bruit étiré en long, creusé au-dessous d'un seuil.
            f = noise.noise(Vector((ca * 2.2, sa * 2.2, y * 5.0)))
            crevasse = max(0.0, 0.18 - abs(f)) / 0.18
            plaque = 0.5 + 0.5 * noise.noise(Vector((ca * 4.0, sa * 4.0, y * 9.0 + 3.1)))
            t = (0.55 + 0.35 * plaque) * (1 - 0.75 * crevasse)
            img[j, i] = (0.2 * t + 0.02, 0.17 * t + 0.02, 0.14 * t + 0.02, 1.0)
    image = bpy.data.images.new("Jardin_Ecorce_Rugueuse", n, n, alpha=False)
    image.pixels.foreach_set(img.ravel())
    image.pack()
    return image


def feuiller(feuillage, cartes, tuiles, rng, loin, pli, taille_carte):
    """Pose les cartes `(centre, normale, pousse, éclairage)` ; de loin, une sur deux, de surface double."""
    for k, (c, nrm, pousse, ecl) in enumerate(cartes):
        taille = rng.uniform(*taille_carte)
        tuile = tuiles[rng.randrange(len(tuiles))]
        if not loin or k % 2 == 0:
            V.carte(feuillage, tuile, c, nrm, pousse, taille * (math.sqrt(2) if loin else 1), ecl, rng, pli=0 if loin else pli)


# ── Le cèdre du Liban ─────────────────────────────────────────────────────

def cedre(nom, ecorce, feuilles, loin=False):
    rng = random.Random(41)
    bois, feuillage = V.Piece(), V.Piece()
    sec = lambda n: max(4, n - 3) if loin else n  # noqa: E731
    hauteur = 21.0
    fut = V.chemin(Vector((0, 0, -0.3)), Vector((0.03, 0.02, 1)), hauteur - 2.5, 9, rng, sinueux=0.03)
    rayons = [0.75, 0.6, 0.52, 0.46, 0.4, 0.34, 0.27, 0.2, 0.13, 0.07]
    V.tube(bois, fut, rayons, sec(16), flare=(6, 0.6, rng.uniform(0, 6.28), 1.4))
    cartes = []
    centre = Vector((0, 0, hauteur * 0.62))
    # Les étages : sept, irréguliers, larges jusqu'en haut — un vieux cèdre a la
    # cime tabulaire, pas la flèche d'un sapin. Des plateaux denses, sur deux couches.
    etages = 7
    for e in range(etages):
        t = e / (etages - 1)
        h = 4.8 + t * (hauteur - 6.0) + rng.uniform(-0.5, 0.5)
        portee = 8.8 - 4.2 * t ** 1.6
        base, _ = V.le_long(fut, min(0.99, (h + 0.3) / (hauteur - 2.2)))
        az0 = rng.uniform(0, 2 * math.pi)
        nb = 4 + rng.randrange(3)
        for b in range(nb):
            az = az0 + 2 * math.pi * b / nb + rng.uniform(-0.5, 0.5)
            # Presque à plat : elle monte un peu, puis retombe du bout, plus bas plus lourde.
            d = Vector((math.cos(az), math.sin(az), rng.uniform(0.05, 0.22)))
            longueur = portee * rng.uniform(0.7, 1.15)
            pts = V.chemin(base, d, longueur, 6, rng, flechir=-0.45 * (1 - t) - 0.1, sinueux=0.07, zmin=-0.3)
            r0 = 0.26 * (1 - 0.6 * t)
            V.tube(bois, pts, [r0 * (1 - 0.85 * (i / 6) ** 0.8) + 0.02 for i in range(7)], sec(8))
            for couche, dz in ((0, 0.12), (1, 0.42)):
                nb_cartes = max(5, round(longueur * (8 if couche == 0 else 5)))
                for k in range(nb_cartes):
                    s = 0.1 + 0.9 * (k + rng.random()) / nb_cartes
                    q, dq = V.le_long(pts, s)
                    cote = Vector((-dq.y, dq.x, 0)).normalized()
                    large = (0.9 + 1.6 * math.sin(math.pi * min(1.0, s * 1.2))) * (0.7 if couche else 1.0)
                    ecart = large * rng.uniform(0.1, 1.0) * (1 if k % 2 else -1)
                    c = q + cote * ecart + Vector((0, 0, dz + rng.gauss(0, 0.1)))
                    nrm = HAUT * 3 + Vector((rng.gauss(0, 0.35), rng.gauss(0, 0.35), 0)) + cote * (0.3 if ecart > 0 else -0.3)
                    pousse = (dq + cote * (0.8 if ecart > 0 else -0.8)).normalized()
                    rel = c - centre
                    ecl = Vector((rel.x / 9.0, rel.y / 9.0, rel.z / 16.0)) + HAUT * (1.4 if couche else 0.9)
                    cartes.append((c, nrm, pousse, ecl))
    # La cime : un dernier plateau, sur la flèche.
    for k in range(40):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 3.0)
        c = fut[-1] + Vector((math.cos(a) * r, math.sin(a) * r, rng.uniform(-0.2, 0.4)))
        cartes.append((c, HAUT * 3 + Vector((math.cos(a), math.sin(a), 0)) * 0.5, Vector((math.cos(a), math.sin(a), 0.1)), HAUT + Vector((math.cos(a), math.sin(a), 0)) * 0.3))
    feuiller(feuillage, cartes, ("cedre-a", "cedre-b"), rng, loin, 0.06, (1.3, 1.9))
    racine = V.vide(nom)
    bois.objet(f"{nom}_bois", ecorce, racine)
    feuillage.objet(f"{nom}_feuilles", feuilles, racine, lisse=True)
    return racine


# ── Le ginkgo ─────────────────────────────────────────────────────────────

def ginkgo(nom, ecorce, feuilles, loin=False):
    rng = random.Random(42)
    bois, feuillage = V.Piece(), V.Piece()
    sec = lambda n: max(4, n - 2) if loin else n  # noqa: E731
    hauteur = 16.0
    fut = V.chemin(Vector((0, 0, -0.2)), Vector((0.02, -0.03, 1)), hauteur - 0.5, 8, rng, sinueux=0.035)
    V.tube(bois, fut, [0.42, 0.34, 0.29, 0.25, 0.2, 0.15, 0.11, 0.07, 0.035], sec(12), flare=(5, 0.45, rng.uniform(0, 6.28), 0.9))
    cartes = []
    centre = Vector((0, 0, hauteur * 0.6))
    # Des branches à 40° tout le long du fût, courtes, plus courtes vers la cime : une silhouette en ogive.
    n_br = 26
    for b in range(n_br):
        t = (b + rng.random() * 0.8) / n_br
        h = 3.2 + t * (hauteur - 4.0)
        base, _ = V.le_long(fut, (h + 0.2) / (hauteur - 0.3))
        az = b * 2.39996 + rng.uniform(-0.3, 0.3)  # l'angle d'or : pas deux branches l'une sur l'autre
        inc = math.radians(rng.uniform(38, 55))
        d = Vector((math.cos(az) * math.sin(inc), math.sin(az) * math.sin(inc), math.cos(inc)))
        longueur = (1.6 + 3.4 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.8) * rng.uniform(0.8, 1.1)
        pts = V.chemin(base, d, longueur, 4, rng, flechir=0.1, sinueux=0.1)
        r0 = 0.09 * (1 - 0.5 * t) + 0.02
        V.tube(bois, pts, [r0, r0 * 0.7, r0 * 0.45, r0 * 0.3, 0.01], sec(6))
        # Les rameaux courts, couverts d'éventails, tout le long ; un bouquet au bout.
        for k in range(max(4, round(longueur * 7))):
            s = 0.2 + 0.8 * rng.random()
            q, dq = V.le_long(pts, s)
            a = math.atan2(dq.y, dq.x) + rng.gauss(0, 1.2)
            dehors = Vector((math.cos(a), math.sin(a), rng.uniform(-0.2, 0.6))).normalized()
            c = q + dehors * rng.uniform(0.15, 0.45)
            nrm = dehors + HAUT * 0.6 + Vector((rng.gauss(0, 0.3), rng.gauss(0, 0.3), rng.gauss(0, 0.3)))
            rel = c - centre
            ecl = Vector((rel.x / 4.5, rel.y / 4.5, rel.z / 6.0)) + nrm.normalized() * 0.4 + HAUT * 0.3
            cartes.append((c, nrm, dehors, ecl))
    feuiller(feuillage, cartes, ("ginkgo-a", "ginkgo-b"), rng, loin, 0.08, (0.6, 0.9))
    racine = V.vide(nom)
    bois.objet(f"{nom}_bois", ecorce, racine)
    feuillage.objet(f"{nom}_feuilles", feuilles, racine, lisse=True)
    return racine


# ── Le pin noir taillé en nuages ──────────────────────────────────────────

def pin(nom, ecorce, feuilles, fond, loin=False):
    rng = random.Random(43)
    bois, feuillage, coeur = V.Piece(), V.Piece(), V.Piece()
    sec = lambda n: max(4, n - 2) if loin else n  # noqa: E731
    # Le tronc : sinueux, il penche vers +x (la scène le tourne vers l'eau).
    pts = [Vector((0, 0, -0.2))]
    d = Vector((0.25, 0.05, 1)).normalized()
    for i in range(9):
        d = (d + Vector((0.07 + rng.gauss(0, 0.12), rng.gauss(0, 0.12), 0.02))).normalized()
        pts.append(pts[-1] + d * 0.95)
    V.tube(bois, pts, [0.38, 0.3, 0.26, 0.23, 0.2, 0.18, 0.16, 0.13, 0.1, 0.07], sec(10), flare=(4, 0.5, rng.uniform(0, 6.28), 0.8))
    cartes = []
    nuages = []
    # Les branches : presque à plat, en spirale le long du tronc ; un nuage au bout de chacune.
    for b in range(6):
        t = 0.28 + 0.62 * b / 5
        base, dt = V.le_long(pts, t)
        az = 0.9 + b * 2.2 + rng.uniform(-0.3, 0.3)
        db = Vector((math.cos(az), math.sin(az), rng.uniform(-0.05, 0.18)))
        longueur = rng.uniform(1.8, 2.9) * (1.1 - 0.35 * t)
        br = V.chemin(base, db, longueur, 4, rng, flechir=0.15, sinueux=0.18)
        V.tube(bois, br, [0.11, 0.085, 0.065, 0.045, 0.03], sec(6))
        nuages.append((br[-1] + Vector((0, 0, 0.22)), rng.uniform(1.3, 1.8) * (1.05 - 0.3 * t)))
    # La cime : un nuage au bout du tronc.
    nuages.append((pts[-1] + Vector((0, 0, 0.3)), 1.4))
    for c0, r in nuages:
        # Le cœur : une coupole aplatie, sombre, qui bouche les jours du nuage.
        n_mer, n_par = 10, 5
        vs = []
        for j in range(n_par + 1):
            phi = (math.pi / 2) * j / n_par
            rang = []
            for i in range(n_mer):
                th = 2 * math.pi * i / n_mer
                p = c0 + Vector((math.cos(th) * math.cos(phi) * r * 0.82, math.sin(th) * math.cos(phi) * r * 0.82, math.sin(phi) * r * 0.42 - 0.12))
                rang.append(coeur.bm.verts.new(p))
            vs.append(rang)
        for j in range(n_par):
            for i in range(n_mer):
                coeur.bm.faces.new([vs[j][i], vs[j][(i + 1) % n_mer], vs[j + 1][(i + 1) % n_mer], vs[j + 1][i]])
        coeur.bm.faces.new(list(reversed(vs[0])))
        # Les touffes d'aiguilles : sur la coupole, pointées vers le dehors et le ciel.
        for k in range(round(70 * r * r)):
            u = rng.random()
            phi = math.asin(u) * rng.uniform(0.85, 1.0)
            th = rng.uniform(0, 2 * math.pi)
            dehors = Vector((math.cos(th) * math.cos(phi), math.sin(th) * math.cos(phi), math.sin(phi) * 0.55)).normalized()
            c = c0 + Vector((dehors.x * r * 0.9, dehors.y * r * 0.9, max(-0.05, dehors.z) * r * 0.55))
            nrm = dehors + HAUT * 0.9
            ecl = dehors + HAUT * 0.7
            cartes.append((c, nrm, (dehors + HAUT * 0.8).normalized(), ecl))
    feuiller(feuillage, cartes, ("pin-a", "pin-b"), rng, loin, 0.1, (0.5, 0.7))
    racine = V.vide(nom)
    bois.objet(f"{nom}_bois", ecorce, racine)
    feuillage.objet(f"{nom}_feuilles", feuilles, racine, lisse=True)
    coeur.objet(f"{nom}_coeur", fond, racine, lisse=True)
    return racine


def construire(dossier):
    V.repartir()
    image = V.atlas(dossier)
    image.name = "Jardin_Grands_Arbres"
    feuilles = V.matiere("Jardin_Feuillage_Grands", (1, 1, 1), 0.9, image=image, alpha=True)
    fond = V.matiere("Jardin_Feuillage_Fond_Pin", (0.035, 0.07, 0.03), 1.0)
    ecorce = V.matiere("Jardin_Ecorce_Rugueuse", (1, 1, 1), 0.9, image=ecorce_rugueuse())
    for loin in (False, True):
        prefixe = "loin" if loin else "src"
        cedre(f"{prefixe}_cedre", ecorce, feuilles, loin)
        ginkgo(f"{prefixe}_ginkgo", ecorce, feuilles, loin)
        pin(f"{prefixe}_pin", ecorce, feuilles, fond, loin)


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
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    for o in bpy.data.objects:
        if o.type == "MESH":
            print(f"GRANDS_ARBRES {o.name:24} {V.triangles(o):6} triangles")
    print(f"GRANDS_ARBRES {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(V.ROOT)}")


def apercu(dossier):
    """Un rendu Cycles des trois arbres côte à côte, pour les juger avant la scène."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    monde = bpy.data.worlds.new("Ciel")
    scene.world = monde
    monde.use_nodes = True
    fondc = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fondc.inputs["Color"].default_value = (0.62, 0.72, 0.85, 1)
    fondc.inputs["Strength"].default_value = 0.9
    soleil = bpy.data.lights.new("Soleil", "SUN")
    soleil.energy = 3.5
    so = bpy.data.objects.new("Soleil", soleil)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(so)
    for o in bpy.data.objects:
        if o.name.startswith("loin_"):
            o.hide_render = True
    for nom, x in (("src_cedre", -14), ("src_ginkgo", 4), ("src_pin", 14)):
        bpy.data.objects[nom].location.x = x
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(V.matiere("Herbe", (0.2, 0.32, 0.12), 0.9))
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 28
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = Vector((0, -46, 9))
    cam.rotation_euler = (Vector((0, 0, 9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(Path(dossier) / "apercu.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        print("usage : blender --background --factory-startup --python tools/blender/build-grands-arbres.py -- <dossier des planches> [--apercu <dossier>]")
        sys.exit(1)
    construire(args[0])
    if "--apercu" in args:
        apercu(args[args.index("--apercu") + 1])
    else:
        exporter()
