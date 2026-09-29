"""
Bavette, vivant : maillage allégé, squelette de quadrupède et trois boucles.

    blender --background --python tools/blender/build-bavette-anime.py -- \
        "/chemin/vers/Bavette Meshy profil.glb"

Produit `public/assets/sculptures/bavette-anime.glb` : un maillage skinné et ses
actions `Marche`, `Repos`, `Sasseoir` et `Assis`, et celles de la sieste sur un
banc — `Saut`, `Enroule`, `Dort`, `Reveil`, `Descente` —, lues par
`src/scene/BavetteLayer.tsx`.

── Pourquoi une AUTRE source que `bavette.glb` ──

La pièce exposée sur son socle venait d'une photo de Bavette tête tournée
par-dessus l'épaule, corps en diagonale. Belle pour une statue, inanimable :
un cou vrillé de 90° ne se déplie pas proprement sous des poids automatiques.
La source de ce script est la MÊME photo, redessinée de profil strict par Meshy
(image-to-image, `nano-banana-pro`), puis remontée en volume (image-to-3D) —
même robe tabby et blanche, tête dans l'axe, queue détachée des pattes.

── Ce que le script GARANTIT, et dont `BavetteLayer.tsx` dépend ──

  1. l'échelle est RÉELLE (GARROT, mesuré sur Bavette) ;
  2. l'origine est AU SOL, centrée entre les pattes avant et arrière, et le
     chat regarde +Z après l'export (−Y de Blender) ;
  3. `Marche` fait avancer les pattes à VITESSE m/s sans glisser : c'est la
     vitesse à laquelle la marche doit jouer à `timeScale = 1` ;
  4. les os `Tete` et `Cou` existent — la couche les tourne vers le visiteur ;
  5. les actions de la sieste ont le déplacement du saut CUIT (SAUT_H, SAUT_D,
     BORD, SAUT_VOL, DESCENTE_VOL et leurs durées sont recopiés dans
     `src/plan/promenade.ts`, objet SIESTE).

── Méthode ──

Les pattes sont animées par IK (cibles au poignet et au jarret), puis CUITES en
rotations simples (`nla.bake`, clés visuelles) : glTF ne connaît pas les
contraintes. Le poser des coussinets est ainsi exact — pendant l'appui, la
cible recule à VITESSE, donc la patte ne patine pas ; `BAVETTE_IK` mesure, à
chaque construction, de combien une patte manque sa cible (trop courte).
La queue, elle, est pointée os par os dans des directions du monde (`queue`),
et `au_sol` l'empêche de passer sous le plancher.

Sans aléa ni horloge. Pas au bit près pour autant : le remaillage voxel et la
chaleur des poids automatiques sont multithreadés, deux passes diffèrent de
quelques ulp — invisible, mais le SHA du GLB change à chaque reconstruction.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
SORTIE = ROOT / "public" / "assets" / "sculptures" / "bavette-anime.glb"

TRIANGLES = 18_000
TEXTURES = 1024
FPS = 30

# Les mesures de Bavette, prises par Philippe : 30 cm au garrot, 45 à 50 cm
# du museau à la base de la queue, une queue de 20 à 30 cm, 4 kg — un chat
# trapu. La source Meshy est normalisée : z ∈ [−0,5 ; 0,5], museau vers −Y ;
# son garrot culmine à z = 0,332 (coupe y ∈ [−0,47 ; −0,39]), son museau est à
# y = −0,936, la base de la queue à y = +0,36. L'échelle se prend au GARROT —
# la tête, portée bas, ne dépasse le dos que de 6 cm : les oreilles montent à
# 0,36 m, le corps fait 0,47 m, la queue 0,25 m (mesurés à chaque
# construction, voir `BAVETTE_MESURES`).
GARROT = 0.30           # m
Z_GARROT = 0.332        # sur la source
# Y0 : milieu entre coussinets avant (−0,475) et arrière (+0,21).
Y0 = -0.13
K = GARROT / (Z_GARROT + 0.5)
# Allongé : à l'échelle du garrot, la source ne fait que 47 cm du museau à la
# queue et, élargie de 10 %, Bavette avait l'air d'une pomme de terre
# (Philippe). Tout ce qui court le long du corps — maillage ET squelette — est
# étiré d'autant : 50 cm, le haut de ses mesures. Assis, le bassin bascule
# moins (`assise`) : un dos plus long lèverait les épaules hors de portée des
# pattes avant.
ALLONGE = 1.08
KY = K * ALLONGE
# Le tronc garde sa largeur ; le ventre, lui, descend entre les pattes (voir
# `etoffer`), sans toucher aux pattes, à la tête ni à la queue. Bavette était
# « haut sur pattes » à côté de la vidéo : ses pattes n'étaient pas trop
# longues — le garrot mesure bien 30 cm — mais son tronc trop mince. Baisser
# le corps en pliant davantage les pattes les cassait en Z (le genou est déjà
# à ~80° en appui, le tibia du modèle est court) ; un ventre plus profond
# raccourcit la patte visible sans rien plier.
LARGEUR = 1.0
VENTRE = 0.06           # unités source (≈ 2,2 cm) au milieu du ventre


def P(x, y, z):
    """Un point relevé sur la source (unités Meshy) → mètres, origine au sol."""
    return Vector((x * K, (y - Y0) * KY, (z + 0.5) * K))


# ── Le squelette, relevé en coupes sur la source (voir SOURCES.md) ─────────
# (nom, parent, tête, queue). G = côté gauche du chat = +X (il regarde −Y).
def os_du_chat():
    os_ = [
        ("Bassin", None, (0, 0.34, 0.19), (0, 0.08, 0.21)),
        ("Dos", "Bassin", (0, 0.08, 0.21), (0, -0.18, 0.22)),
        ("Poitrine", "Dos", (0, -0.18, 0.22), (0, -0.42, 0.19)),
        ("Cou", "Poitrine", (0, -0.42, 0.19), (0, -0.63, 0.30)),
        ("Tete", "Cou", (0, -0.63, 0.30), (0, -0.90, 0.29)),
    ]
    queue = [(0, 0.36, 0.20), (0, 0.46, 0.12), (0, 0.56, 0.035), (0, 0.66, -0.005),
             (0, 0.76, -0.012), (0, 0.86, 0.05), (0, 0.96, 0.12)]
    for i in range(6):
        os_.append((f"Queue{i + 1}", "Bassin" if i == 0 else f"Queue{i}", queue[i], queue[i + 1]))
    for c, s in (("G", 1), ("D", -1)):
        os_ += [
            (f"Bras_{c}", "Poitrine", (s * 0.09, -0.42, 0.12), (s * 0.085, -0.37, -0.15)),
            (f"AvantBras_{c}", f"Bras_{c}", (s * 0.085, -0.37, -0.15), (s * 0.08, -0.43, -0.42)),
            (f"Main_{c}", f"AvantBras_{c}", (s * 0.08, -0.43, -0.42), (s * 0.08, -0.50, -0.48)),
            (f"Cuisse_{c}", "Bassin", (s * 0.10, 0.26, 0.12), (s * 0.10, 0.14, -0.13)),
            (f"Jambe_{c}", f"Cuisse_{c}", (s * 0.10, 0.14, -0.13), (s * 0.10, 0.30, -0.31)),
            (f"Pied_{c}", f"Jambe_{c}", (s * 0.10, 0.30, -0.31), (s * 0.10, 0.22, -0.46)),
            (f"Orteils_{c}", f"Pied_{c}", (s * 0.10, 0.22, -0.46), (s * 0.10, 0.16, -0.485)),
        ]
    return os_


# ── La marche, relevée sur une vidéo de Bavette (profil, sur l'herbe) ──
# 60 images/s, suivie image par image sur ~15 s de marche droite :
#   cycle : un antérieur tend la patte loin devant toutes les 27 images en
#     moyenne (0,45 s), en alternance gauche/droite → PERIODE ≈ 0,9 à 1,0 s ;
#   vitesse : 0,41 à 0,45 m/s (déplacement sur l'herbe, caméra compensée,
#     échelle prise sur la longueur museau–base de la queue = 0,47 m) ;
#   foulée : ≈ 0,40 m, presque une longueur de corps — des pas longs et lents ;
#   ordre : pas latéral, PG · AG · PD · AD, une pose tous les ~¼ de cycle ;
#   vol : ~0,27 à l'antérieur (qui se replie haut, poignet cassé, puis se
#     tend loin devant et se pose presque tendu).
# Le postérieur, lui, vole 0,45 cycle et non 0,20 comme on l'avait cru : avec
# un vol si bref, l'appui devait couvrir 32 cm, la patte finissait loin
# derrière la hanche, tendue et raide, et la peau du ventre s'y déchirait. Un
# chat pose le pied sous le ventre et le décolle à peine derrière la hanche
# (appui de 22 cm, avancé de APPUI), jarret haut. L'antérieur décolle alors
# juste avant que le postérieur ne se pose dans sa trace.
# D'où, pour chaque patte : (côté, avant ?, décollage dans le cycle, durée du vol).
PATTES = [
    ("G", False, 0.00, 0.45), ("G", True, 0.38, 0.27),
    ("D", False, 0.50, 0.45), ("D", True, 0.88, 0.27),
]
PERIODE = 28 / FPS      # s ≈ 0,93
FOULEE = 0.40           # m, un cycle
VITESSE = FOULEE / PERIODE   # ≈ 0,43 m/s à timeScale 1
# Les proportions de la marche, mesurées sur la vidéo (repères posés à la main
# sur 6 images de profil, sol redressé de 6°) contre ce modèle, en rapport à la
# hauteur au garrot H : museau–base de queue 1,75 H, poitrail 0,60 H, ventre à
# 0,40 H du sol, oreille 0,18 H au-dessus du garrot. Il marchait accroupi
# (garrot à 25 cm au lieu de 30, museau–queue 2,0 H, tête sous le dos) : un
# chat à l'affût, pas le chat de la vidéo, qui marche haut, la tête portée.
FLEXION = 0.012         # m : le garrot reste à ~29 cm en marche (30 debout)
# Le cou se redresse (−10° au lieu de 18° vers le bas) et s'allonge un peu,
# comme tendu en avant ; la tête pique du nez pour garder le regard devant.
COU_MARCHE = -10
COU_ETIRE = 1.15
TETE_MARCHE = 30
LEVER = {True: 0.065, False: 0.035}
APPUI = {True: 0.0, False: -0.018}   # m : milieu de l'appui avancé (−Y) sous le ventre
OMOPLATE = 0.10         # m : course avant–arrière de l'épaule — plus haut sur pattes, c'est
                        # elle qui laisse l'antérieur atteindre sa pose loin devant
# La queue, en angle absolu sous l'horizontale, de la base à la pointe : basse,
# en courbe douce, la pointe à hauteur de jarret (vidéo : ~45° sous le sol redressé).
QUEUE_MARCHE = (-40, -48, -48, -44, -36, -28)
QUEUE_REPOS = (-24, -38, -46, -46, -36, -18)


def triangles(obj):
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def importer(source: Path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    objets = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(objets) != 1:
        print(f"BAVETTE_SOURCE {len(objets)} maillages, un seul attendu")
        sys.exit(1)
    corps = objets[0]
    corps.name = "Bavette"
    # Les sommets arrivent éclatés aux coutures d'UV (6 481 îlots) : la chaleur
    # des poids automatiques ne se propage pas d'un îlot à l'autre. Les UV
    # restent par coin de face, la fusion ne les touche pas.
    bpy.context.view_layer.objects.active = corps
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    depart = triangles(corps)
    mod = corps.modifiers.new(name="Allegement", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = TRIANGLES / depart
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Échelle et ancrage FIXES, relevés sur la source : le squelette est
    # exprimé dans le même repère.
    m = Matrix.Diagonal((K, KY, K, 1)) @ Matrix.Translation((0, -Y0, 0.5)) @ corps.matrix_world
    corps.data.transform(m)
    corps.matrix_world = Matrix.Identity(4)
    etoffer(corps)
    print(f"BAVETTE_TRI {depart} -> {triangles(corps)}")
    for img in bpy.data.images:
        if max(img.size) > TEXTURES:
            f = TEXTURES / max(img.size)
            img.scale(int(img.size[0] * f), int(img.size[1] * f))
    robe(corps)
    return corps


def blanc_attendu(x, y, z):
    """
    Part de blanc de la robe au point (x, y, z) de la source, d'après les
    vidéos et les photos : il est surtout BLANC — cou et nuque, poitrail,
    ventre, pattes, museau et liseré entre les yeux, une tache au milieu du
    flanc et une autre sur la croupe. Le tabby ne garde que la calotte, la
    selle des épaules, la hanche, la ligne du dos et la queue.
    """
    def bosse(u, a, b, bord):
        return lisse((u - a) / bord) * lisse((b - u) / bord)
    cou = bosse(y, -0.68, -0.50, 0.05) * lisse((0.36 - z) / 0.04)
    flanc = bosse(y, -0.20, 0.06, 0.05) * bosse(z, -0.05, 0.20, 0.05)
    croupe = bosse(y, 0.24, 0.36, 0.04) * bosse(z, 0.06, 0.22, 0.04)
    dessous = lisse((0.0 - z) / 0.08) * (y > -0.84)
    museau = lisse((-0.80 - y) / 0.05) * lisse((0.26 - z) / 0.05)
    liste = lisse((0.03 - abs(x)) / 0.02) * lisse((-0.78 - y) / 0.04) * lisse((0.36 - z) / 0.04)
    queue = lisse((y - 0.36) / 0.02)
    return max(cou, flanc, croupe, dessous, museau, liste) * (1 - queue)


def robe(corps):
    """
    Recolore la texture de base, sans aléa : le blanc gris de la source est
    rehaussé et les zones `blanc_attendu` virent au blanc, en gardant le grain
    du poil (la luminance de la source module ce blanc). Cuit par Cycles dans
    une nouvelle image aux MÊMES UV : rien d'autre ne change dans le glTF.
    """
    mat = corps.material_slots[0].material
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = bsdf.inputs["Base Color"].links[0].from_node
    attr = corps.data.color_attributes.new("robe", "FLOAT_COLOR", "POINT")
    for v in corps.data.vertices:
        w = blanc_attendu(v.co.x / K, v.co.y / KY + Y0, v.co.z / K - 0.5)
        attr.data[v.index].color = (w, w, w, 1)
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "robe"
    # Luminance de la source → blanc de poil (0,80 à 0,96) ; saturée (truffe
    # rose, yeux), elle garde sa couleur.
    hsv = nt.nodes.new("ShaderNodeSeparateColor")
    hsv.mode = "HSV"
    nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
    poil = nt.nodes.new("ShaderNodeMapRange")
    poil.inputs["From Min"].default_value, poil.inputs["From Max"].default_value = 0.1, 0.9
    poil.inputs["To Min"].default_value, poil.inputs["To Max"].default_value = 0.80, 0.96
    nt.links.new(hsv.outputs["Blue"], poil.inputs["Value"])
    blanc = nt.nodes.new("ShaderNodeCombineColor")
    for i, k in enumerate((1.0, 0.985, 0.955)):
        m = nt.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY"
        m.inputs[1].default_value = k
        nt.links.new(poil.outputs["Result"], m.inputs[0])
        nt.links.new(m.outputs[0], blanc.inputs[i])
    # Les gris clairs de la source (V > 0,55, peu saturés) sont déjà du blanc :
    # on les rehausse partout, et on force la zone blanche attendue.
    clair = nt.nodes.new("ShaderNodeMapRange")
    clair.inputs["From Min"].default_value, clair.inputs["From Max"].default_value = 0.50, 0.70
    nt.links.new(hsv.outputs["Blue"], clair.inputs["Value"])
    fac = nt.nodes.new("ShaderNodeMath")
    fac.operation = "MAXIMUM"
    nt.links.new(clair.outputs["Result"], fac.inputs[0])
    nt.links.new(ca.outputs["Color"], fac.inputs[1])
    terne = nt.nodes.new("ShaderNodeMapRange")          # 1 si peu saturé, 0 si saturé
    terne.inputs["From Min"].default_value, terne.inputs["From Max"].default_value = 0.35, 0.18
    nt.links.new(hsv.outputs["Green"], terne.inputs["Value"])
    f2 = nt.nodes.new("ShaderNodeMath")
    f2.operation = "MULTIPLY"
    f2.use_clamp = True
    nt.links.new(fac.outputs[0], f2.inputs[0])
    nt.links.new(terne.outputs["Result"], f2.inputs[1])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(f2.outputs[0], mix.inputs["Factor"])
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    nt.links.new(blanc.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    cuite = bpy.data.images.new("Robe", tex.image.size[0], tex.image.size[1])
    cible = nt.nodes.new("ShaderNodeTexImage")
    cible.image = cuite
    nt.nodes.active = cible
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.cycles.device = "CPU"
    bpy.ops.object.select_all(action="DESELECT")
    corps.select_set(True)
    bpy.context.view_layer.objects.active = corps
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=4, use_clear=True)
    # La nouvelle image remplace l'ancienne ; les nœuds de calcul disparaissent.
    tex.image = cuite
    for n in (ca, hsv, poil, blanc, clair, fac, terne, f2, mix, cible) + tuple(
            l.from_node for l in blanc.inputs[0].links + blanc.inputs[1].links + blanc.inputs[2].links):
        if n.name in nt.nodes:
            nt.nodes.remove(n)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    corps.data.color_attributes.remove(corps.data.color_attributes["robe"])
    cuite.pack()


def cloche(u, a, b):
    """1 au milieu de [a, b], 0 aux bords, en cosinus."""
    if not a < u < b:
        return 0.0
    return 0.5 - 0.5 * math.cos(2 * math.pi * (u - a) / (b - a))


def etoffer(corps):
    """
    Un chat de 4 kg : le tronc s'élargit de LARGEUR et le ventre descend de
    VENTRE entre les pattes. En coordonnées de la source, pour garder les
    coupes relevées ; les pattes (sous z = −0,2) et la tête ne bougent pas.
    Mesure ensuite ce que le script promet : garrot, longueur, oreilles.
    """
    for v in corps.data.vertices:
        y, z = v.co.y / KY + Y0, v.co.z / K - 0.5
        tronc = cloche(y, -0.70, 0.42) ** 0.5 * max(0.0, min(1.0, (z + 0.22) / 0.12))
        v.co.x *= 1 + (LARGEUR - 1) * tronc
        ventre = cloche(y, -0.36, 0.14) * max(0.0, min(1.0, (0.20 - z) / 0.30)) * lisse((z + 0.26) / 0.06)
        v.co.z -= VENTRE * K * ventre
    vs = [v.co for v in corps.data.vertices]
    garrot = max(c.z for c in vs if -0.47 <= c.y / KY + Y0 <= -0.39)
    museau = min(c.y for c in vs)
    queue = (0.36 - Y0) * KY
    print(f"BAVETTE_MESURES garrot {garrot:.3f} m · oreilles {max(c.z for c in vs):.3f} m · "
          f"museau–queue {queue - museau:.3f} m · largeur {2 * max(c.x for c in vs):.3f} m")


def roll_lateral(eb):
    """L'axe X local de chaque os = +X du monde : plier = tourner autour de X."""
    d = (eb.tail - eb.head).normalized()
    eb.align_roll(d.cross(Vector((-1, 0, 0))))


