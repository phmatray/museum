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

def pan(bambou, bois, x0, z0, x1, z1, haut, depart=0):
    """Un pan de kenninji-gaki de (x0, z0) à (x1, z1), au sol (cote 0)."""
    l = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / l, (z1 - z0) / l
    nx, nz = -uz, ux
    pt = lambda s, v: (x0 + ux * s + nx * v, z0 + uz * s + nz * v)
    # Les lattes : du bambou refendu, 7 cm, serrées, chacune sa teinte et un léger jeu.
    LATTE = 0.07
    n = int(l / LATTE)
    for i in range(n):
        s0, s1 = i * LATTE + 0.003, (i + 1) * LATTE - 0.003
        k = depart + i
        # Un bambou qui a vécu : blond passé, gris par endroits, quelques lattes encore vertes.
        t = 0.7 + 0.35 * hache(k)
        gris = hache(k, 4) < 0.3
        verdi = hache(k, 1) < 0.08
        c = (t * 0.82, t * 0.84, t * 0.8) if gris else (t * 0.85, t * 0.95, t * 0.62) if verdi else (t, t * 0.9, t * 0.72)
        # Une latte sur deux en avant : la palissade se lit à ses joints, pas comme un panneau.
        e = (0.022 if i % 2 else 0.008) + 0.006 * hache(k, 2)
        (ax, az), (bx, bz) = pt(s0, -e), pt(s1, e)
        bambou.boite(min(ax, bx), max(ax, bx), 0.04, haut - 0.03 + 0.02 * hache(k, 3), min(az, bz), max(az, bz), c)
    # Les lisses : trois paires de demi-bambous, de part et d'autre ; le chapeau, un bambou entier.
    for y in (0.32, 0.92, 1.5):
        for v in (-0.035, 0.035):
            a, b = pt(0, v), pt(l, v)
            bambou.cylindre((a[0], y, a[1]), (b[0], y, b[1]), 0.026, n=6, couleur=(0.78, 0.66, 0.42))
    a, b = pt(0, 0), pt(l, 0)
    bambou.cylindre((a[0], haut + 0.01, a[1]), (b[0], haut + 0.01, b[1]), 0.045, n=8, couleur=(0.72, 0.62, 0.4))
    # Les poteaux ronds, tous les 1,80 m, et les nœuds de corde noire aux lisses.
    m = max(1, round(l / 1.8))
    for j in range(m + 1):
        s = l * j / m
        x, z = pt(s, 0)
        bambou.cylindre((x, 0, z), (x, haut + 0.09, z), 0.05, n=8, couleur=(0.6, 0.5, 0.32))
        for y in (0.32, 0.92, 1.5):
            bois.boite(x - 0.05, x + 0.05, y - 0.03, y + 0.03, z - 0.05, z + 0.05)
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


def construire():
    mats = {
        "bois": matiere("Belvedere_Bois", (0.16, 0.085, 0.05), 0.72),
        "toit": matiere("Belvedere_Toit", (0.1, 0.1, 0.11), 0.55),
        "bambou": matiere("Belvedere_Bambou", (0.5, 0.42, 0.28), 0.62),
        "lueur": matiere("Belvedere_Lueur", (0.95, 0.88, 0.72), 0.6, emission=(1.0, 0.62, 0.3), force=3.0),
    }
    m = {k: Maillage() for k in mats}
    pavillon(m["bois"], m["toit"], m["lueur"])
    roji(m["bambou"], m["bois"], m["toit"])
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
