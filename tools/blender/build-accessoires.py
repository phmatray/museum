"""
Les accessoires du musée : des modèles Meshy (texte ou image → 3D, texture PBR),
mis à l'échelle réelle, allégés et réunis dans un seul fichier, avec ce qui se
modèle mieux à la main.

    blender --background --factory-startup --python tools/blender/build-accessoires.py -- <dossier des GLB Meshy>

Produit `public/assets/architecture/accessoires.glb`, une pièce par nœud,
instanciées par `src/scene/MobilierLayer.tsx` aux places de `src/plan/mobilier.ts`.
Les GLB bruts de Meshy (≈ 6 Mo chacun, textures 2K) ne sont pas dans le dépôt :
les prompts sont dans le manifeste `tools/fetch-assets.ts`. Le fichier produit,
lui, est commité — la CI n'a ni Blender ni clé Meshy.

Meshy livre chaque objet centré dans un cube de ±0,95, sans échelle. Ici :
une rotation pour que l'avant regarde −Y Blender (+Z three), l'échelle réelle
d'après UNE cote connue, l'origine au sol au centre de l'emprise, un plafond
de triangles, des textures ramenées à 1024 (512 pour les petits objets), en WebP.

Modelés ici, sans IA :
- l'abri à vélos : poteaux galvanisés, toit de polycarbonate, cinq arceaux
  « Sheffield », trois vélos différents appuyés et cadenassés (antivol en U).
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path(bpy.path.abspath("//")).resolve()
SORTIE = ROOT / "public" / "assets" / "architecture" / "accessoires.glb"

# nom du nœud : (fichier Meshy, axe de la cote, cote en m, rotation z en degrés, plafond de triangles, texture)
PIECES = {
    "Potelet": ("potelet.glb", "z", 0.95, 0, 2000, 512),
    "ChaiseGardien": ("chaise.glb", "z", 0.88, 0, 3500, 512),
    "Presentoir": ("presentoir.glb", "x", 1.4, 0, 7000, 1024),
    "Extincteur": ("extincteur.glb", "z", 0.55, 0, 1500, 512),
    "PanneauHoraires": ("panneau.glb", "x", 1.6, 0, 3000, 1024),
    "Fontaine": ("fontaine.glb", "x", 3.0, 0, 15000, 1024),
    "Versailles": ("versailles.glb", "z", 1.4, 0, 8000, 1024),
}
# Les vélos de l'abri, même traitement (leur long axe selon x, l'avant vers +x).
VELOS = {
    "VeloHollandais": ("velo.glb", "x", 1.78, 0, 11000, 1024),
    "VeloCourse": ("route.glb", "x", 1.72, 0, 11000, 1024),
    "VeloDame": ("dame.glb", "x", 1.80, 0, 11000, 1024),
}


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def importer(nom, fichier, axe, cote, rot, plafond, tex, source):
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / fichier))
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    maillages = [o for o in nouveaux if o.type == "MESH"]
    # Détacher de la hiérarchie en gardant la transformation, puis un seul objet.
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
    o.rotation_euler[2] += math.radians(rot)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # L'échelle réelle, d'après la cote donnée.
    lo = Vector([min(v.co[i] for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in o.data.vertices) for i in range(3)])
    k = cote / (hi - lo)["xyz".index(axe)]
    # L'origine au sol, au centre de l'emprise.
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
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                img = n.image
                img.name = f"{nom}-{n.label or n.name}"
                if max(img.size) > tex:
                    img.scale(tex, tex)
    dims = (hi - lo) * k
    print(f"ACCESSOIRE {nom:16s} {depart:6d} -> {triangles(o):6d} tri, {dims.x:.2f} × {dims.y:.2f} × {dims.z:.2f} m, textures {tex}")
    return o


# ── Petits outils de modelage ────────────────────────────────────────────────

def matiere(nom, rgb, metal=0.0, rugosite=0.6, alpha=1.0):
    """Une matière PBR unie."""
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rugosite
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


def objet(nom, bm, mat, parent=None, lisse=False):
    me = bpy.data.meshes.new(nom)
    bm.to_mesh(me)
    bm.free()
    if lisse:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(nom, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    o.parent = parent
    return o


def vide(nom):
    o = bpy.data.objects.new(nom, None)
    bpy.context.scene.collection.objects.link(o)
    return o


def pave(bm, c, s, m=Matrix()):
    """Un pavé de centre `c` et de côtés `s`, puis la transformation `m`."""
    bmesh.ops.create_cube(bm, size=1, matrix=m @ Matrix.Translation(c) @ Matrix.Diagonal((*s, 1)))


def tube(bm, a, b, r, seg=12, m=Matrix()):
    """Un tube droit de a à b, bouts fermés."""
    a, b = m @ Vector(a), m @ Vector(b)
    v = b - a
    rot = v.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=v.length,
                          matrix=Matrix.Translation((a + b) / 2) @ rot)


def rotule(bm, p, r, m=Matrix()):
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=r, matrix=m @ Matrix.Translation(p))


def polyligne(bm, pts, r, seg=12, m=Matrix()):
    """Un tube cintré : des tronçons droits, une rotule à chaque coude."""
    for a, b in zip(pts, pts[1:]):
        tube(bm, a, b, r, seg, m)
    for p in pts[1:-1]:
        rotule(bm, p, r, m)


# ── L'abri à vélos ───────────────────────────────────────────────────────────

LARGEUR, PROF = 4.5, 2.2
TOIT_AVANT, TOIT_ARRIERE = 2.45, 2.30
ARCEAUX = [-1.8, -0.9, 0.0, 0.9, 1.8]
H_ARCEAU = 0.80
# Les vélos : (modèle, arceau, sens — +1 l'avant vers l'allée, −1 vers le fond —, antivol).
# Chacun est appuyé du côté +x de son arceau, le cadre contre le tube ; les
# arceaux des deux bouts restent libres. L'antivol en U enserre le cadre et l'arceau :
# « barre » par-dessus la traverse et le tube horizontal du cadre ; « pied »,
# couché, autour d'un pied de l'arceau et du tube de selle (le vélo de dame n'a
# pas de tube horizontal).
GARAGE = [
    ("VeloHollandais", 1, 1, "barre"),
    ("VeloCourse", 2, -1, "barre"),
    ("VeloDame", 3, 1, "pied"),
]
INCLINAISON = math.radians(4)  # appuyé : le vélo penche vers l'arceau


def acier_galva():
    return matiere("AbriVelos-acier", (0.56, 0.58, 0.59), metal=0.85, rugosite=0.42)


def abri(source):
    """
    L'abri d'après une photo de fabricant : quatre poteaux tubulaires droits
    jusqu'à 1 m, puis évasés vers les angles du toit, une traverse de chaque
    côté ; un toit plat de polycarbonate sur un cadre d'acier, en légère pente
    vers l'arrière ; cinq arceaux « Sheffield » sur platines rondes. L'avant
    (ouvert) regarde −Y Blender, +Z three.
    """
    racine = vide("AbriVelos")
    acier = bmesh.new()
    y0 = 0.55  # les pieds des poteaux, en retrait des angles du toit
    for sx in (-1, 1):
        x = sx * (LARGEUR / 2 - 0.2)
        for sy, haut in ((-1, TOIT_AVANT), (1, TOIT_ARRIERE)):
            polyligne(acier, [(x, sy * y0, 0), (x, sy * y0, 1.0), (x, sy * (PROF / 2 - 0.12), haut - 0.08)], 0.038, 14)
            pave(acier, (x, sy * y0, 0.006), (0.2, 0.2, 0.012))
        tube(acier, (x, -y0, 0.95), (x, y0, 0.95), 0.03, 12)

    # Le toit : un cadre en tôle pliée, deux pannes, deux chevrons, la plaque de polycarbonate.
    pente = Matrix.Translation((0, 0, (TOIT_AVANT + TOIT_ARRIERE) / 2)) @ Matrix.Rotation(-math.atan2(TOIT_AVANT - TOIT_ARRIERE, PROF), 4, "X")
    W, D = LARGEUR + 0.1, PROF + 0.1
    for sy in (-1, 1):
        pave(acier, (0, sy * D / 2, -0.03), (W, 0.05, 0.1), pente)
    for sx in (-1, 1):
        pave(acier, (sx * W / 2, 0, -0.03), (0.05, D, 0.1), pente)
    for y in (-0.37, 0.37):
        pave(acier, (0, y, -0.04), (W, 0.06, 0.06), pente)
    for x in (-0.75, 0.75):
        pave(acier, (x, 0, -0.04), (0.06, D, 0.06), pente)
    for sx in (-1, 1):
        for sy in (-1, 1):
            pave(acier, (sx * (LARGEUR / 2 - 0.2), sy * (PROF / 2 - 0.12), -0.09), (0.16, 0.16, 0.01), pente)

    # Les arceaux : un U renversé de tube Ø 48 mm, dans le sens de la profondeur.
    r, l = 0.18, 0.40
    u = [(-l, 0), (-l, H_ARCEAU - r)]
    u += [(-l + r - r * math.cos(a), H_ARCEAU - r + r * math.sin(a)) for a in [math.pi / 2 * i / 5 for i in range(1, 6)]]
    u += [(l - r + r * math.sin(a), H_ARCEAU - r + r * math.cos(a)) for a in [math.pi / 2 * i / 5 for i in range(0, 6)]]
    u += [(l, 0)]
    for x in ARCEAUX:
        polyligne(acier, [(x, y, z) for y, z in u], 0.024, 10)
        for y in (-l, l):
            bmesh.ops.create_cone(acier, cap_ends=True, segments=16, radius1=0.075, radius2=0.075, depth=0.01,
                                  matrix=Matrix.Translation((x, y, 0.005)))
    objet("AbriVelos-acier", acier, acier_galva(), racine)

    plaque = bmesh.new()
    pave(plaque, (0, 0, 0.025), (W - 0.04, D - 0.04, 0.008), pente)
    objet("AbriVelos-verre", plaque, matiere("AbriVelos-verre", (0.82, 0.88, 0.92), rugosite=0.25, alpha=0.35), racine)

    # Les vélos, et leur antivol.
    corps, anse = bmesh.new(), bmesh.new()
    for nom, i, sens, prise in GARAGE:
        o = importer(nom, *VELOS[nom], source)
        if nom == "VeloHollandais":
            noircir(o)
        redresser(o)
        # Le long de la profondeur, l'avant vers l'allée (sens +1) ou vers le fond.
        o.data.transform(Matrix.Rotation(sens * math.pi / 2, 4, "Z"))
        xa = ARCEAUX[i]
        if prise == "pied":
            # Le tube de selle, à 50 cm du sol, amené contre le pied arrière de l'arceau.
            selle = [v.co.y for v in o.data.vertices if 0.47 < v.co.z < 0.53 and abs(v.co.x) < 0.03 and abs(v.co.y) < 0.2]
            ys = sum(selle) / len(selle)
            o.data.transform(Matrix.Translation((0, 0.4 - ys, 0)))
        # Appuyé : penché vers l'arceau (−x) autour de sa ligne de contact au sol.
        o.data.transform(Matrix.Rotation(-INCLINAISON, 4, "Y"))
        pts = [v.co for v in o.data.vertices]
        bas = min(p.z for p in pts)
        # Le cadre contre le tube : le point du vélo le plus près de l'arceau, à hauteur d'arceau.
        cote = min(p.x for p in pts if H_ARCEAU - 0.12 < p.z < H_ARCEAU + 0.05 and abs(p.y) < 0.35)
        dx = xa + 0.024 - cote
        # Posé : le bas des pneus exactement au sol (le test de `mobilier.test.ts` le vérifie).
        o.data.transform(Matrix.Translation((dx, 0, -bas)))
        o.parent = racine
        o.data.update()
        pts = [v.co for v in o.data.vertices]
        if prise == "barre":
            # Là où le tube horizontal passe le plus près de la traverse (z 0,776–0,824), le long de sa partie droite.
            def tube_cadre(y):
                z = [p.z for p in pts if abs(p.y - y) < 0.01 and 0.62 < p.z < 0.95 and p.x < xa + 0.12]
                return (min(z), max(z)) if z else None
            candidats = [(y / 100, tube_cadre(y / 100)) for y in range(-18, 19, 2)]
            ya, (zb, zh) = min(((y, t) for y, t in candidats if t), key=lambda c: abs((c[1][0] + c[1][1]) / 2 - H_ARCEAU))
            corps_z = min(zb, H_ARCEAU - 0.024) - 0.05
            haut = max(zh, H_ARCEAU + 0.024) - corps_z + 0.05
            m = Matrix.Translation((xa + 0.028, ya, corps_z)) @ Matrix.Rotation(math.radians(5 * sens), 4, "Y")
        else:
            # Couché, l'anse vers l'arrière : elle entoure le pied (y = 0,4) et le tube de selle.
            ya, corps_z, haut = 0.4 - 0.06, 0.5, 0.17
            m = Matrix.Translation((xa + 0.028, ya, corps_z)) @ Matrix.Rotation(-math.pi / 2, 4, "X")
        antivol(corps, anse, m, haut)
        print(f"VELO {nom:16s} arceau {i} x {dx:+.3f}, remonté de {-bas:+.3f} m, antivol {prise} y {ya:+.2f} z {corps_z:.2f}")
    objet("AbriVelos-antivol", corps, matiere("AbriVelos-antivol", (0.95, 0.62, 0.02), rugosite=0.4), racine)
    objet("AbriVelos-anse", anse, matiere("AbriVelos-anse", (0.03, 0.03, 0.035), metal=0.6, rugosite=0.35), racine)
    print("ACCESSOIRE AbriVelos         procédural + vélos Meshy")


def redresser(o):
    """
    Meshy pose parfois le vélo un peu de biais : on l'aligne sur x par ses deux
    appuis au sol (le bas des deux pneus), et on le recentre sur leur milieu.
    """
    bas = [v.co for v in o.data.vertices if v.co.z < 0.03]
    av = [p for p in bas if p.x < -0.4]
    ar = [p for p in bas if p.x > 0.4]
    a = sum(av, Vector()) / len(av)
    b = sum(ar, Vector()) / len(ar)
    angle = math.atan2(b.y - a.y, b.x - a.x)
    milieu = (a + b) / 2
    o.data.transform(Matrix.Rotation(-angle, 4, "Z") @ Matrix.Translation((-milieu.x, -milieu.y, 0)))
    print(f"VELO {o.name:16s} redressé de {math.degrees(angle):+.1f}°")


def antivol(corps, anse, m, h):
    """Un antivol en U : anse de Ø 16 mm gainée de noir, 13 cm de large, `h` de haut ; corps jaune en travers."""
    r = 0.065
    pts = [(-r, 0, 0), (-r, 0, h - r)]
    pts += [(-r * math.cos(a), 0, h - r + r * math.sin(a)) for a in [math.pi * i / 8 for i in range(1, 8)]]
    pts += [(r, 0, h - r), (r, 0, 0)]
    polyligne(anse, pts, 0.008, 8, m)
    tube(corps, (-0.1, 0, 0), (0.1, 0, 0), 0.02, 14, m)
    tube(anse, (-0.112, 0, 0), (-0.098, 0, 0), 0.023, 14, m)
    tube(anse, (0.098, 0, 0), (0.112, 0, 0), 0.023, 14, m)


def noircir(o):
    """Le hollandais en noir : le vert du cadre de Meshy passe au noir laqué, le reste (cuir, chrome, pneus) ne bouge pas."""
    for mat in o.data.materials:
        t = mat.node_tree
        b = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
        for lien in t.links:
            if lien.to_socket == b.inputs["Base Color"] and lien.from_node.type == "TEX_IMAGE":
                img = lien.from_node.image
                px = np.array(img.pixels[:]).reshape(-1, 4)
                r, g, bl = px[:, 0], px[:, 1], px[:, 2]
                vert = (g > r * 1.08) & (g > bl * 1.02) & (g - np.minimum(r, bl) > 0.02)
                gris = 0.35 * (0.3 * r + 0.59 * g + 0.11 * bl)
                px[vert, 0] = px[vert, 1] = px[vert, 2] = gris[vert]
                img.pixels.foreach_set(px.astype(np.float32).ravel())
                img.pack()


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        print("usage : blender --background --factory-startup --python build-accessoires.py -- <dossier des GLB Meshy>")
        sys.exit(1)
    source = Path(args[0])
    repartir()
    for nom, p in PIECES.items():
        importer(nom, *p, source)
    abri(source)
    bpy.ops.object.select_all(action="SELECT")
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="WEBP", export_image_quality=82,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    print(f"ACCESSOIRES {SORTIE.stat().st_size // 1024} Kio -> {SORTIE.relative_to(ROOT)}")


main()