def squelette(corps):
    donnees = bpy.data.armatures.new("Squelette")
    arm = bpy.data.objects.new("Squelette", donnees)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = donnees.edit_bones
    for nom, parent, t, q in os_du_chat():
        b = eb.new(nom)
        b.head, b.tail = P(*t), P(*q)
        roll_lateral(b)
        if parent:
            b.parent = eb[parent]
            b.use_connect = (b.head - eb[parent].tail).length < 1e-6
    # Les contrôleurs d'IK : sans parent, au poignet / au jarret, orientés
    # comme la main / le pied. Non déformants : ils ne s'exportent pas.
    for c in ("G", "D"):
        for cible, modele in ((f"CtrlMain_{c}", f"Main_{c}"), (f"CtrlPied_{c}", f"Pied_{c}")):
            b = eb.new(cible)
            b.head, b.tail, b.roll = eb[modele].head, eb[modele].tail, eb[modele].roll
            b.use_deform = False
        for pole, genou, sens in ((f"PoleBras_{c}", f"Bras_{c}", 1), (f"PoleCuisse_{c}", f"Cuisse_{c}", -1)):
            # Le coude plie vers l'arrière (+Y), le genou vers l'avant (−Y) — et
            # vers le BAS : pied replié sous la hanche, un pôle à hauteur du
            # genou le faisait monter dans le flanc, au-dessus de la hanche.
            b = eb.new(pole)
            b.head = eb[genou].tail + Vector((0, sens * 0.25, 0 if sens > 0 else -0.15))
            b.tail = b.head + Vector((0, 0, 0.03))
            b.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")

    ponderer(corps, arm)
    nettoyer_poids(corps, arm)
    oreilles(corps, arm)
    paupieres(corps, arm)

    # Les contraintes : IK à deux os, la main et le pied copient leur contrôleur.
    pose = arm.pose.bones
    for c in ("G", "D"):
        for fin, ctrl, pole, rot in ((f"AvantBras_{c}", f"CtrlMain_{c}", f"PoleBras_{c}", f"Main_{c}"),
                                     (f"Jambe_{c}", f"CtrlPied_{c}", f"PoleCuisse_{c}", f"Pied_{c}")):
            ik = pose[fin].constraints.new("IK")
            ik.target, ik.subtarget = arm, ctrl
            ik.pole_target, ik.pole_subtarget = arm, pole
            ik.chain_count = 2
            ik.use_tail = True
            ik.pole_angle = meilleur_pole(arm, fin, ik)
            cr = pose[rot].constraints.new("COPY_ROTATION")
            cr.target, cr.subtarget = arm, ctrl
    return arm


