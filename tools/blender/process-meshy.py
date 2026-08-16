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

#
# ⚠️ `axe` vaut "z" PARTOUT, et ce n'est pas de la paresse.
#
# `mettre_a_l_echelle` met l'ÉTENDUE sur cet axe à `metres`. Meshy n'a aucune
# convention d'orientation dans le plan : selon la pièce, sa longueur tombe sur x
# ou sur y, et il faudrait le vérifier au cas par cas pour chacune des trente.
# La HAUTEUR, elle, est sans ambiguïté après l'import glTF (Blender est Z-up) et
# c'est la cote qu'on connaît vraiment de chaque objet — un banc fait 45 cm
# d'assise, un totem 3 m. On échelonne donc toujours par la hauteur.

BLANC = (0.90, 0.89, 0.87)  # béton blanc, la matière par défaut du bâtiment
ACIER = (0.92, 0.92, 0.93)  # acier peint : à peine plus froid, à peine plus clair

PIECES = {
    # ── Les quatre pièces INSTANCIÉES (museum-kit.glb) ────────────────────
    #
    # ⛔ Leur budget n'est pas un choix de qualité, c'est une multiplication.
    # `measure-props.ts` compte 100 projecteurs, 49 jardinières, 16 socles et
    # 12 bancs à l'écran : un triangle de trop sur le projecteur en vaut CENT.
    # Les quatre pesaient 112 712 triangles ; ces budgets-là les ramènent à
    # 61 020, et c'est cette reprise qui paie une partie du décor.
    #
    # Les HAUTEURS reprennent exactement celles du kit précédent (0,45 / 1,05 /
    # 0,221 / 0,50). Ce n'est pas une coïncidence à préserver, c'est une
    # décision : `domain/props.ts` pose les plantes sur `PROP_METRICS.jardiniere
    # .maxY` et les œuvres au-dessus des socles. Changer ces cotes déplacerait
    # 33 plantes de quelques centimètres, sans qu'aucun test ne s'en plaigne.
    "banc": {
        "noeud": "Banc",
        "axe": "z",
        "metres": 0.45,
        "ancrage": "sol",
        "budget": 700,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "socle": {
        "noeud": "Socle",
        "axe": "z",
        "metres": 1.05,
        "ancrage": "sol",
        "budget": 500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "projecteur": {
        "noeud": "Projecteur",
        "axe": "z",
        "metres": 0.221,
        # Le seul de tout le kit qui PEND : son ancre est son haut.
        "ancrage": "plafond",
        "budget": 260,
        "couleur": ACIER,
        "chanfrein": False,
    },
    "jardiniere": {
        "noeud": "Jardiniere",
        "axe": "z",
        "metres": 0.50,
        "ancrage": "sol",
        "budget": 380,
        "couleur": BLANC,
        "chanfrein": False,
    },

    # ── La structure (musee-fixe.glb) ─────────────────────────────────────
    #
    # La nervure d'atrium : une côte cantilever qui naît du nez de dalle. 4,30 m,
    # soit la hauteur d'étage — elle occupe le vide sur toute sa hauteur, ce qui
    # est le geste.
    "nervure-atrium": {
        "noeud": "NervureAtrium",
        "axe": "z",
        "metres": 4.30,
        "ancrage": "sol",
        # 1 600 et non 550, et le chiffre vient d'un A/B rendu, pas d'un arrondi.
        # À 550 le budget était tenu — et la POINTE était émoussée, les galbes
        # facettés : la décimation attaque le mince en premier, et sur cette
        # pièce le mince EST le sujet. Le compteur de triangles ne pouvait pas le
        # dire ; deux images côte à côte, si.
        "budget": 1600,
        "couleur": BLANC,
        "chanfrein": False,
    },
    # Le panneau de garde-corps nervuré. ⛔ AUCUN collider : `ramp.ts` produit
    # déjà `railingColliders`, et un second jeu rendrait l'escalier
    # infranchissable — le défaut que le commit 47b253f a mis une session à
    # trouver.
    "balustrade-nervuree": {
        "noeud": "BalustradeNervuree",
        "axe": "z",
        "metres": 1.10,
        "ancrage": "sol",
        "budget": 900,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "nervure-lanterneau": {
        "noeud": "NervureLanterneau",
        "axe": "z",
        "metres": 2.60,
        "ancrage": "sol",
        "budget": 700,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "console": {
        "noeud": "Console",
        "axe": "z",
        "metres": 0.60,
        # La seule pièce qui se pose contre une paroi : son ancre est sa face
        # arrière, d'où l'ancrage `mur`.
        "ancrage": "mur",
        "budget": 500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "mat-arborescent": {
        "noeud": "MatArborescent",
        "axe": "z",
        "metres": 4.00,
        "ancrage": "sol",
        "budget": 2500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "suspension-atrium": {
        "noeud": "SuspensionAtrium",
        "axe": "z",
        "metres": 1.30,
        "ancrage": "plafond",
        "budget": 3000,
        "couleur": ACIER,
        "chanfrein": False,
    },
    "sculpture-atrium": {
        "noeud": "SculptureAtrium",
        "axe": "z",
        "metres": 3.00,
        "ancrage": "plafond",
        "budget": 4000,
        "couleur": BLANC,
        "chanfrein": False,
    },

    # ── Le mobilier fixe (musee-fixe.glb) ─────────────────────────────────
    "banque-accueil": {
        "noeud": "BanqueAccueil",
        "axe": "z",
        "metres": 1.10,
        "ancrage": "sol",
        "budget": 2000,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "banc-courbe": {
        "noeud": "BancCourbe",
        "axe": "z",
        "metres": 0.45,
        "ancrage": "sol",
        "budget": 900,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "vitrine": {
        "noeud": "Vitrine",
        "axe": "z",
        "metres": 0.90,
        "ancrage": "sol",
        "budget": 700,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "pupitre-cartel": {
        "noeud": "PupitreCartel",
        "axe": "z",
        "metres": 1.10,
        "ancrage": "sol",
        "budget": 500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "poteau-file": {
        "noeud": "PoteauFile",
        "axe": "z",
        "metres": 1.00,
        "ancrage": "sol",
        "budget": 300,
        "couleur": ACIER,
        "chanfrein": False,
    },
    "corbeille": {
        "noeud": "Corbeille",
        "axe": "z",
        "metres": 0.90,
        "ancrage": "sol",
        "budget": 400,
        "couleur": ACIER,
        "chanfrein": False,
    },
    "portemanteau": {
        "noeud": "Portemanteau",
        "axe": "z",
        "metres": 1.80,
        "ancrage": "sol",
        "budget": 600,
        "couleur": ACIER,
        "chanfrein": False,
    },
    "borne-info": {
        "noeud": "BorneInfo",
        "axe": "z",
        "metres": 1.40,
        "ancrage": "sol",
        "budget": 500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "totem": {
        "noeud": "Totem",
        "axe": "z",
        "metres": 3.00,
        "ancrage": "sol",
        "budget": 400,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "socle-haut": {
        "noeud": "SocleHaut",
        "axe": "z",
        "metres": 1.40,
        "ancrage": "sol",
        "budget": 400,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "socle-bas": {
        "noeud": "SocleBas",
        "axe": "z",
        "metres": 0.35,
        "ancrage": "sol",
        "budget": 350,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "jardiniere-longue": {
        "noeud": "JardiniereLongue",
        "axe": "z",
        "metres": 0.50,
        "ancrage": "sol",
        "budget": 600,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "jardiniere-ronde": {
        "noeud": "JardiniereRonde",
        "axe": "z",
        "metres": 0.80,
        "ancrage": "sol",
        "budget": 500,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "lampadaire": {
        "noeud": "Lampadaire",
        "axe": "z",
        "metres": 1.80,
        "ancrage": "sol",
        "budget": 700,
        "couleur": ACIER,
        "chanfrein": False,
    },

    # ── Le parc (musee-parc.glb) ──────────────────────────────────────────
    "portique": {
        "noeud": "Portique",
        "axe": "z",
        "metres": 5.00,
        "ancrage": "sol",
        "budget": 2000,
        "couleur": BLANC,
        "chanfrein": False,
    },
    # La pièce-repère du parvis : c'est la SEULE qu'on voit en approchant, et la
    # seule à qui l'on donne six mille triangles. Un exemplaire, donc six mille à
    # l'écran — moins qu'un demi-arbre.
    "sculpture-parvis": {
        "noeud": "SculptureParvis",
        "axe": "z",
        "metres": 4.00,
        "ancrage": "sol",
        "budget": 6000,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "banc-parc": {
        "noeud": "BancParc",
        "axe": "z",
        "metres": 0.85,
        "ancrage": "sol",
        "budget": 800,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "borne-parc": {
        "noeud": "BorneParc",
        "axe": "z",
        "metres": 0.90,
        "ancrage": "sol",
        "budget": 300,
        "couleur": BLANC,
        "chanfrein": False,
    },
    "vasque": {
        "noeud": "Vasque",
        "axe": "z",
        "metres": 0.50,
        "ancrage": "sol",
        "budget": 1200,
        "couleur": BLANC,
        "chanfrein": False,
    },
}

# ── Les kits, et pourquoi il y en a trois ─────────────────────────────────
#
# `museum-kit.glb`   les quatre pièces INSTANCIÉES. `PropsLayer` en fait un
#                    `InstancedMesh` par entrée : un lot, N copies, un draw call.
#                    Ce sont les seules assez répétées pour que ça vaille le coup.
# `musee-fixe.glb`   le décor d'architecture, FUSIONNÉ en coordonnées monde par
#                    `decorAssets.ts` : un seul maillage pour tout l'intérieur.
# `musee-parc.glb`   le décor du parc. Séparé du précédent parce qu'il vit à
#                    cinquante mètres : les fusionner ensemble donnerait UNE
#                    boîte englobante allant du hall au fond de la parcelle, que
#                    le culling ne pourrait plus jamais écarter.
KITS = {
    "museum-kit.glb": ["banc", "socle", "projecteur", "jardiniere"],
    "musee-fixe.glb": [
        "nervure-atrium",
        "balustrade-nervuree",
        "nervure-lanterneau",
        "console",
        "mat-arborescent",
        "suspension-atrium",
        "sculpture-atrium",
        "banque-accueil",
        "banc-courbe",
        "vitrine",
        "pupitre-cartel",
        "poteau-file",
        "corbeille",
        "portemanteau",
        "borne-info",
        "totem",
        "socle-haut",
        "socle-bas",
        "jardiniere-longue",
        "jardiniere-ronde",
        "lampadaire",
    ],
    "musee-parc.glb": [
        "portique",
        "sculpture-parvis",
        "banc-parc",
        "borne-parc",
        "vasque",
    ],
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


def lisser(obj):
    """
    Lissage par angle : les faces à moins de 30° partagent leur normale.

    Séparé du chanfrein — il l'accompagnait dans `build-props.py` — parce que
    les deux n'ont ni le même coût ni le même domaine. Celui-ci est GRATUIT,
    ne change aucun sommet, et porte l'essentiel de l'effet sur un maillage
    remaillé : ce sont les normales, pas la géométrie, qui font qu'un galbe se
    lit comme un galbe. On l'applique donc à tout le monde.
    """
    bpy.context.view_layer.objects.active = obj
    if hasattr(bpy.ops.object, "shade_auto_smooth"):
        bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    elif hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True


def chanfreiner(obj, largeur=0.003, segments=2):
    """
    Chanfrein sur toutes les arêtes vives, puis application.

    Repris de `build-props.py` : une arête parfaitement nette ne capte aucune
    lumière et signe le procédural au premier coup d'œil ; 3 mm accrochent un
    filet de spéculaire et suffisent à faire lire l'objet comme un vrai.

    ⚠️ MAIS il ne se transpose PAS tel quel d'un maillage CAO à un maillage
    Meshy, et la mesure est nette. Sur une boîte procédurale, `limit_method =
    ANGLE` à 30° trouve douze arêtes. Sur un banc remaillé par Meshy il en
    trouve des milliers : décimé à 595 triangles, le banc est ressorti à
    **1 438** — un facteur 2,4 — et le garde-fou de budget a refusé le kit.

    Il n'est donc PAS activé par défaut ici. Il ne vaut que sur les pièces
    franchement planes et anguleuses, où l'angle limite ne se déclenche que sur
    les vraies arêtes, et où le budget en tient compte.
    """
    bpy.context.view_layer.objects.active = obj

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


def ecarter(objets, jeu=0.45):
    """
    Aligne les pièces sur une rangée, chacune posée à côté de la précédente.

    Le pas est la LARGEUR RÉELLE de chaque pièce, pas un intervalle constant :
    un pas fixe collerait le totem de 3 m au socle de 40 cm et laisserait un
    trou de deux mètres entre les petites. On veut une planche lisible, pas une
    grille.
    """
    x = 0.0
    for obj in objets:
        xs = [v.co.x for v in obj.data.vertices]
        largeur = max(xs) - min(xs)
        obj.location.x = x + largeur / 2 - (min(xs) + max(xs)) / 2
        x += largeur + jeu


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

    ⚠️ Les pièces sont ÉTALÉES avant le rendu. Toutes sont ancrées à l'origine —
    c'est le contrat de `ancrer` — donc vingt-et-une d'entre elles rendues telles
    quelles donnent un tas illisible où l'on ne juge rien. L'étalement ne touche
    que la POSITION D'OBJET, jamais les données de maillage, et il intervient
    après l'export : le fichier livré n'en sait rien.
    """
    ecarter(objets)
    # ⚠️ `matrix_world` est calculé PARESSEUSEMENT : sans ce rafraîchissement, il
    # rend encore l'identité juste après une écriture de `location`, et le
    # cadrage se calcule alors sur un étalement qui n'a pas eu lieu. Symptôme
    # observé : une planche de vingt-et-une pièces où une seule remplissait
    # l'image, les vingt autres hors champ.
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {
        e.identifier for e in bpy.types.RenderEngine.__subclasses__() if hasattr(e, "identifier")
    } else scene.render.engine
    # Une rangée : large et basse. 900 de haut sur une seule pièce était juste ;
    # sur vingt-et-une, il faut de la largeur, sinon chaque sujet fait 30 px.
    scene.render.resolution_x = 2400 if len(objets) > 3 else 900
    scene.render.resolution_y = 700 if len(objets) > 3 else 900
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("Apercu")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.10, 0.105, 0.12, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

    # Le cadrage se CALCULE sur les bornes réelles ; il ne se devine pas. Une
    # première version posait la caméra à des angles écrits à la main et coupait
    # le haut de la pièce — un aperçu qui ampute son sujet est pire qu'aucun
    # aperçu, parce qu'il a l'air d'en être un.
    # ⚠️ En coordonnées MONDE : `ecarter` vient de déplacer les objets, et des
    # bornes lues sur `v.co` seul ignoreraient l'étalement — la caméra cadrerait
    # la première pièce et couperait les vingt autres.
    points = [o.matrix_world @ v.co for o in objets for v in o.data.vertices]
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    zs = [p.z for p in points]
    centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    h = max(zs) - min(zs)
    largeur = max(xs) - min(xs)
    r = max(largeur, max(ys) - min(ys), h)

    cible = bpy.data.objects.new("Cible", None)
    cible.location = centre
    scene.collection.objects.link(cible)

    cam_data = bpy.data.cameras.new("Apercu")
    cam_data.lens = 70
    if len(objets) > 3:
        # ORTHOGRAPHIQUE sur une rangée. Une perspective donnerait aux pièces du
        # centre une taille et à celles des bords une autre, et la planche
        # cesserait de comparer ce qu'elle prétend comparer. En ortho, une
        # silhouette large de 40 cm à gauche fait exactement les mêmes pixels
        # qu'une silhouette large de 40 cm à droite.
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = largeur * 1.06
    cam = bpy.data.objects.new("Apercu", cam_data)
    scene.collection.objects.link(cam)
    # `lens 70` sur un capteur de 36 mm couvre ~29° : il faut donc reculer d'un
    # peu plus de deux fois la plus grande dimension pour tout faire tenir.
    d = r * 2.6 + 2.0
    if len(objets) > 3:
        # En ortho, la distance ne cadre rien — elle doit seulement rester devant
        # les sujets. On garde un recul franc pour ne rien couper par le plan
        # proche.
        # De FACE, et non de trois quarts : sur une rangée, un angle fait que
        # chaque pièce masque sa voisine. On perd la profondeur, on gagne de
        # pouvoir juger vingt-et-une silhouettes d'un coup — et c'est la
        # silhouette qui dit si la décimation a tenu.
        cam.location = (centre[0], centre[1] - d, centre[2])
    else:
        cam.location = (centre[0] + d * 0.55, centre[1] - d * 0.78, centre[2] + h * 0.28)
    suivre = cam.constraints.new(type="TRACK_TO")
    suivre.target = cible
    suivre.track_axis = "TRACK_NEGATIVE_Z"
    suivre.up_axis = "UP_Y"
    scene.camera = cam

    if len(objets) > 3:
        # ⚠️ Des lampes SURFACIQUES sur une rangée de trente mètres, c'est une
        # planche noire. Elles sont posées relativement à la taille de la scène,
        # donc à soixante mètres des sujets, et l'éclairement décroît en carré
        # de la distance : mesuré, les vingt-et-une pièces sortaient comme des
        # fantômes à peine plus clairs que le fond.
        #
        # Un SOLEIL n'a pas de distance. Il éclaire la pièce du bout de la
        # rangée exactement comme celle du milieu — ce qui est la condition pour
        # que la planche compare vraiment ce qu'elle prétend comparer.
        for rot, energie in (((55, 0, 25), 3.0), ((70, 0, -140), 1.1)):
            lampe = bpy.data.lights.new("S", type="SUN")
            lampe.energy = energie
            lampe.angle = math.radians(6)
            obj = bpy.data.objects.new("S", lampe)
            obj.rotation_euler = tuple(math.radians(a) for a in rot)
            scene.collection.objects.link(obj)
    else:
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
            lisser(obj)
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
