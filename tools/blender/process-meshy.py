"""
LOT 9 — Reprend les sorties brutes de Meshy et les republie en kits glTF.

    blender --background --python tools/blender/process-meshy.py
    blender --background --python tools/blender/process-meshy.py -- --only nervure-atrium

Lit `assets-src/meshy/<id>.glb` (NON versionnés — voir `public/assets/CREDITS.md`)
et produit les kits de `public/assets/props/`, qui sont commités parce que ni la
CI ni un contributeur n'ont de compte Meshy.

POURQUOI UNE PASSE BLENDER DU TOUT
Meshy livre 53 312 triangles et 3,5 Mo de carte pour une pièce que le musée
instancie seize fois. Brut, ce seul objet coûterait 853 000 triangles — presque
le budget entier du §9, pour une nervure. La passe le ramène à quelques centaines
et sa couleur à un attribut de sommet : zéro texture, et un draw call partagé
avec tout le reste du décor.

POURQUOI CUIRE LA COULEUR DANS LES SOMMETS
`fusionnerEnUnLot` (`src/scene/propAssets.ts`) fusionne déjà les primitives d'un
prop en un seul `MeshStandardMaterial` à `vertexColors`. Une pièce qui garde ses
cartes coûte un lot de plus, et la plupart de ces pièces n'ont rien à dire qu'une
couleur ne dise : du béton blanc, de l'acier blanc, du verre.

POURQUOI DÉCIMER AVANT DE CHANFREINER, ET JAMAIS L'INVERSE
Le chanfrein crée les arêtes les PLUS COURTES du maillage, et c'est exactement ce
que l'algorithme COLLAPSE attaque en premier. Chanfreiner puis décimer mange le
chanfrein et garde les triangles — le pire des deux. On décime donc à 85 % du
budget, on chanfreine, et on vérifie le total après coup.

POURQUOI UN BUDGET PAR PIÈCE ET PAS UN BUDGET GLOBAL
C'est la pièce qui est répétée. Un triangle économisé sur une nervure en vaut
seize à l'écran, et cent sur un projecteur. Un budget global masquerait ce
facteur — c'est très exactement comme ça que le projecteur du kit précédent a
atteint 94 000 triangles à l'écran sans que rien ne s'allume.

CE QUE CE SCRIPT NE DÉCIDE PAS
Le placement. `src/domain/decor.ts` et `src/domain/props.ts` disent OÙ ; ce
script dit AVEC QUOI, exactement comme `decimate-plants.py` pour la végétation.

Déterministe : aucun aléa, aucune horloge. Deux exécutions produisent le même
fichier.
"""

import math
import sys
from pathlib import Path

import bpy

# Racine du dépôt : le script est dans tools/blender/
ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "assets-src" / "meshy"
SORTIE = ROOT / "public" / "assets" / "props"


# ── La table des pièces — l'équivalent de `GARDES` ────────────────────────
#
# Une ligne par pièce. Les colonnes sont toutes des DÉCISIONS, pas des mesures
# reprises de Meshy :
#
#   noeud      le nom que le GLB portera, et sur lequel `kits.ts` fait contrat.
#              Meshy n'en met AUCUN — ses nœuds sortent anonymes — donc c'est ici
#              qu'il naît, et un test vérifie que les deux tables concordent.
#   axe        l'axe sur lequel `metres` s'applique, APRÈS import (Blender est
#              Z-up ; l'importateur glTF convertit).
#   metres     la taille réelle voulue. Meshy ne connaît pas la taille d'un banc.
#   ancrage    'sol' : le bas à z=0, l'empreinte centrée en (0,0).
#              'plafond' : le HAUT à z=0, la pièce pend sous son ancre.
#              'mur' : la face de pose à y=0.
#   budget     triangles après décimation. Voir l'en-tête : par pièce.
#   couleur    RGB linéaire, quand on N'utilise pas la carte de Meshy.
#   chanfrein  False sur les formes organiques : un bevel limité par angle sur un
#              maillage irrégulier se déclenche sur des milliers d'arêtes et fait
#              exploser le budget, pour un galbe qui n'a aucune arête vive.