# Les oreilles, relevées sur le maillage : elles ne dépassent le crâne (z = 0,343)
# que de 1,5 cm, de |x| = 0,035 à 0,058, vers y = −0,26. Un os chacune, qui
# ne sert qu'au sommeil : une oreille frémit. Au repos, il ne bouge rien.
OREILLE = (Vector((0.044, -0.262, 0.334)), Vector((0.050, -0.268, 0.362)))


def oreilles(corps, arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for c, s in (("G", 1), ("D", -1)):
        b = eb.new(f"Oreille_{c}")
        b.head = Vector((s * OREILLE[0].x, OREILLE[0].y, OREILLE[0].z))
        b.tail = Vector((s * OREILLE[1].x, OREILLE[1].y, OREILLE[1].z))
        roll_lateral(b)
        b.parent = eb["Tete"]
    bpy.ops.object.mode_set(mode="OBJECT")
    groupes = {c: corps.vertex_groups.new(name=f"Oreille_{c}") for c in ("G", "D")}
    idx = {g.name: g.index for g in corps.vertex_groups}
    n = 0
    for v in corps.data.vertices:
        x, y, z = v.co
        w = lisse((z - 0.330) / 0.014) * lisse((abs(x) - 0.024) / 0.012) * lisse((y + 0.300) / 0.015) * lisse((-0.232 - y) / 0.015)
        if w <= 0:
            continue
        n += 1
        c = "G" if x > 0 else "D"
        # Ce que l'oreille prend, les autres os le cèdent en proportion.
        for g in v.groups:
            if g.group != idx[f"Oreille_{c}"]:
                g.weight *= 1 - w
        groupes[c].add([v.index], w, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    corps.select_set(True)
    bpy.context.view_layer.objects.active = corps
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    print(f"BAVETTE_OREILLES {n} sommets")


# Les paupières. Les yeux sont PEINTS sur la texture (relevés de face : 1,4 ×
# 1 cm, à x = ±0,0225, z = 0,294) : pour qu'il dorme les yeux fermés, une
# amande se pose sur chacun, habillée de la robe prise 11 mm plus haut — les
# rayures du front continuent dessus —, et barrée au tiers bas d'un trait
# sombre, pris dans la pupille : la fente d'un œil clos. Chacune pend à un os
# `Paupiere_*`, réduit à rien hors du sommeil (`remettre`).
OEIL = (0.0225, 0.294)
PAUPIERE = (0.0074, 0.0052, 0.0010)     # demi-largeur, demi-hauteur, bombé (m)
FENTE = (0.0070, 0.0006, 0.0013)
FERMEE = 1.0
OUVERTE = 0.01


def paupieres(corps, arm):
    import bmesh
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    uv_corps = corps.data.uv_layers.active.name
    me = corps.data
    uvs = me.uv_layers.active.data
    # Les indices de faces de `Object.ray_cast` sont ceux du maillage évalué : un arbre sur les polygones d'origine.
    arbre = BVHTree.FromPolygons([v.co for v in me.vertices], [tuple(f.vertices) for f in me.polygons])

    image = next(n for n in corps.material_slots[0].material.node_tree.nodes if n.type == "TEX_IMAGE").image
    largeur, hauteur = image.size
    pixels = image.pixels[:]

    def texel(uv):
        x, y = int(uv.x % 1 * (largeur - 1)), int(uv.y % 1 * (hauteur - 1))
        i = (y * largeur + x) * 4
        return Vector(pixels[i:i + 3])

    def toucher(x, z):
        """Le point de la face en (x, z) vu de devant, sa normale, et l'UV interpolé en ce point."""
        p, n, i, _ = arbre.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
        poly = me.polygons[i]
        poids = poly_3d_calc([me.vertices[v].co for v in poly.vertices], p)
        uv = sum((uvs[li].uv * w for li, w in zip(poly.loop_indices, poids)), Vector((0, 0)))
        return p, n, uv

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    poses = {}
    for c, s in (("G", 1), ("D", -1)):
        p, n, _ = toucher(s * OEIL[0], OEIL[1])
        b = arm.data.edit_bones.new(f"Paupiere_{c}")
        b.head, b.tail = p, p + n * 0.01
        b.parent = arm.data.edit_bones["Tete"]
        poses[c] = (p, n, s)
    bpy.ops.object.mode_set(mode="OBJECT")

    def amande(p, n, t, b_, taille, decale, uv_de, courbe=0.0):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1.0)
        for v in bm.verts:
            x, y, z = v.co
            v.co = p + b_ * (decale + courbe * x * x) + n * (0.0008 + taille[2] * max(z, -0.2)) + t * (taille[0] * x) + b_ * (taille[1] * y)
        couche = bm.loops.layers.uv.new(uv_corps)
        for f in bm.faces:
            for loop in f.loops:
                loop[couche].uv = uv_de(loop.vert.co)
        return bm

    objets = []
    for c, (p, n, s) in poses.items():
        # Repère de l'œil : n dehors, t à l'horizontale, b vers le haut ; le coin externe relevé de 12°.
        t = Vector((1, 0, 0)) - n * n.x
        t.normalize()
        b_ = n.cross(t)
        inclin = math.radians(12) * s
        t, b_ = t * math.cos(inclin) + b_ * math.sin(inclin), b_ * math.cos(inclin) - t * math.sin(inclin)
        # La robe au-dessus de l'œil : parmi quelques points, celui dont la teinte est la plus proche de
        # leur moyenne. Un seul texel — la texture de Meshy est un puzzle d'îlots, l'interpoler en brouille.
        pris = [toucher(p.x + dx * 0.003, p.z + 0.009 + dz * 0.0025)[2] for dx in range(-2, 3) for dz in range(3)]
        teintes = [texel(uv) for uv in pris]
        moyenne = sum(teintes, Vector((0, 0, 0))) / len(teintes)
        poil = min(zip(pris, teintes), key=lambda pt: (pt[1] - moyenne).length)[0]
        pupille = toucher(p.x, p.z)[2]
        morceaux = [
            amande(p, n, t, b_, PAUPIERE, 0.0, lambda q: poil),
            amande(p, n, t, b_, FENTE, -0.0019, lambda q: pupille, courbe=0.0016),
        ]
        lid = bpy.data.meshes.new(f"Paupiere_{c}")
        bm = morceaux[0]
        tmp = bpy.data.meshes.new("tmp")
        morceaux[1].to_mesh(tmp)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        bm.to_mesh(lid)
        bm.free()
        morceaux[1].free()
        obj = bpy.data.objects.new(f"Paupiere_{c}", lid)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(corps.material_slots[0].material)
        g = obj.vertex_groups.new(name=f"Paupiere_{c}")
        g.add(list(range(len(lid.vertices))), 1.0, "REPLACE")
        objets.append(obj)
    # Joindre à la fin : la jointure invalide les UV du maillage lues plus haut.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objets:
        obj.select_set(True)
    corps.select_set(True)
    bpy.context.view_layer.objects.active = corps
    bpy.ops.object.join()
    print(f"BAVETTE_PAUPIERES {', '.join(f'{c} ({p.x:+.4f}, {p.y:.4f}, {p.z:.4f})' for c, (p, *_ ) in poses.items())}")


def ponderer(corps, arm):
    """
    Les poids automatiques, calculés sur un DOUBLURE étanche puis reportés.

    Le maillage Meshy est une soupe : îlots par coutures, faces qui se
    recoupent, moustaches flottantes. La chaleur de Blender y échoue (« failed
    to find solution ») et laisse 9 000 sommets sur 9 500 sans poids. Un
    remaillage voxel du même volume, lui, est fermé et propre : la chaleur y
    diffuse, et un transfert au plus proche rend ses poids au vrai maillage.
    """
    bpy.ops.object.select_all(action="DESELECT")
    doublure = corps.copy()
    doublure.data = corps.data.copy()
    doublure.name = "Doublure"
    bpy.context.scene.collection.objects.link(doublure)
    bpy.context.view_layer.objects.active = doublure
    rm = doublure.modifiers.new("Voxel", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.0035
    bpy.ops.object.modifier_apply(modifier=rm.name)
    dec = doublure.modifiers.new("Allegement", "DECIMATE")
    dec.ratio = min(1.0, 40_000 / max(1, triangles(doublure)))
    bpy.ops.object.modifier_apply(modifier=dec.name)

    doublure.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # Le vrai maillage : mêmes groupes, poids interpolés de la face la plus proche.
    bpy.ops.object.select_all(action="DESELECT")
    for b in arm.data.bones:
        if b.use_deform:
            corps.vertex_groups.new(name=b.name)
    bpy.context.view_layer.objects.active = corps
    dt = corps.modifiers.new("Report", "DATA_TRANSFER")
    dt.object = doublure
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(doublure)

    mod = corps.modifiers.new("Squelette", "ARMATURE")
    mod.object = arm
    corps.parent = arm


def meilleur_pole(arm, fin, ik):
    """L'angle de pôle qui laisse la patte au repos EXACTEMENT comme modelée."""
    pb = arm.pose.bones[fin]
    repos = arm.data.bones[fin].matrix_local.to_translation()
    meilleur, ecart = 0.0, 1e9
    for deg in range(-180, 180, 5):
        ik.pole_angle = math.radians(deg)
        bpy.context.view_layer.update()
        e = (pb.matrix.to_translation() - repos).length + (pb.parent.matrix.to_translation() - arm.data.bones[pb.parent.name].matrix_local.to_translation()).length
        if e < ecart:
            meilleur, ecart = math.radians(deg), e
    print(f"BAVETTE_POLE {fin} {math.degrees(meilleur):.0f}° écart {ecart * 1000:.1f} mm")
    return meilleur


def nettoyer_poids(corps, arm):
    """
    La chaleur déborde d'une patte sur sa voisine — les pattes avant se
    touchent presque au sol — et ignore les îlots isolés (les moustaches). On
    retire à chaque patte ce qui est de l'autre côté du plan médian, et on
    confie tout sommet orphelin à l'os le plus proche.

    Le tronc n'appartient qu'à l'échine. La chaleur laissait au ventre, devant
    le genou, des bouts de cuisse et même de jambe, et au poitrail des bouts
    des DEUX bras : la peau s'y étirait en pointes dès que la patte avançait,
    et pire assis. On lisse d'abord, puis les poids des pattes s'éteignent en
    douceur dans ces zones (le lissage ne peut plus les y ramener) ; l'échine
    la plus proche reprend ce qui manque.
    """
    groupes = {g.index: g.name for g in corps.vertex_groups}
    segments = {b.name: (b.head_local, b.tail_local) for b in arm.data.bones if b.use_deform}
    orphelins = 0
    for v in corps.data.vertices:
        x = v.co.x
        for g in list(v.groups):
            nom = groupes[g.group]
            cote = nom[-2:]
            if (cote == "_G" and x < -0.002) or (cote == "_D" and x > 0.002):
                corps.vertex_groups[nom].remove([v.index])
        if not any(g.weight > 1e-4 for g in v.groups):
            orphelins += 1
            proche = min(segments, key=lambda n: distance_segment(v.co, *segments[n]))
            corps.vertex_groups[proche].add([v.index], 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    corps.select_set(True)
    bpy.context.view_layer.objects.active = corps
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=6)
    bpy.ops.object.mode_set(mode="OBJECT")
    groupes = {g.index: g.name for g in corps.vertex_groups}
    for v in corps.data.vertices:
        x, y, z = v.co.x / K, v.co.y / KY + Y0, v.co.z / K - 0.5
        if z < -0.24:
            continue
        # Au-dessus du coude et du genou : 1 près des pattes, 0 au milieu du ventre
        # (y ∈ [−0,28 ; 0]) et sur la couture médiane, au poitrail comme entre
        # les cuisses, là où les deux pattes tiraient à la fois. Au poitrail la
        # couture est étroite (|x| < 0,01) : la face interne des bras doit les
        # suivre. Entre les cuisses, la peau de la source descend presque au
        # genou : quand une patte part en arrière et l'autre en avant, une
        # couture étroite cisaillait cette membrane en un pli fripé sous le
        # ventre (Philippe). Elle s'élargit donc derrière, dès l'aine, et
        # s'éteint en douceur sur 2,5 cm : le cisaillement s'y répartit.
        haut = lisse((z + 0.24) / 0.08)
        ventre = min(lisse((y + 0.38) / 0.10), lisse((0.0 - y) / 0.08))
        poitrail = (1 - lisse((abs(x) - 0.008) / 0.025)) * lisse((-0.38 - y) / 0.06)
        aine = (1 - lisse((abs(x) - 0.005) / 0.07)) * lisse((y + 0.02) / 0.06)
        garde = 1 - haut * max(ventre, poitrail, aine)
        if garde >= 1:
            continue
        poids = {groupes[g.group]: g.weight for g in v.groups}
        total = sum(poids.values())
        if total <= 0:
            continue
        pris = 0.0
        for nom, w in poids.items():
            w /= total
            if nom[-2:] in ("_G", "_D"):
                pris += w * (1 - garde)
                w *= garde
            corps.vertex_groups[nom].add([v.index], w, "REPLACE")
        for nom, w in echine(y):
            corps.vertex_groups[nom].add([v.index], pris * w, "ADD")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    print(f"BAVETTE_POIDS {orphelins} sommets orphelins rattachés")


def echine(y):
    """L'échine sous la coupe `y` (source) : deux os voisins, en proportion — sans saut d'un os à l'autre."""
    centres = (("Cou", -0.62), ("Poitrine", -0.36), ("Dos", -0.05), ("Bassin", 0.21))
    if y <= centres[0][1]:
        return [(centres[0][0], 1.0)]
    for (a, ya), (b, yb) in zip(centres, centres[1:]):
        if y <= yb:
            u = (y - ya) / (yb - ya)
            return [(a, 1 - u), (b, u)]
    return [(centres[-1][0], 1.0)]


def distance_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


# ── Poser ─────────────────────────────────────────────────────────────────
def tourner(pb, axe_monde, degres):
    """Compose une rotation autour d'un axe du MONDE, exprimé dans le repère de repos de l'os."""
    axe = pb.bone.matrix_local.to_3x3().inverted() @ Vector(axe_monde)
    pb.rotation_quaternion = Quaternion(axe.normalized(), math.radians(degres)) @ pb.rotation_quaternion


def deplacer(pb, v_monde):
    pb.location = pb.bone.matrix_local.to_3x3().inverted() @ Vector(v_monde)


def placer_ctrl(arm, nom, pointe, degres):
    """Le contrôleur pivote de `degres` autour de X monde, sur la pointe de la patte."""
    pb = arm.pose.bones[nom]
    repos = pb.bone.matrix_local
    modele = arm.data.bones[nom.replace("Ctrl", "")]
    pointe_repos = modele.tail_local
    r = Matrix.Rotation(math.radians(degres), 4, "X")
    tete = pointe + (r.to_3x3() @ (repos.to_translation() - pointe_repos))
    pb.matrix = Matrix.Translation(tete) @ r @ repos.to_3x3().to_4x4()


def remettre(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (OUVERTE,) * 3 if pb.name.startswith("Paupiere") else (1, 1, 1)


def cle(arm, frame):
    for pb in arm.pose.bones:
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def lisse(u):
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, u)))


