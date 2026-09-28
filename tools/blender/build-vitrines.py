"""
Les vitrines de la salle d'honneur, à la manière du musée Cernuschi, générées
par Blender en headless.

    blender --background --factory-startup --python tools/blender/build-vitrines.py

Produit `public/assets/architecture/vitrines.glb`, trois pièces instanciées une
fois par projet (`src/scene/VitrinesLayer.tsx`, placement dans
`src/plan/vitrines.ts`) :

- `Panneau` : le grand panneau de MDF peint en bordeaux, 4,20 × 3,60 m, fait de
  six plaques aux joints creux, posé contre le mur.
- `Cadre` : le cadre doré de la toile — un profil sculpté (listel, baguette,
  gorge, tore, doucine) balayé autour d'une vue de 1,36 × 0,68 m (l'image
  OpenGraph, 2 : 1), un rang de perles sur la baguette, une coquille à chaque
  angle et un cartouche au milieu de chaque grand côté.
- `Borne` : le pupitre laqué rouge, un pied à taille renflée et une tête
  inclinée dont le verre noir reçoit l'écran (dessiné par three, `ECRAN`).

Repère three (celui de l'export, +Y en haut) : x le long du mur, y la hauteur,
z la saillie vers le visiteur. Le panneau et la borne ont leur origine au sol,
au milieu ; le cadre au centre de sa vue, dos à z = 0. Les cotes suivent
`src/plan/vitrines.ts` (PANNEAU, TOILE, BORNE). Déterministe.
"""

import importlib.util
import math
import sys
from pathlib import Path

import bmesh
import bpy

ICI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("nef", ICI / "build-nef.py")
nef = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nef)
SORTIE = ICI.parents[1] / "public" / "assets" / "architecture" / "vitrines.glb"

# ── Les cotes, lues dans src/plan/vitrines.ts ─────────────────────────────
L, H, EP = 4.2, 3.6, 0.04            # PANNEAU
VUE_L, VUE_H, PROFIL = 1.36, 0.68, 0.16  # TOILE
# La tête de la borne : son dessus incliné, de l'arête avant à l'arête arrière.
AVANT = (0.23, 0.97)                 # (z, y)
ARRIERE = (-0.21, 1.19)
DEMI_BORNE = 0.29


def pt(x, y, z):
    """Un point du repère three dans celui de Blender (l'export repasse en +Y)."""
    return (x, -z, y)


def objet(nom, g, mats, lisse=math.radians(35), biseau=0.0):
    o = g.objet(nom, mats, lisse=lisse)
    if biseau:
        m = o.modifiers.new("biseau", "BEVEL")
        m.width = biseau
        m.segments = 2
        m.limit_method = "ANGLE"
        m.harden_normals = False
    return o


def joindre(nom, objets):
    """Une seule pièce par nom : three n'instancie qu'un maillage."""
    for o in objets:
        for m in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objets[0]
    if len(objets) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = nom
    o.data.name = nom
    return o


def boite(g, x0, x1, y0, y1, z0, z1, mat):
    g.boite(x0, x1, -z1, -z0, y0, y1, mat)


# ── Le panneau ────────────────────────────────────────────────────────────


def panneau(bordeaux, joint):
    """Six plaques de MDF sur un fond sombre : les joints creux se lisent comme au musée."""
    fond = nef.Maillage()
    boite(fond, -L / 2 + 0.004, L / 2 - 0.004, 0.004, H - 0.004, 0.0, EP - 0.012, joint)
    pieces = [objet("Panneau_Fond", fond, [joint])]
    us = (-L / 2, -L / 6, L / 6, L / 2)
    vs = (0.0, 2.44, H)
    g = 0.003  # demi-joint
    plaques = nef.Maillage()
    for i in range(3):
        for j in range(2):
            boite(plaques, us[i] + g, us[i + 1] - g, vs[j] + g, vs[j + 1] - g, 0.0, EP, bordeaux)
    pieces.append(objet("Panneau_Plaques", plaques, [bordeaux], biseau=0.004))
    return joindre("Panneau", pieces)


# ── Le cadre doré ─────────────────────────────────────────────────────────


