"""
Bavette, vivant : maillage allégé, squelette de quadrupède et trois boucles.

    blender --background --python tools/blender/build-bavette-anime.py -- \
        "/chemin/vers/Bavette Meshy profil.glb"

Produit `public/assets/sculptures/bavette-anime.glb` : un maillage skinné et ses
actions `Marche`, `Repos` et `Assis`, lues par `src/scene/BavetteLayer.tsx`.

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
  4. les os `Tete` et `Cou` existent — la couche les tourne vers le visiteur.

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
# Trapu : la source est un chat de gouttière élancé. Le tronc s'élargit et le
# ventre descend un peu entre les pattes (voir `etoffer`), sans toucher aux
# pattes, à la tête ni à la queue.
LARGEUR = 1.10
VENTRE = 0.05           # unités source (≈ 1,8 cm) au milieu du ventre


def P(x, y, z):
    """Un point relevé sur la source (unités Meshy) → mètres, origine au sol."""
    return Vector((x * K, (y - Y0) * K, (z + 0.5) * K))


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
#   ordre : pas latéral, PG · AG · PD · AD ; l'antérieur décolle ~0,15 cycle
#     après le postérieur du même côté ;
#   vol : ~0,20 cycle au postérieur, ~0,27 à l'antérieur (qui se replie haut,
#     poignet cassé, puis se tend loin devant et se pose presque tendu).
# D'où, pour chaque patte : (côté, avant ?, décollage dans le cycle, durée du vol).
PATTES = [
    ("G", False, 0.00, 0.21), ("G", True, 0.15, 0.27),
    ("D", False, 0.50, 0.21), ("D", True, 0.65, 0.27),
]
PERIODE = 28 / FPS      # s ≈ 0,93
FOULEE = 0.40           # m, un cycle
VITESSE = FOULEE / PERIODE   # ≈ 0,43 m/s à timeScale 1
FLEXION = 0.035         # m : il marche bas, le ventre près de l'herbe
LEVER = {True: 0.065, False: 0.045}
OMOPLATE = 0.07         # m : course avant–arrière de l'épaule avec la patte
# La queue, en angle absolu sous l'horizontale, de la base à la pointe : basse,
# en courbe douce, la pointe à hauteur de jarret (vidéo : −38° à la base).
QUEUE_MARCHE = (-34, -42, -44, -42, -36, -28)
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
    m = Matrix.Diagonal((K, K, K, 1)) @ Matrix.Translation((0, -Y0, 0.5)) @ corps.matrix_world
    corps.data.transform(m)
    corps.matrix_world = Matrix.Identity(4)
    etoffer(corps)
    print(f"BAVETTE_TRI {depart} -> {triangles(corps)}")
    for img in bpy.data.images:
        if max(img.size) > TEXTURES:
            f = TEXTURES / max(img.size)
            img.scale(int(img.size[0] * f), int(img.size[1] * f))
    return corps


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
        y, z = v.co.y / K + Y0, v.co.z / K - 0.5
        tronc = cloche(y, -0.70, 0.42) ** 0.5 * max(0.0, min(1.0, (z + 0.22) / 0.12))
        v.co.x *= 1 + (LARGEUR - 1) * tronc
        ventre = cloche(y, -0.36, 0.14) * max(0.0, min(1.0, (0.20 - z) / 0.30)) * (z > -0.22)
        v.co.z -= VENTRE * K * ventre
    vs = [v.co for v in corps.data.vertices]
    garrot = max(c.z for c in vs if -0.47 <= c.y / K + Y0 <= -0.39)
    museau = min(c.y for c in vs)
    queue = (0.36 - Y0) * K
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
            # Le coude plie vers l'arrière (+Y), le genou vers l'avant (−Y).
            b = eb.new(pole)
            b.head = eb[genou].tail + Vector((0, sens * 0.25, 0))
            b.tail = b.head + Vector((0, 0, 0.03))
            b.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")

    ponderer(corps, arm)
    nettoyer_poids(corps, arm)

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
        x, y, z = v.co.x / K, v.co.y / K + Y0, v.co.z / K - 0.5
        if z < -0.24:
            continue
        # Au-dessus du coude et du genou : 1 près des pattes, 0 au milieu du ventre
        # (y ∈ [−0,28 ; 0]) et sur la couture médiane (|x| < 0,01), au poitrail
        # comme entre les cuisses, là où les deux pattes tiraient à la fois. La
        # couture est étroite : la face interne des pattes doit les suivre.
        haut = lisse((z + 0.24) / 0.08)
        ventre = min(lisse((y + 0.38) / 0.10), lisse((0.0 - y) / 0.08))
        couture = 1 - lisse((abs(x) - 0.008) / 0.025)
        garde = 1 - haut * max(ventre, couture * max(lisse((-0.38 - y) / 0.06), lisse((y - 0.08) / 0.06)))
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
        pb.scale = (1, 1, 1)


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

    Pendant l'appui la patte recule À VITESSE (linéaire : pas de glisse) ; au
    dernier cinquième le talon se lève, la patte roule sur ses doigts. En vol,
    comme dans la vidéo : l'antérieur se replie haut, poignet cassé, puis se
    tend loin devant et se pose presque tendu ; le postérieur, plus bref, se
    replie moins.
    """
    if u >= vol:
        s = (u - vol) / (1 - vol)
        return -0.5 + s, 0.0, (34 if avant else 26) * lisse((s - 0.8) / 0.2)
    s = u / vol
    recul = 0.5 - lisse(min(1.0, s / 0.92))
    hauteur = math.sin(math.pi * min(1.0, s ** (0.7 if avant else 0.85) / 0.97))
    if avant:
        bascule = 34 + 50 * math.sin(math.pi * min(1.0, s / 0.6)) * (s < 0.6) - 34 * lisse((s - 0.45) / 0.5)
    else:
        bascule = 26 + 22 * math.sin(math.pi * min(1.0, s / 0.6)) * (s < 0.6) - 26 * lisse((s - 0.45) / 0.5)
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
    Un cycle, t ∈ [0, 1[ ; t = 0 : le postérieur gauche décolle. Le corps bas,
    le dos long et plat, la tête portée au niveau du dos, la queue basse.
    """
    pose = arm.pose.bones
    # Deux petits creux par cycle, juste après la pose de chaque antérieur.
    deplacer(pose["Bassin"], (0, 0, -FLEXION - 0.004 * math.cos(4 * math.pi * (t - 0.47))))
    # La hanche du postérieur en vol s'abaisse (gauche vers t = 0,1), et pivote un peu.
    tourner(pose["Bassin"], (0, 1, 0), 3.0 * math.cos(2 * math.pi * (t - 0.10)))
    tourner(pose["Bassin"], (0, 0, 1), 2.0 * math.sin(2 * math.pi * (t - 0.10)))
    tourner(pose["Dos"], (0, 1, 0), -3.0 * math.cos(2 * math.pi * (t - 0.10)))
    tourner(pose["Dos"], (0, 0, 1), -2.0 * math.sin(2 * math.pi * (t - 0.10)))
    # Les épaules, à leur tour, avec l'antérieur (gauche en vol vers t = 0,28) ;
    # le garrot un rien plus bas que les hanches.
    tourner(pose["Poitrine"], (1, 0, 0), 2)
    tourner(pose["Poitrine"], (0, 1, 0), 2.5 * math.cos(2 * math.pi * (t - 0.28)))
    tourner(pose["Poitrine"], (0, 0, 1), -1.5 * math.sin(2 * math.pi * (t - 0.28)))
    # La tête basse, dans l'axe, qui compense le roulis et hoche à peine.
    tourner(pose["Cou"], (1, 0, 0), 18)
    tourner(pose["Cou"], (0, 1, 0), -2.5 * math.cos(2 * math.pi * (t - 0.28)))
    tourner(pose["Cou"], (0, 0, 1), 1.5 * math.sin(2 * math.pi * (t - 0.28)))
    tourner(pose["Tete"], (1, 0, 0), -10 + 1.5 * math.cos(4 * math.pi * (t - 0.47)))
    for c, avant, decolle, vol in PATTES:
        u = (t - decolle) % 1.0
        recul, hauteur, bascule = patte_en_marche(u, vol, avant)
        course = VITESSE * (1 - vol) * PERIODE
        bout = arm.data.bones[f"{'Main' if avant else 'Pied'}_{c}"].tail_local.copy()
        pointe = bout + Vector((0, recul * course, hauteur * LEVER[avant]))
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
    tourner(pose["Bassin"], (1, 0, 0), -40 * e)
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


def au_sol(arm, dirs):
    """La queue suit `dirs`, sans jamais passer sous Z_SOL : elle se couche sur le sol."""
    bpy.context.view_layer.update()
    p = arm.pose.bones["Queue1"].head.copy()
    out = []
    for i, d in enumerate(dirs):
        n = arm.data.bones[f"Queue{i + 1}"].length
        d = d.normalized()
        if p.z + d.z * n < Z_SOL:
            plat = Vector((d.x, d.y, 0)).normalized()
            dz = max(-1.0, min(1.0, (Z_SOL - p.z) / n))
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
    exporter(corps, arm)


if __name__ == "__main__":
    main()