def patte_en_marche(u, vol, avant):
    """
    `u` : temps depuis le décollage, en part du cycle. Rend (recul le long de la
    course ∈ [−½, ½], hauteur ∈ [0, 1], bascule en degrés).

    Pendant l'appui la patte recule À VITESSE (linéaire : pas de glisse) ; le
    talon se lève ensuite (au dernier cinquième devant, dès la mi-appui
    derrière), la patte roule sur ses doigts. En vol, comme dans la vidéo :
    l'antérieur se replie haut, poignet cassé, puis se tend loin devant et se
    pose presque tendu ; le postérieur casse le jarret sitôt décollé, le pied
    revient sous lui, passe bas sous le ventre et ne se déplie qu'à la pose.
    """
    # Le talon postérieur se lève dès le milieu de l'appui : le jarret monte et
    # avance au-dessus des doigts, la patte ne traîne pas tendue derrière.
    talon = 34 if avant else 32
    if u >= vol:
        s = (u - vol) / (1 - vol)
        return -0.5 + s, 0.0, talon * (lisse((s - 0.8) / 0.2) if avant else lisse((s - 0.45) / 0.55))
    s = u / vol
    recul = 0.5 - lisse(min(1.0, s / 0.92))
    hauteur = math.sin(math.pi * min(1.0, s ** (0.7 if avant else 0.85) / 0.97))
    if avant:
        bascule = 34 + 50 * math.sin(math.pi * min(1.0, s / 0.6)) * (s < 0.6) - 34 * lisse((s - 0.45) / 0.5)
    else:
        # Le jarret se replie aussitôt décollé : le pied revient sous lui,
        # doigts vers l'avant, et le jarret reste derrière la hanche.
        bascule = talon * (1 - lisse(s / 0.3)) - 12 * math.sin(math.pi * s)
    return recul, max(0.0, hauteur), bascule