PIECES = {
    # La nervure d'atrium : une côte cantilever qui naît du nez de dalle. 4,30 m,
    # soit la hauteur d'étage — elle occupe le vide sur toute sa hauteur, ce qui
    # est le geste. 16 exemplaires au pas de 3 m sur les 48 m de pourtour.
    "nervure-atrium": {
        "noeud": "NervureAtrium",
        "axe": "z",
        "metres": 4.30,
        "ancrage": "sol",
        # 1 600 et non 550, et le chiffre vient d'un A/B rendu, pas d'un arrondi.
        # À 550 le budget était tenu — et la POINTE était émoussée, les galbes
        # facettés : la décimation attaque le mince en premier, et sur cette
        # pièce le mince EST le sujet. Le compteur de triangles ne pouvait pas le
        # dire ; deux images côte à côte, si. 1 600 × 16 exemplaires = 25 600
        # triangles, payés par la reprise sur `BUDGET_ARBRE`.
        "budget": 1600,
        "couleur": (0.90, 0.89, 0.87),
        "chanfrein": False,
    },
}

# Les kits, et ce que chacun contient.
KITS = {
    "musee-fixe.glb": ["nervure-atrium"],
}

# En dessous, décimer abîme plus qu'il n'allège : un maillage déjà économe n'a
# pas d'arêtes courtes à effondrer, et le collapse attaque directement sa forme.
# Le même seuil que `decimate-plants.py`, à l'échelle de pièces plus petites.
PLANCHER = 120