def arc(cu, cv, r, a0, a1, n=6):
    return [(cu + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cv + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(1, n + 1)]


# Le profil : (s, z), s de l'arête de la vue vers le dehors, z la saillie.
PROFIL_CADRE = [
    (0.0, 0.0), (0.0, 0.026), (0.010, 0.028),                # le listel, contre la toile
    *arc(0.021, 0.028, 0.011, 180, 0, 6),                    # la baguette (ses perles viennent dessus)
    (0.036, 0.032), (0.042, 0.033), (0.049, 0.036), (0.055, 0.042), (0.059, 0.049), (0.062, 0.058),  # la gorge
    *arc(0.084, 0.058, 0.022, 180, 0, 10),                   # le tore
    (0.112, 0.052), (0.118, 0.050), (0.124, 0.046), (0.130, 0.040), (0.136, 0.036),  # la doucine
    (0.14, 0.030), (0.14, 0.0),
]
# Dessiné pour 14 cm ; élargi à PROFIL et creusé d'un tiers de plus : un cadre de salon, pas de bureau.
PROFIL_CADRE = [(s * PROFIL / 0.14, z * 1.35) for s, z in PROFIL_CADRE]


def balayage_cadre(g, profil, mat):
    """Le profil tourné autour de la vue, onglets à 45° : quatre anneaux, un par angle."""
    a, b = VUE_L / 2, VUE_H / 2
    angles = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    anneaux = [[pt(sx * (a + s), sy * (b + s), z) for s, z in profil] for sx, sy in angles]
    g.prisme(anneaux + [anneaux[0]], mat, fermer=False)


def perles(g, mat):
    """Un rang de perles sur la baguette, espacées de 3,4 cm."""
    a, b = VUE_L / 2 + 0.024, VUE_H / 2 + 0.024
    tour = 2 * (a + b) * 2
    n = int(tour / 0.034)
    for k in range(n):
        d = k * tour / n
        # Le point du rectangle à la distance d, depuis l'angle bas gauche.
        if d < 2 * a:
            x, y = -a + d, -b
        elif d < 2 * a + 2 * b:
            x, y = a, -b + (d - 2 * a)
        elif d < 4 * a + 2 * b:
            x, y = a - (d - 2 * a - 2 * b), b
        else:
            x, y = -a, b - (d - 4 * a - 2 * b)
        profil = [(0.0, -0.011), (0.009, -0.008), (0.012, 0.0), (0.009, 0.008), (0.0, 0.011)]
        anneaux = [[pt(x + r * math.cos(2 * math.pi * i / 8), y + r * math.sin(2 * math.pi * i / 8), 0.049 + h)
                    for i in range(8)] for r, h in profil]
        g.prisme(anneaux, mat)


def coquille(g, cx, cy, angle, taille, mat, z0=0.085):
    """
    Une coquille sculptée : un éventail de lobes cannelés, bombé, dont le talon
    s'enroule en bouton sur le tore ; l'éventail s'ouvre vers `angle` (0 = +y).
    """
    lobes = 7
    ouverture = (0.1 * math.pi, 0.9 * math.pi)
    c, s_ = math.cos(angle), math.sin(angle)

    def P(u, v, h):
        return pt(cx + u * c - v * s_, cy + u * s_ + v * c, z0 + h)

    nt, nr = 64, 9
    anneaux = []
    for j in range(nr + 1):
        f = j / nr
        rang = []
        for i in range(nt + 1):
            t = ouverture[0] + (ouverture[1] - ouverture[0]) * i / nt
            k = (t - ouverture[0]) / (ouverture[1] - ouverture[0]) * lobes
            bord = taille * (0.8 + 0.2 * abs(math.sin(math.pi * k)) ** 0.6)
            r = 0.12 * taille + (bord - 0.12 * taille) * f
            # Bombé au milieu, et cannelé : un creux entre deux lobes.
            h = taille * 0.34 * math.sqrt(max(0.0, 1 - f * f)) * (0.82 + 0.18 * abs(math.sin(math.pi * k)))
            rang.append(P(r * math.cos(t), r * math.sin(t) - 0.25 * taille, h + 0.004))
        anneaux.append(rang)
    # Le dessous, à plat sur le cadre : on referme l'éventail.
    anneaux.append([P(0.0, -0.25 * taille, 0.0)] * (nt + 1))
    for j in range(len(anneaux) - 1):
        for i in range(nt):
            a, b = anneaux[j], anneaux[j + 1]
            g.quad([a[i], a[i + 1], b[i + 1], b[i]], mat)
    # Le talon : un bouton roulé en volute, sur l'axe.
    bouton = [(0.0, 0.0), (0.16 * taille, 0.01), (0.2 * taille, 0.05 * taille + 0.02), (0.12 * taille, 0.34 * taille), (0.0, 0.38 * taille)]
    anneaux_b = [[P(r * math.cos(2 * math.pi * i / 12), r * math.sin(2 * math.pi * i / 12) - 0.25 * taille, h) for i in range(12)] for r, h in bouton]
    g.prisme(anneaux_b, mat)


def cadre(or_):
    g = nef.Maillage()
    balayage_cadre(g, PROFIL_CADRE, or_)
    perles(g, or_)
    a, b = VUE_L / 2 + 0.1, VUE_H / 2 + 0.1
    # Une coquille par angle, l'éventail vers le dehors, et un cartouche au milieu de chaque côté.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        coquille(g, sx * a, sy * b, math.atan2(-sx, sy), 0.13, or_)
    for sy in (-1, 1):
        coquille(g, 0.0, sy * b, math.atan2(0, sy), 0.1, or_)
    for sx in (-1, 1):
        coquille(g, sx * a, 0.0, math.atan2(-sx, 0), 0.075, or_)
    return objet("Cadre", g, [or_])


# ── La borne ──────────────────────────────────────────────────────────────


def rect_rond(w, d, r, n=4):
    """Un rectangle aux angles arrondis, (x, z), dans le sens trigonométrique."""
    pts = []
    for cx, cz, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def borne(laque, ecran):
    g = nef.Maillage()
    # Le socle, puis le pied à taille renflée : une suite de sections arrondies.
    profil = [(0.0, 0.25, 0.2), (0.035, 0.25, 0.2), (0.045, 0.2, 0.15)]
    profil += [(0.06 + 0.72 * k / 12, 0.17 - 0.025 * math.sin(math.pi * k / 12), 0.12 - 0.02 * math.sin(math.pi * k / 12)) for k in range(13)]
    profil += [(0.80, 0.2, 0.15), (0.83, 0.23, 0.18)]
    anneaux = [[pt(x, y, z) for x, z in rect_rond(2 * a, 2 * b, min(a, b) * 0.45)] for y, a, b in profil]
    g.prisme(anneaux, laque)
    # La tête : un prisme sur le profil de côté, arêtes adoucies par le biseau.
    cote = [(-0.2, 0.83), (0.19, 0.83), AVANT, (AVANT[0] - 0.01, AVANT[1] + 0.012), ARRIERE, (ARRIERE[0], ARRIERE[1] - 0.12)]
    anneaux = [[pt(x, y, z) for z, y in cote] for x in (-DEMI_BORNE, DEMI_BORNE)]
    tete = nef.Maillage()
    tete.prisme(anneaux, laque)
    pieces = [objet("Borne_Pied", g, [laque]), objet("Borne_Tete", tete, [laque], biseau=0.018)]
    # Le verre noir de l'écran, à fleur du dessus incliné.
    (za, ya), (zb, yb) = (AVANT[0] - 0.01, AVANT[1] + 0.012), ARRIERE
    long_ = math.hypot(za - zb, yb - ya)
    t = ((zb - za) / long_, (yb - ya) / long_)   # le long du dessus, de l'avant vers l'arrière
    nrm = (t[1], -t[0])                          # la normale, vers le haut et l'avant
    nrm = (-nrm[0], -nrm[1]) if nrm[1] < 0 else nrm
    cz, cy = (za + zb) / 2, (ya + yb) / 2
    w, h = 0.25, 0.17
    verre = nef.Maillage()
    coins = [(-w, -h), (w, -h), (w, h), (-w, h)]
    verre.quad([pt(u, cy + t[1] * v + nrm[1] * 0.002, cz + t[0] * v + nrm[0] * 0.002) for u, v in coins], ecran)
    pieces.append(objet("Borne_Verre", verre, [ecran]))
    print(f"écran : centre z={cz:.4f} y={cy:.4f}, inclinaison {math.degrees(math.atan2(yb - ya, za - zb)):.2f}°")
    return joindre("Borne", pieces)


def construire():
    nef.repartir()
    for c in list(bpy.data.curves):
        bpy.data.curves.remove(c)
    bordeaux = nef.matiere("Vitrine_Bordeaux", (0.20, 0.016, 0.018), 0.82)
    joint = nef.matiere("Vitrine_Joint", (0.035, 0.004, 0.005), 0.9)
    laque = nef.matiere("Vitrine_Laque", (0.24, 0.02, 0.022), 0.38)
    or_ = nef.matiere("Vitrine_Or", (0.80, 0.56, 0.22), 0.3, metallique=1.0)
    ecran = nef.matiere("Vitrine_Ecran", (0.008, 0.008, 0.01), 0.08)
    panneau(bordeaux, joint)
    cadre(or_)
    borne(laque, ecran)
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.shade_smooth()
            o.data.set_sharp_from_angle(angle=math.radians(40))


def exporter():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(SORTIE), export_format="GLB", export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"vitrines : {SORTIE} ({SORTIE.stat().st_size // 1024} Kio, {tris} triangles)")


if __name__ == "__main__":
    construire()
    if "--no-export" not in sys.argv:
        exporter()