def orienter(arm, nom, direction):
    """Pointe l'os `nom` dans une direction du MONDE (sa tête reste où son parent la met)."""
    pb = arm.pose.bones[nom]
    bpy.context.view_layer.update()
    repos = pb.bone.matrix_local
    axe = (repos.to_3x3() @ Vector((0, 1, 0))).normalized()
    r = axe.rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(pb.head) @ r @ repos.to_3x3().to_4x4()


def direction(tangage, lacet):
    """Tangage sous l'horizontale (degrés, négatif = vers le sol), lacet vers +X ; 0 = droit derrière (+Y)."""
    t, l = math.radians(tangage), math.radians(lacet)
    return Vector((math.sin(l) * math.cos(t), math.cos(l) * math.cos(t), math.sin(t)))


def queue(arm, dirs):
    """La queue, os par os, le long de directions du monde (base → pointe)."""
    for i, d in enumerate(dirs):
        orienter(arm, f"Queue{i + 1}", d)


def queue_basse(angles, t, balance, frequence=1):
    """Basse et en courbe, avec un balancement qui court vers la pointe."""
    return [direction(a + 1.5 * math.sin(2 * math.pi * (2 * frequence * t - 0.1 * i)) * (i + 1) / 6,
                      balance * (0.3 + 0.14 * i) * math.sin(2 * math.pi * (frequence * t - 0.07 * i)))
            for i, a in enumerate(angles)]