def repartir():
    """Repart d'une scène vide. `--background` ne garantit pas un fichier neuf."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def importer(chemin: Path, nom: str):
    """
    Importe un GLB Meshy et rend UN objet nommé.

    Meshy sort ses nœuds ANONYMES et parfois en plusieurs morceaux. On joint et
    on nomme ici : sans ce nom, `kits.ts` ne retrouverait rien et la pièce
    disparaîtrait de la scène avec un simple avertissement en console.
    """
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(chemin))
    neufs = [o for o in set(bpy.data.objects) - avant if o.type == "MESH"]
    if not neufs:
        sys.exit(f"MESHY_VIDE {chemin.name} — aucun maillage importé")

    for o in bpy.data.objects:
        o.select_set(o in neufs)
    bpy.context.view_layer.objects.active = neufs[0]
    if len(neufs) > 1:
        bpy.ops.object.join()

    obj = bpy.context.view_layer.objects.active
    obj.name = nom
    obj.data.name = nom
    return obj


def appliquer_transformations(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.data.objects:
        o.select_set(o is obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def mettre_a_l_echelle(obj, axe: str, metres: float):
    """
    Échelle UNIFORME, jamais par axe.

    Une mise à l'échelle non uniforme détruirait les proportions de la forme —
    c'est-à-dire exactement ce qu'on vient de payer pour obtenir.
    """
    appliquer_transformations(obj)
    i = "xyz".index(axe)
    coords = [v.co[i] for v in obj.data.vertices]
    etendue = max(coords) - min(coords)
    if etendue <= 1e-9:
        sys.exit(f"MESHY_PLAT {obj.name} — étendue nulle sur {axe}")
    obj.scale = (metres / etendue,) * 3
    appliquer_transformations(obj)


def ancrer(obj, ancrage: str):
    """
    Pose l'origine sur le POINT DE CONTACT, dans les données de maillage.

    C'est la convention que `repereDAncrage()` suppose côté TypeScript : elle
    annule X et Z mais PRÉSERVE Y (Blender Z), parce que c'est cette translation
    qui pose l'objet. On cuit donc la bonne valeur ici, et l'origine de l'objet
    reste à zéro.

    Ce défaut-là est invisible aux épreuves : `PROP_METRICS` étant re-mesuré sur
    le MÊME fichier, un ancrage faux passe les deux bornes sans broncher. Seule
    une assertion `minY ≈ 0` l'attrape, et elle vit côté tests.
    """
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2

    if ancrage == "sol":
        dx, dy, dz = -cx, -cy, -min(zs)
    elif ancrage == "plafond":
        dx, dy, dz = -cx, -cy, -max(zs)
    elif ancrage == "mur":
        dx, dy, dz = -cx, -min(ys), -min(zs)
    else:
        sys.exit(f"MESHY_ANCRAGE {obj.name} — ancrage inconnu « {ancrage} »")

    for v in obj.data.vertices:
        v.co.x += dx
        v.co.y += dy
        v.co.z += dz


def decimer(obj, budget: int):
    """DECIMATE COLLAPSE, comme `decimate-plants.py`. Même algorithme, même parti."""
    actuel = triangles(obj)
    cible = max(PLANCHER, budget)
    if actuel <= cible:
        return
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name="Decimation", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = cible / actuel
    bpy.ops.object.modifier_apply(modifier=mod.name)


def chanfreiner(obj, largeur=0.003, segments=2):
    """
    Chanfrein sur toutes les arêtes vives, puis application.

    Repris VERBATIM de `build-props.py`, y compris sa sonde de version : une
    arête parfaitement nette ne capte aucune lumière et signe le procédural au
    premier coup d'œil ; un chanfrein de 3 mm accroche un filet de spéculaire et
    suffit à faire lire l'objet comme un vrai.
    """
    bpy.context.view_layer.objects.active = obj
    if hasattr(bpy.ops.object, "shade_auto_smooth"):
        bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    elif hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True

    mod = obj.modifiers.new(name="Chanfrein", type="BEVEL")
    mod.width = largeur
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def peindre(obj, couleur):
    """
    Pose une couleur uniforme en attribut de sommet, domaine CORNER.

    ── Pourquoi une couleur décidée ici, et pas la carte de Meshy ──

    Meshy invente des beiges. Le musée a une palette, et c'est elle qui doit
    gagner : une nervure de béton blanc n'est pas « ce que le modèle a bien voulu
    produire », c'est une décision d'architecture. La carte est donc jetée, et
    avec elle 3,5 Mo de PNG et un lot d'instances supplémentaire.

    ── Pourquoi le domaine CORNER ──

    L'exportateur glTF écrit un attribut de couleur en domaine coin comme
    `COLOR_0`, ce que `MeshStandardMaterial({vertexColors:true})` consomme
    directement. Le domaine coin préserve en outre les frontières nettes entre
    matières, là où le domaine point les dégraderait en dégradé.

    ── Pourquoi le matériau reste BLANC ──

    three multiplie `material.color` par la couleur de sommet. Un matériau teinté
    multiplierait deux fois et sortirait la pièce trop sombre.
    """
    maillage = obj.data
    for attr in list(maillage.color_attributes):
        maillage.color_attributes.remove(attr)
    couche = maillage.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    r, v, b = couleur
    for i in range(len(maillage.loops)):
        couche.data[i].color = (r, v, b, 1.0)

    maillage.materials.clear()
    mat = bpy.data.materials.new(name=f"Prop_{obj.name}")
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        principled.inputs["Roughness"].default_value = 0.82
        principled.inputs["Metallic"].default_value = 0.0
    maillage.materials.append(mat)


def exporter(objets, chemin: Path):
    """
    Export glTF binaire, Draco, Y-up — et les COULEURS DE SOMMET.

    ⚠️ L'export des couleurs de sommet n'est PAS activé par défaut, et l'argument
    a changé de nom entre les versions de Blender. Se tromper ici livre un kit
    uniformément blanc, sans la moindre erreur : la géométrie est là, la couleur
    est simplement absente. On sonde donc la signature plutôt que de parier.
    """
    for o in bpy.data.objects:
        o.select_set(o in objets)
    bpy.context.view_layer.objects.active = objets[0]

    options = dict(
        filepath=str(chemin),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )

    signature = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in signature:
        options["export_vertex_color"] = "ACTIVE"
    # ⚠️ `export_all_vertex_colors` doit rester FAUX, et ce n'est pas un réglage
    # de confort. À vrai, l'export a écrit `COLOR_0` ET `COLOR_1` — deux couches
    # pour une seule couleur. Le surpoids serait le moindre mal : `mergeGeometries`
    # exige des jeux d'attributs IDENTIQUES et rend `null` quand ils diffèrent,
    # sans lever. Une pièce à deux couches parmi des pièces à une seule ferait
    # donc disparaître le décor ENTIER, en silence. Vérifié sur la pièce pilote.
    if "export_all_vertex_colors" in signature:
        options["export_all_vertex_colors"] = False
    if "export_colors" in signature:
        options["export_colors"] = True

    bpy.ops.export_scene.gltf(**options)


def rendre_apercu(objets, chemin: Path):
    """
    Rend le kit décimé en une image, pour le juger AVANT de l'intégrer.

    ── Pourquoi ce n'est pas un luxe ──

    La décimation attaque le mince en premier : `decimate-plants.py` a payé la
    leçon comptant, un arbre ramené trop bas sortait en SQUELETTE, et le compteur
    de triangles affichait pourtant exactement la valeur demandée. Un budget tenu
    ne dit RIEN de la forme qui reste. Seule une image le dit, et la produire ici
    coûte quelques secondes contre un aller-retour complet par le musée.

    Éclairage à trois points sur fond neutre : ce n'est pas le rendu du musée, et
    ça ne prétend pas l'être — c'est un contrôle de SILHOUETTE.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {
        e.identifier for e in bpy.types.RenderEngine.__subclasses__() if hasattr(e, "identifier")
    } else scene.render.engine
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("Apercu")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.30, 0.30, 0.32, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

    # Le cadrage se CALCULE sur les bornes réelles ; il ne se devine pas. Une
    # première version posait la caméra à des angles écrits à la main et coupait
    # le haut de la pièce — un aperçu qui ampute son sujet est pire qu'aucun
    # aperçu, parce qu'il a l'air d'en être un.
    xs = [v.co.x for o in objets for v in o.data.vertices]
    ys = [v.co.y for o in objets for v in o.data.vertices]
    zs = [v.co.z for o in objets for v in o.data.vertices]
    centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    h = max(zs) - min(zs)
    r = max(max(xs) - min(xs), max(ys) - min(ys), h)

    cible = bpy.data.objects.new("Cible", None)
    cible.location = centre
    scene.collection.objects.link(cible)

    cam_data = bpy.data.cameras.new("Apercu")
    cam_data.lens = 70
    cam = bpy.data.objects.new("Apercu", cam_data)
    scene.collection.objects.link(cam)
    # `lens 70` sur un capteur de 36 mm couvre ~29° : il faut donc reculer d'un
    # peu plus de deux fois la plus grande dimension pour tout faire tenir.
    d = r * 2.6 + 2.0
    cam.location = (centre[0] + d * 0.55, centre[1] - d * 0.78, centre[2] + h * 0.28)
    suivre = cam.constraints.new(type="TRACK_TO")
    suivre.target = cible
    suivre.track_axis = "TRACK_NEGATIVE_Z"
    suivre.up_axis = "UP_Y"
    scene.camera = cam

    for pos, energie in (((4, -6, 8), 2200), ((-7, -3, 4), 900), ((0, 7, 3), 600)):
        lampe = bpy.data.lights.new("L", type="AREA")
        lampe.energy = energie
        lampe.size = 6
        obj = bpy.data.objects.new("L", lampe)
        obj.location = (pos[0] * r / 2, pos[1] * r / 2, pos[2] * h / 4 + 1)
        obj.rotation_euler = (math.radians(55), 0, math.radians(30))
        scene.collection.objects.link(obj)

    chemin.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(chemin)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"MESHY_APERCU {chemin}")