def action(arm, nom, images, poser, boucle=True):
    act = bpy.data.actions.new(nom)
    arm.animation_data_create()
    # Les actions déjà cuites dorment dans le NLA : muettes pendant la cuisson,
    # sinon leur première image se mêle à celle-ci.
    for piste in arm.animation_data.nla_tracks:
        piste.mute = True
    arm.animation_data.action = act
    manque = (0.0, 0, "")
    for f in range(images + 1):
        remettre(arm)
        poser(arm, (f % images) / images if boucle else f / images)
        bpy.context.view_layer.update()
        cle(arm, f)
        # Une patte trop courte pour sa cible glisserait : on le mesure.
        for c in ("G", "D"):
            for fin, ctrl in ((f"AvantBras_{c}", f"CtrlMain_{c}"), (f"Jambe_{c}", f"CtrlPied_{c}")):
                manque = max(manque, ((arm.pose.bones[fin].tail - arm.pose.bones[ctrl].head).length, f, fin))
    print(f"BAVETTE_IK {nom} écart max {manque[0] * 1000:.1f} mm ({manque[2]}, image {manque[1]})")
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, images
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(frame_start=0, frame_end=images, only_selected=False, visual_keying=True,
                     clear_constraints=False, use_current_action=True, bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    act.use_fake_user = True
    piste = arm.animation_data.nla_tracks.new()
    piste.name = nom
    piste.strips.new(nom, 0, act)
    arm.animation_data.action = None
    print(f"BAVETTE_ACTION {nom} {images} images ({images / FPS:.2f} s)")


def marche(arm, t):
    """
    Un cycle, t ∈ [0, 1[ ; t = 0 : le postérieur gauche décolle. Haut sur
    pattes, le dos plat, la tête portée au-dessus du dos, la queue basse.
    """
    pose = arm.pose.bones
    # Deux petits creux par cycle, juste après la pose de chaque antérieur.
    deplacer(pose["Bassin"], (0, 0, -FLEXION - 0.004 * math.cos(4 * math.pi * (t - 0.70))))
    # La hanche du postérieur en vol s'abaisse (gauche vers t = 0,22), celle qui
    # porte monte, et le bassin pivote un peu.
    tourner(pose["Bassin"], (0, 1, 0), 4.0 * math.cos(2 * math.pi * (t - 0.22)))
    tourner(pose["Bassin"], (0, 0, 1), 2.0 * math.sin(2 * math.pi * (t - 0.22)))
    tourner(pose["Dos"], (0, 1, 0), -4.0 * math.cos(2 * math.pi * (t - 0.22)))
    tourner(pose["Dos"], (0, 0, 1), -2.0 * math.sin(2 * math.pi * (t - 0.22)))
    # Les épaules, à leur tour, avec l'antérieur (gauche en vol vers t = 0,51) ;
    # le garrot un rien plus bas que les hanches.
    tourner(pose["Poitrine"], (1, 0, 0), 2)
    tourner(pose["Poitrine"], (0, 1, 0), 2.5 * math.cos(2 * math.pi * (t - 0.51)))
    tourner(pose["Poitrine"], (0, 0, 1), -1.5 * math.sin(2 * math.pi * (t - 0.51)))
    # La tête portée au-dessus du dos, dans l'axe, qui compense le roulis et hoche à peine.
    tourner(pose["Cou"], (1, 0, 0), COU_MARCHE)
    pose["Cou"].scale = (1, COU_ETIRE, 1)
    tourner(pose["Cou"], (0, 1, 0), -2.5 * math.cos(2 * math.pi * (t - 0.51)))
    tourner(pose["Cou"], (0, 0, 1), 1.5 * math.sin(2 * math.pi * (t - 0.51)))
    tourner(pose["Tete"], (1, 0, 0), TETE_MARCHE + 1.5 * math.cos(4 * math.pi * (t - 0.70)))
    for c, avant, decolle, vol in PATTES:
        u = (t - decolle) % 1.0
        recul, hauteur, bascule = patte_en_marche(u, vol, avant)
        course = VITESSE * (1 - vol) * PERIODE
        bout = arm.data.bones[f"{'Main' if avant else 'Pied'}_{c}"].tail_local.copy()
        pointe = bout + Vector((0, recul * course + APPUI[avant], hauteur * LEVER[avant]))
        placer_ctrl(arm, f"Ctrl{'Main' if avant else 'Pied'}_{c}", pointe, bascule)
        if avant:
            # L'omoplate roule : elle suit la patte d'avant en arrière — c'est
            # elle qui donne au chat sa longue foulée, le bras seul n'y suffit
            # pas — et saille quand la patte porte, sous l'épaule.
            porte = 0.5 + 0.5 * math.cos(2 * math.pi * (u - vol - (1 - vol) / 2))
            deplacer(pose[f"Bras_{c}"], (0, OMOPLATE * recul, 0.006 * (porte - 0.5)))
        else:
            tourner(pose[f"Orteils_{c}"], (1, 0, 0), -bascule * 0.4)
    queue(arm, queue_basse(QUEUE_MARCHE, t, 5))


def assise(arm, s, t=0.0):
    """
    La pose, de debout (s = 0) à assis (s = 1). Le train arrière recule et
    s'abaisse sur des pieds qui ne bougent pas ; les mains font un petit pas
    en arrière pour passer sous les épaules ; la tête reste d'aplomb.
    """
    pose = arm.pose.bones
    e = lisse(s)
    deplacer(pose["Bassin"], (0, 0.0, -0.19 * e))
    tourner(pose["Bassin"], (1, 0, 0), -34 * e)
    tourner(pose["Dos"], (1, 0, 0), -8 * e)
    tourner(pose["Poitrine"], (1, 0, 0), -6 * e)
    tourner(pose["Cou"], (1, 0, 0), 36 * e)
    tourner(pose["Tete"], (1, 0, 0), 16 * e)
    for c, avant, _, _ in PATTES:
        bout = arm.data.bones[f"{'Main' if avant else 'Pied'}_{c}"].tail_local.copy()
        if avant:
            # Un pas en arrière, pied levé au milieu du geste — la main gauche d'abord.
            u = max(0.0, min(1.0, (s - (0.15 if c == "G" else 0.4)) / 0.4))
            bout += Vector((0, 0.045 * lisse(u), 0.025 * math.sin(math.pi * u)))
            placer_ctrl(arm, f"CtrlMain_{c}", bout, 25 * math.sin(math.pi * u))
        else:
            # Le pied se couche vers l'avant, pivotant sur ses doigts.
            placer_ctrl(arm, f"CtrlPied_{c}", bout, -60 * e)


def souffle_et_regard(arm, t, regard_deg):
    pose = arm.pose.bones
    souffle = math.sin(2 * math.pi * 2 * t)
    pose["Poitrine"].scale = (1 + 0.018 * souffle, 1, 1 + 0.018 * souffle)
    pose["Dos"].scale = (1 + 0.012 * souffle, 1, 1 + 0.012 * souffle)
    regard = math.sin(2 * math.pi * t)
    tourner(pose["Cou"], (0, 0, 1), regard_deg * regard)
    tourner(pose["Tete"], (0, 0, 1), 0.8 * regard_deg * regard)
    tourner(pose["Tete"], (0, 1, 0), 4 * math.sin(2 * math.pi * t + 1.1))
    tourner(pose["Tete"], (1, 0, 0), 3 * math.sin(4 * math.pi * t))


Z_SOL = 0.02            # m : l'axe de la queue couchée, un rayon au-dessus du sol
# Assis, la queue fait le tour des pattes par la gauche : cap de chaque os
# (0 = droit derrière, 90 = flanc gauche, 180 = devant).
QUEUE_AUTOUR = (60, 100, 130, 155, 175, 190)


def au_sol(arm, dirs, sol=0.0):
    """La queue suit `dirs`, sans jamais passer sous Z_SOL (au-dessus de `sol`) : elle se couche sur le sol."""
    bpy.context.view_layer.update()
    p = arm.pose.bones["Queue1"].head.copy()
    out = []
    for i, d in enumerate(dirs):
        n = arm.data.bones[f"Queue{i + 1}"].length
        d = d.normalized()
        if p.z + d.z * n < sol + Z_SOL:
            plat = Vector((d.x, d.y, 0)).normalized()
            dz = max(-1.0, min(1.0, (sol + Z_SOL - p.z) / n))
            d = plat * math.sqrt(1 - dz * dz) + Vector((0, 0, dz))
        out.append(d)
        p = p + d * n
    return out


def queue_autour(t=0.0, fremit=0.0):
    """Couchée au sol autour des pattes ; le bout frémit."""
    return [direction(-70 if i == 0 else -30 if i == 1 else 0,
                      cap + fremit * (i / 5) ** 2 * math.sin(2 * math.pi * 3 * t - 0.6 * i))
            for i, cap in enumerate(QUEUE_AUTOUR)]


def repos(arm, t):
    """Debout, 4 s : respire, regarde de côté, balance lentement sa queue basse."""
    souffle_et_regard(arm, t, 10)
    tourner(arm.pose.bones["Cou"], (1, 0, 0), 4)
    assise(arm, 0.0)
    queue(arm, au_sol(arm, queue_basse(QUEUE_REPOS, t, 7)))


def sasseoir(arm, t):
    """1,2 s, sans boucle : de `Repos` (t = 0) à `Assis` (t = 1). Jouée à l'envers, il se lève."""
    assise(arm, t)
    e = lisse(t)
    tourner(arm.pose.bones["Cou"], (1, 0, 0), 4 * (1 - e))
    debout, assise_ = queue_basse(QUEUE_REPOS, 0.0, 7), queue_autour()
    queue(arm, au_sol(arm, [a.lerp(b, e) for a, b in zip(debout, assise_)]))


def assis(arm, t):
    """Assis, 6 s : respire, regarde lentement autour, bout de queue qui frémit."""
    assise(arm, 1.0)
    souffle_et_regard(arm, t, 14)
    queue(arm, au_sol(arm, queue_autour(t, 12)))


# ── La sieste sur un banc ──────────────────────────────────────────────────
# « Si Bavette pouvait dormir aléatoirement sur l'un des bancs ce serait top.
# Faudrait réussir à faire l'animation pour qu'il saute. » (Philippe)
#
# Cinq actions, que `promenade.ts` enchaîne : `Saut` (du sol sur l'assise),
# `Enroule` (il tourne une fois sur lui-même, se couche et s'enroule, le nez
# dans la queue), `Dort` (en boucle : il respire lentement, une oreille
# frémit), `Reveil` (il se déroule, se lève et s'étire) et `Descente` (un
# demi-tour, et il saute au sol).
#
# Le déplacement est CUIT dans le bassin : pendant le saut, le corps part
# d'un point d'appel au sol et arrive SAUT_D plus loin, SAUT_H plus haut — les
# cibles des pattes sont posées au sol puis sur l'assise, elles ne glissent
# pas. `BavetteLayer` pose le chat au point d'appel pour `Saut`, sur l'assise
# pour les suivantes ; l'écart entre SAUT_H et la vraie hauteur du banc (0,45
# à 0,48 m, et le relief du jardin) se rattrape PENDANT LE VOL, quand aucune
# patte ne touche rien — d'où les instants SAUT_VOL et DESCENTE_VOL, recopiés
# dans `promenade.ts`.
SAUT_H = 0.46           # m : l'assise des bancs (mesurée sur mobilier.glb)
SAUT_D = 0.70           # m : du point d'appel au point de sieste
BORD = 0.20             # m : du point de sieste au bord de l'assise, côté saut
QUEUE_HAUTE = (8, 22, 30, 28, 16, -4)   # dressée en crosse, pour l'équilibre


def rz(degres):
    return Matrix.Rotation(math.radians(degres), 4, "Z")


def rx_autour(degres, pivot):
    """Rotation autour de l'axe X passant par `pivot` (positif = museau vers le bas)."""
    p = Vector(pivot)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(degres), 4, "X") @ Matrix.Translation(-p)


def porter(arm, M):
    """
    Tout le corps suit M (repère du monde) : le bassin porte le reste, et les
    pôles des coudes et des genoux suivent — les cibles des pattes, non.
    """
    bpy.context.view_layer.update()
    for nom in ("Bassin", "PoleBras_G", "PoleBras_D", "PoleCuisse_G", "PoleCuisse_D"):
        pb = arm.pose.bones[nom]
        pb.matrix = M @ pb.matrix


def placer(arm, nom, M, degres=0.0):
    """Le contrôleur `nom`, à sa place de repos transformée par M, basculé de `degres` sur la pointe."""
    pb = arm.pose.bones[nom]
    repos = pb.bone.matrix_local
    pointe = arm.data.bones[nom.replace("Ctrl", "")].tail_local
    r = M.to_3x3() @ Matrix.Rotation(math.radians(degres), 3, "X")
    tete = M @ pointe + r @ (repos.to_translation() - pointe)
    pb.matrix = Matrix.Translation(tete) @ r.to_4x4() @ repos.to_3x3().to_4x4()


def entre(a, b, f):
    """De la matrice a à la matrice b : translation linéaire, rotation sphérique."""
    ta, ra, _ = a.decompose()
    tb, rb, _ = b.decompose()
    return Matrix.Translation(ta.lerp(tb, f)) @ ra.slerp(rb, f).to_matrix().to_4x4()


def bosse(u, a, b):
    """0 hors de [a, b], 1 au milieu, en sinus."""
    return math.sin(math.pi * (u - a) / (b - a)) if a < u < b else 0.0


def rampe(u, a, b):
    return lisse((u - a) / (b - a))


HANCHE = Vector((0, 0.152, 0.224))      # la hanche, pivot de l'élan
# Le saut, en part de l'action : les antérieurs décollent puis se posent les
# premiers ; entre SAUT_VOL[0] et SAUT_VOL[1], plus rien ne touche.
SAUT_PATTES = {True: (0.38, 0.72), False: (0.52, 0.80)}
SAUT_VOL = (0.52, 0.72)


def trajet(arm, u, h, d, pattes, monte, avance, repli, R=None, assise=None):
    """
    Le corps et les pattes d'un saut de `d` vers l'avant et `h` vers le haut.
    `pattes[avant] = (décollage, pose)` ; `monte(u)`, `avance(u)` : la part
    faite du trajet, en hauteur et en longueur ; `repli[avant]` : où la patte
    se replie en vol, par rapport au corps ; `assise = (y0, y1, z)` : au-dessus
    de l'assise (y0 < y < y1, repère du saut), une patte en vol reste au-dessus
    de z — elle passe le bord, pas au travers. Rend la matrice du corps.
    """
    pz, py = monte(u), avance(u)
    R = Matrix.Identity(4) if R is None else R
    tangage = 24 * bosse(u, pattes[True][0] - (0.08 if h > 0 else 0.0), pattes[True][1] + 0.03) ** 0.7 * (-1 if h > 0 else 1)
    arc = 0.08 * math.sin(math.pi * pz)
    ici = Vector((0, -d * py, h * pz + arc))
    M = R @ Matrix.Translation(ici) @ rx_autour(tangage, HANCHE)
    for c, avant, _, _ in PATTES:
        nom = f"Ctrl{'Main' if avant else 'Pied'}_{c}"
        lever, poser_ = pattes[avant]
        a = (u - lever) / (poser_ - lever)
        depart, arrivee = R, R @ Matrix.Translation((0, -d, h))
        if a <= 0:
            # Il roule sur ses doigts avant de quitter le sol : la patte s'allonge d'autant.
            placer(arm, nom, depart, (30 if avant else 45) * rampe(u, lever - 0.12, lever))
        elif a >= 1:
            placer(arm, nom, arrivee)
        else:
            en_vol = M @ Matrix.Translation(repli[avant])
            m = entre(depart, en_vol, lisse(a / 0.4)) if a < 0.4 else entre(en_vol, arrivee, lisse((a - 0.5) / 0.5)) if a > 0.5 else en_vol
            if assise:
                pointe = R.inverted() @ m @ arm.data.bones[nom.replace("Ctrl", "")].tail_local
                if assise[0] < pointe.y < assise[1] and pointe.z < assise[2] + 0.01:
                    m = R @ Matrix.Translation((0, 0, assise[2] + 0.01 - pointe.z)) @ R.inverted() @ m
            placer(arm, nom, m, (50 if avant else -30) * math.sin(math.pi * a))
    return M


def saut(arm, u):
    """
    1,4 s, sans boucle : du sol sur l'assise. Il se ramasse en regardant où il
    va (le train arrière frétille), les antérieurs décollent, les postérieurs
    poussent, il passe le bord pattes repliées, pose les mains puis les pieds,
    et amortit.
    """
    pose = arm.pose.bones
    ramasse = rampe(u, 0.0, 0.30) * (1 - rampe(u, 0.40, 0.54))
    amorti = bosse(u, 0.70, 0.98)
    deplacer(pose["Bassin"], (0, 0.012 * ramasse, -0.07 * ramasse - 0.02 * amorti))
    tourner(pose["Bassin"], (0, 0, 1), 3.0 * math.sin(2 * math.pi * 2.5 * u) * bosse(u, 0.08, 0.36))
    tourner(pose["Poitrine"], (1, 0, 0), 10 * ramasse)
    # Le regard sur l'assise, puis devant lui une fois posé.
    regard = rampe(u, 0.0, 0.25) * (1 - rampe(u, 0.7, 0.95))
    tourner(pose["Cou"], (1, 0, 0), -14 * regard)
    tourner(pose["Tete"], (1, 0, 0), -6 * regard)
    # En vol, l'échine s'étire à l'appel et se voûte à la réception.
    tourner(pose["Dos"], (1, 0, 0), -6 * bosse(u, 0.42, 0.62) + 5 * bosse(u, 0.64, 0.86))
    M = trajet(arm, u, SAUT_H, SAUT_D, SAUT_PATTES, lambda v: rampe(v, 0.46, 0.72), lambda v: rampe(v, 0.44, 0.76),
               {True: Vector((0, -0.05, 0.10)), False: Vector((0, -0.04, 0.09))}, assise=(-9, BORD - SAUT_D, SAUT_H))
    porter(arm, M)
    q = rampe(u, 0.3, 0.6)
    dirs = [a.lerp(b, q) for a, b in zip(queue_basse(QUEUE_REPOS, 0.0, 7), queue_basse(QUEUE_HAUTE, u, 4))]
    queue(arm, au_sol(arm, dirs, SAUT_H * rampe(u, 0.55, 0.8)))