def argument(nom: str):
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if f"--{nom}" in argv:
        i = argv.index(f"--{nom}")
        return argv[i + 1] if i + 1 < len(argv) else True
    return None


def main():
    seule = argument("only")
    SORTIE.mkdir(parents=True, exist_ok=True)

    for fichier, ids in KITS.items():
        retenus = [i for i in ids if seule is None or i == seule]
        if not retenus:
            continue

        repartir()
        objets = []
        for pid in retenus:
            spec = PIECES[pid]
            source = SOURCES / f"{pid}.glb"
            if not source.exists():
                sys.exit(
                    f"MESHY_MANQUANT {pid} — {source} absent.\n"
                    "Lance d'abord la génération Meshy (voir public/assets/CREDITS.md)."
                )

            obj = importer(source, spec["noeud"])
            brut = triangles(obj)

            # Permet de balayer le budget d'une pièce pour juger la courbe
            # qualité/coût à l'œil — la seule façon honnête de choisir un chiffre
            # que le compteur de triangles ne peut pas justifier tout seul.
            surcharge = argument("budget")
            if surcharge is not None and surcharge is not True:
                spec = dict(spec, budget=int(surcharge))

            mettre_a_l_echelle(obj, spec["axe"], spec["metres"])
            ancrer(obj, spec["ancrage"])
            # 85 % du budget : le chanfrein qui suit rajoute des triangles, et
            # décimer après lui mangerait le chanfrein.
            decimer(obj, int(spec["budget"] * 0.85) if spec["chanfrein"] else spec["budget"])
            if spec["chanfrein"]:
                chanfreiner(obj)
            peindre(obj, spec["couleur"])

            final = triangles(obj)
            if final > spec["budget"]:
                sys.exit(f"MESHY_BUDGET {pid} — {final} > {spec['budget']} triangles")
            print(
                f"MESHY_PIECE {pid:<22} {brut:>7} -> {final:>5} tri "
                f"({100 * final / brut:.1f} %)  {spec['ancrage']:<8} {spec['metres']:.2f} m"
            )
            objets.append(obj)

        if not objets:
            continue
        cible = SORTIE / fichier
        exporter(objets, cible)
        print(f"MESHY_KIT   {fichier}  {len(objets)} pièce(s)")
        print(f"MESHY_POIDS {cible.stat().st_size} octets -> {cible.relative_to(ROOT)}")

        if argument("apercu") is not None:
            rendre_apercu(objets, ROOT / ".captures" / f"apercu-{Path(fichier).stem}.png")


if __name__ == "__main__":
    main()