def bas_du_corps(arm):
    """Le point le plus bas et le centre (x, y) du maillage déformé, dans la pose courante."""
    bpy.context.view_layer.update()
    corps = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm)
    ev = corps.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    vs = [corps.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return (min(v.z for v in vs),
            (min(v.x for v in vs) + max(v.x for v in vs)) / 2, (min(v.y for v in vs) + max(v.y for v in vs)) / 2)


# L'enroulé, relevé sur la photo 39 : couché sur le flanc droit, le dos rond,
# le museau rentré sur les pattes avant, les postérieurs repliés contre le
# ventre, la queue qui fait le tour et vient passer sous le nez.
BOULE_ECHINE = {"Dos": 34, "Poitrine": 34, "Cou": 50, "Tete": 42}
BOULE_BASSIN = -40
BOULE_ROULIS = -78      # autour de l'axe du corps : le flanc gauche vers le ciel
BOULE_TETE = -35        # degrés, autour de l’axe du museau
BOULE_LACET = 90       # il finit de tourner en se couchant : la boule en long sur le banc
AXE_ECHINE = Vector((0, 0.02, 0.21))


def boule(arm, echine, roulis):
    """La forme de l'enroulé, de debout (e = 0) à enroulé (e = 1), sans les pattes ni la queue."""
    pose = arm.pose.bones
    for nom, deg in BOULE_ECHINE.items():
        tourner(pose[nom], (1, 0, 0), deg * echine)
    tourner(pose["Bassin"], (1, 0, 0), BOULE_BASSIN * echine)
    # La tête se redresse un peu sur le flanc : le front vers le ciel, comme sur la photo.
    tourner(pose["Tete"], (0, 1, 0), BOULE_TETE * roulis)
    p = AXE_ECHINE
    tourne = Matrix.Translation(p) @ Matrix.Rotation(math.radians(BOULE_ROULIS * roulis), 4, "Y") @ Matrix.Translation(-p)
    return rz(BOULE_LACET * roulis) @ tourne


# Les pattes repliées, en coordonnées DEBOUT, portées par l'os qui les tient
# (la poitrine, la tête, le bassin) : la patte suit le corps qui se roule. La
# patte avant du dessus (la gauche) passe sur le museau, comme sur la photo —
# elle cache les yeux, que le modèle ne sait pas fermer.
REPLI_BOULE = {
    ("G", True): ("Poitrine", Vector((0.012, -0.21, 0.11)), 70),
    ("D", True): ("Poitrine", Vector((-0.01, -0.20, 0.10)), 70),
    ("G", False): ("Bassin", Vector((0.0, -0.06, 0.10)), -80),
    ("D", False): ("Bassin", Vector((0.0, -0.06, 0.10)), -80),
}


def replier(arm, e):
    """Chaque patte, de sa place au sol (e = 0) à repliée contre le corps (e = 1)."""
    bpy.context.view_layer.update()
    for c, avant, _, _ in PATTES:
        porteur, cible, bascule = REPLI_BOULE[c, avant]
        pb = arm.pose.bones[porteur]
        C = pb.matrix @ pb.bone.matrix_local.inverted()
        nom = f"Ctrl{'Main' if avant else 'Pied'}_{c}"
        pointe = arm.data.bones[nom.replace("Ctrl", "")].tail_local
        vers = C @ Matrix.Translation(Vector((pointe.x + cible.x, cible.y, cible.z)) - pointe)
        placer(arm, nom, entre(Matrix.Identity(4), vers, e), bascule * e)


BOULE_CENTRE = {}


def enroule_pose(arm, e):
    """Le corps enroulé à `e`, posé sur l'assise (le plus bas à z = 0), centré au fil de e."""
    if "xy" not in BOULE_CENTRE:
        BOULE_CENTRE["xy"] = (0.0, 0.0)
        enroule_pose(arm, 1.0)
        queue(arm, au_sol(arm, queue_boule()))
        BOULE_CENTRE["xy"] = bas_du_corps(arm)[1:]
        remettre(arm)
    cx, cy = BOULE_CENTRE["xy"]
    # Il plie d'abord les pattes et se voûte, puis bascule sur le flanc.
    pattes, echine, roulis = lisse(e / 0.7), lisse(e / 0.8), lisse((e - 0.2) / 0.8)
    porter(arm, boule(arm, echine, roulis))
    porter(arm, Matrix.Translation((-cx * roulis, -cy * roulis, 0)))
    replier(arm, pattes)
    # Posé, ni enfoncé ni en l'air : les pattes suivent le corps en partie,
    # d'où quelques passes.
    for _ in range(10):
        bas = bas_du_corps(arm)[0]
        if abs(bas) < 2e-4:
            break
        porter(arm, Matrix.Translation((0, 0, -bas)))
        replier(arm, pattes)


def fermer(arm, f):
    """Les yeux, de ouverts (f = 0) à fermés (f = 1)."""
    for c in ("G", "D"):
        arm.pose.bones[f"Paupiere_{c}"].scale = (OUVERTE + (FERMEE - OUVERTE) * f,) * 3


def enroule(arm, u):
    """
    5,4 s, sans boucle, sur l'assise : il fait un tour complet sur lui-même en
    piétinant, la queue dressée, puis se couche, bascule sur le flanc et
    s'enroule — la queue vient se poser autour de lui.
    """
    tour = u / 0.45
    if tour < 1:
        tour_sur_place(arm, tour, 360)
        queue(arm, queue_basse(QUEUE_HAUTE, u * 3, 4))
        return
    e = lisse((u - 0.45) / 0.55)
    enroule_pose(arm, e)
    fermer(arm, lisse((e - 0.6) / 0.4))
    haute = queue_basse(QUEUE_HAUTE, 0.45 * 3, 4)
    queue(arm, au_sol(arm, [a.lerp(b, lisse(e / 0.8)) for a, b in zip(haute, queue_boule())]))


def dort(arm, t):
    """
    Enroulé, 12 s en boucle : il respire lentement (quatre souffles), le bout
    de la queue bouge à peine, et une fois l'oreille du dessus frémit.
    """
    enroule_pose(arm, 1.0)
    fermer(arm, 1.0)
    pose = arm.pose.bones
    souffle = math.sin(2 * math.pi * 4 * t)
    pose["Poitrine"].scale = (1 + 0.022 * souffle, 1, 1 + 0.022 * souffle)
    pose["Dos"].scale = (1 + 0.015 * souffle, 1, 1 + 0.015 * souffle)
    frisson = bosse(t, 0.55, 0.58) + 0.7 * bosse(t, 0.60, 0.63)
    tourner(pose["Oreille_G"], (1, 0, 0), 28 * frisson)
    tourner(pose["Oreille_G"], (0, 0, 1), -18 * frisson)
    queue(arm, au_sol(arm, queue_boule(t, 5)))


def reveil(arm, u):
    """
    4 s, sans boucle : il se déroule et se lève (la queue se redresse), puis
    s'étire — les mains filent devant, la poitrine descend, la croupe reste
    haute — et revient debout.
    """
    pose = arm.pose.bones
    if u < 0.4:
        e = 1 - lisse(u / 0.4)
        enroule_pose(arm, e)
        fermer(arm, lisse((e - 0.6) / 0.4))
        haute = queue_basse(QUEUE_HAUTE, 0.0, 4)
        queue(arm, au_sol(arm, [b.lerp(a, lisse((1 - e) / 0.8)) for a, b in zip(haute, queue_boule())]))
        return
    s = (u - 0.4) / 0.6
    etire = lisse(s / 0.35) * (1 - lisse((s - 0.72) / 0.28))
    tourner(pose["Bassin"], (1, 0, 0), 16 * etire)
    tourner(pose["Dos"], (1, 0, 0), 8 * etire)
    tourner(pose["Poitrine"], (1, 0, 0), 8 * etire)
    tourner(pose["Cou"], (1, 0, 0), -44 * etire)
    tourner(pose["Tete"], (1, 0, 0), -12 * etire)
    deplacer(pose["Bassin"], (0, 0.02 * etire, 0.012 * etire))
    for c, avant, _, _ in PATTES:
        nom = f"Ctrl{'Main' if avant else 'Pied'}_{c}"
        if avant:
            # Les mains avancent l'une après l'autre, puis reviennent.
            aller = lisse((s - (0.0 if c == "G" else 0.08)) / 0.25)
            retour = lisse((s - (0.55 if c == "G" else 0.62)) / 0.2)
            pas_ = bosse(s, 0.0 if c == "G" else 0.08, 0.25 if c == "G" else 0.33) + bosse(s, 0.55 if c == "G" else 0.62, 0.75 if c == "G" else 0.82)
            placer(arm, nom, Matrix.Translation((0, -0.13 * (aller - retour), 0.03 * pas_)), 15 * pas_)
        else:
            placer(arm, nom, Matrix.Identity(4))
    queue(arm, queue_basse(QUEUE_HAUTE, s, 4))


DESCENTE_PATTES = {True: (0.52, 0.78), False: (0.62, 0.86)}
DESCENTE_VOL = (0.62, 0.78)


def descente(arm, u):
    """
    2,4 s, sans boucle : un demi-tour sur l'assise, puis il saute au sol —
    les mains d'abord, le museau vers le bas — et repart d'aplomb, la queue basse.
    """
    pose = arm.pose.bones
    if u < 0.42:
        tour_sur_place(arm, u / 0.42, 180, pas=3)
        queue(arm, queue_basse(QUEUE_HAUTE, u * 2, 4))
        return
    R = rz(180)
    ramasse = rampe(u, 0.42, 0.5) * (1 - rampe(u, 0.54, 0.62))
    amorti = bosse(u, 0.78, 1.0)
    deplacer(pose["Bassin"], (0, 0, -0.04 * ramasse - 0.025 * amorti))
    tourner(pose["Cou"], (1, 0, 0), 12 * rampe(u, 0.42, 0.55) * (1 - rampe(u, 0.8, 0.98)))
    M = trajet(arm, u, -SAUT_H, SAUT_D, DESCENTE_PATTES, lambda v: rampe(v, 0.58, 0.82), lambda v: rampe(v, 0.50, 0.84),
               {True: Vector((0, -0.12, 0.04)), False: Vector((0, -0.02, 0.08))}, R, assise=(-BORD, 9, 0.0))
    porter(arm, M)
    q = rampe(u, 0.7, 1.0)
    dirs = [a.lerp(b, q) for a, b in zip(queue_basse(QUEUE_HAUTE, 0.84, 4), queue_basse(QUEUE_REPOS, 0.0, 7))]
    queue(arm, au_sol(arm, [R.to_3x3() @ d for d in dirs], -SAUT_H * rampe(u, 0.62, 0.8)))


QUEUE_BOULE = (86, 126, 156, 176, 192, 206)


def queue_boule(t=0.0, fremit=0.0):
    """Couchée sur l'assise, elle fait le tour de ses pattes jusque sous le nez ; le bout frémit."""
    return [direction(-60 if i == 0 else 0, cap - BOULE_LACET + fremit * (i / 5) ** 2 * (math.sin(2 * math.pi * t - 0.6 * i) + math.sin(0.6 * i)))
            for i, cap in enumerate(QUEUE_BOULE)]


def tour_sur_place(arm, s, total, pas=5, R=None):
    """
    Il tourne de `total` degrés (vers sa gauche) autour de l'origine, s ∈ [0, 1] :
    le corps pivote en continu, se courbe du côté où il tourne, et chaque patte
    suit par `pas` petits pas — posée, elle ne glisse pas. Rend la matrice du corps.
    """
    R = Matrix.Identity(4) if R is None else R
    pose = arm.pose.bones
    theta = total * lisse(s)
    courbe = math.copysign(1, total) * math.sin(math.pi * s)
    for nom, deg in (("Dos", 5), ("Poitrine", 6), ("Cou", 10), ("Tete", 8)):
        tourner(pose[nom], (0, 0, 1), deg * courbe)
    M = R @ rz(theta)
    porter(arm, M)
    for c, avant, decolle, _ in PATTES:
        nom = f"Ctrl{'Main' if avant else 'Pied'}_{c}"
        angle, vol = 0.0, 0.0
        for j in range(pas):
            f = (s - (j + decolle) / (pas + 1)) / (0.7 / (pas + 1))
            if f <= 0:
                break
            vise = total if j == pas - 1 else total * lisse((j + decolle + 1) / (pas + 1))
            if f < 1:
                angle, vol = angle + (vise - angle) * lisse(f), math.sin(math.pi * f)
                break
            angle = vise
        placer(arm, nom, R @ Matrix.Translation((0, 0, 0.035 * vol)) @ rz(angle), 20 * vol)
    return M


def exporter(corps, arm):
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    remettre(arm)
    bpy.ops.object.select_all(action="DESELECT")
    corps.select_set(True)
    arm.select_set(True)
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_def_bones=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_draco_mesh_compression_enable=False,
    )
    print(f"BAVETTE {SORTIE} {SORTIE.stat().st_size / 1024:.0f} Ko · vitesse {VITESSE:.3f} m/s")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) != 1:
        print("usage: … -- <chemin/vers/Bavette Meshy profil.glb>")
        sys.exit(1)
    source = Path(argv[0])
    if not source.exists():
        print(f"BAVETTE_MANQUANTE {source}")
        sys.exit(1)
    bpy.context.scene.render.fps = FPS
    corps = importer(source)
    arm = squelette(corps)
    remettre(arm)
    action(arm, "Marche", round(PERIODE * FPS), marche)
    action(arm, "Repos", 4 * FPS, repos)
    action(arm, "Sasseoir", round(1.2 * FPS), sasseoir, boucle=False)
    action(arm, "Assis", 6 * FPS, assis)
    # La sieste : durées recopiées dans `promenade.ts` (SIESTE).
    action(arm, "Saut", round(1.4 * FPS), saut, boucle=False)
    action(arm, "Enroule", round(5.4 * FPS), enroule, boucle=False)
    action(arm, "Dort", 12 * FPS, dort)
    action(arm, "Reveil", 4 * FPS, reveil, boucle=False)
    action(arm, "Descente", round(2.4 * FPS), descente, boucle=False)
    print(f"BAVETTE_SIESTE vol du saut {SAUT_VOL} · de la descente {DESCENTE_VOL} · H {SAUT_H} · D {SAUT_D} · bord {BORD}")
    exporter(corps, arm)


if __name__ == "__main__":
    main()
