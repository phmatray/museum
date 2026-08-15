"""
Allège la végétation Poly Haven et la republie en un seul glTF binaire.

    blender --background --python tools/blender/decimate-plants.py

Lit `public/assets/plants/*.gltf` (récupérés par `tools/fetch-assets.ts`) et
produit `public/assets/plants/plants-lod.glb`.

── Pourquoi ──

Les plantes pesaient 864 000 des 880 000 triangles de la scène — 98 % du budget
géométrique pour 4 espèces. Poly Haven publie des modèles de rendu hors ligne :
une feuille y est un maillage subdivisé, pertinent dans un rendu de studio,
gratuit nulle part ailleurs. À la distance où le visiteur les voit, une feuille
occupe quelques dizaines de pixels.

── Pourquoi le taux n'est pas le même pour tout le monde ──

Un `DECIMATE` en mode COLLAPSE effondre les arêtes les plus courtes. Sur un pot
— une surface de révolution lisse — c'est indolore : la silhouette est portée par
peu d'arêtes longues. Sur une feuille, c'est la silhouette elle-même qui est
faite d'arêtes courtes, et trop effondrer la déchire. On décime donc PAR OBJET,
en regardant sa densité : un maillage très dense supporte un taux plus agressif
parce qu'il part de plus haut.

Ce fichier ne décide pas de ce qui est visible : il ne fait qu'alléger. Le choix
des espèces et leur placement restent dans `domain/props.ts`.

Déterministe : aucun aléa, aucune horloge.
"""

import sys
import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
PLANTES = ROOT / "public" / "assets" / "plants"
SORTIE = PLANTES / "plants-lod.glb"
SORTIE_PARC = PLANTES / "park-lod.glb"

# Les fichiers attendus par `src/scene/propAssets.ts`, dans son ordre.
FICHIERS = [
    "anthurium_botany_01.gltf",
    "calathea_orbifolia_01.gltf",
    "potted_plant_02.gltf",
    "potted_plant_04.gltf",
]

# Les nœuds RÉELLEMENT instanciés dans le musée, espèce par espèce.
#
# Poly Haven livre des planches : `anthurium_botany_01.gltf` contient six sujets
# (_a à _f), `calathea_orbifolia_01.gltf` en contient cinq. Le musée n'en pose
# qu'un par espèce. Importer les autres reviendrait à les décimer, les exporter
# et les télécharger pour ne jamais les afficher — et surtout à leur donner une
# part du budget de triangles, prise sur les sujets qu'on voit vraiment.
#
# Cette liste DOIT rester synchronisée avec `ESPECES_GLB` de propAssets.ts ; un
# test le vérifie plutôt que de compter sur la discipline.
# Deux essences d'arbre et deux d'arbuste. Un parc ne se fait pas avec la
# variete d'un catalogue mais avec la REPETITION d'un petit nombre d'essences —
# c'est ce que fait un vrai dessin de parc, et c'est aussi ce qui permet de
# l'instancier : chaque espece de plus coute un lot d'instances.
#
# `jacaranda_tree` a ete ecarte, et pas par gout. Il pese 3 863 832 triangles et
# refuse de descendre sous 68 691 : ses feuilles sont des ILOTS separes, qu'un
# DECIMATE en mode COLLAPSE ne peut pas fusionner — une feuille deja reduite a
# un quad n'a plus d'arete a effondrer. Il coutait a lui seul onze fois le
# budget des deux autres arbres reunis. Les deux `island_tree` descendent a
# 6 000 sans broncher.
GARDES_PARC = {
    "arbre-01": ["island_tree_01_LOD0"],
    "arbre-02": ["island_tree_02_LOD0"],
    "arbuste-01": ["shrub_01_a"],
    "arbuste-02": ["shrub_03_a"],
}

FICHIERS_PARC = [
    "island_tree_01.gltf",
    "island_tree_02.gltf",
    "shrub_01.gltf",
    "shrub_03.gltf",
]

# Un arbre est vu de plus loin qu'une plante en pot, mais il est BEAUCOUP plus
# grand : sa silhouette occupe plus de pixels, pas moins. On lui en laisse donc
# davantage. Un arbuste, lui, est une masse : sa forme compte, son detail non.
# 6 000 etait BEAUCOUP trop bas, et le defaut ne se voyait pas dans les
# chiffres : a 0,4 % de conservation, les cartes de feuilles — deux triangles
# chacune — sont les premieres a etre effondrees, et l'arbre sort en SQUELETTE.
# Un tronc et des branches nues, sur toute la parcelle. Le budget doit laisser
# de quoi garder les feuilles, qui sont ce qu'on regarde.
#
# ── Révision du 2026-08-15 : 22 000 -> 16 000 ──
#
# Le parc pesait 610 855 triangles à l'écran, soit **64 % de toute la scène**,
# pour 22 arbres vus entre 30 et 80 m derrière un bâtiment — quand le bâtiment
# lui-même en pèse 16 000. Relevé par `node tools/measure-props.ts`, qui compte
# sur les GLB et non sur un commentaire.
#
# Ce n'est pas un plafond qu'on baisse pour éteindre un voyant : c'est le seul
# poste du musée dont le coût soit sans rapport avec ce qu'on regarde. 16 000
# reste 2,7 fois au-dessus du point de rupture mesuré (6 000, où les cartes de
# feuilles s'effondraient et l'arbre sortait en squelette), et libère 132 000
# triangles — de quoi payer tout le décor d'architecture.
#
# Le contrôle n'est pas le compteur, c'est la vue `exterieur` de
# `tools/capture.ts`, en A/B avec le relevé de référence.
#
# ── Révision du 2026-08-16 : 16 000 -> 11 000, et 4 000 -> 2 600 ──
#
# Deuxième passage, pour la même raison et sur la même mesure. Après la vague
# d'ogives le musée était à 993 728 triangles pour un plafond de 1 000 000 :
# 6 272 de marge, quand les vingt-neuf pièces d'architecture qui restent à poser
# en demandent 136 000. Le relevé de `measure-props.ts` disait toujours la même
# chose — le parc pèse 478 841 triangles, soit 58 % de tout ce qui est dessiné,
# pour des sujets vus entre 30 et 80 m.
#
# 11 000 reste 1,8 fois au-dessus du point de rupture mesuré (6 000), et libère
# 135 200 triangles. C'est ce qui paie le décor, et il n'y a aucun autre poste du
# musée où l'on puisse prendre autant sans que le visiteur le voie.
#
# ⚠️ Le seul juge reste l'A/B sur la vue `exterieur` : à 6 000, le COMPTEUR ÉTAIT
# VERT et les arbres étaient des squelettes. Un budget tenu ne dit rien de la
# forme qui reste.
BUDGET_ARBRE = 11_000
BUDGET_ARBUSTE = 2_600

GARDES = {
    "plante-01": ["anthurium_botany_01_a"],
    "plante-02": ["calathea_orbifolia_01_a"],
    # Pas de nœud portant le nom de l'espèce : le sujet est réparti sur ses
    # pièces. `potted_plant_02_dirt` est écarté — un relevé de terreau de
    # 34 600 sommets pour un disque de terre caché par le pot et le feuillage.
    "plante-03": ["potted_plant_02_leaves", "potted_plant_02_pot"],
    "plante-04": ["potted_plant_04_pot", "potted_plant_04_plant", "potted_plant_04_ground"],
}

A_GARDER = {nom for noms in GARDES.values() for nom in noms}
A_GARDER_PARC = {nom for noms in GARDES_PARC.values() for nom in noms}

# Budget de triangles PAR SUJET, toutes ses pièces réunies (pot, feuillage,
# terre).
#
# Par sujet et non pour l'ensemble, parce que c'est le sujet qui est instancié :
# le musée en pose 16 à 21 par espèce, si bien qu'un triangle économisé ici en
# vaut vingt à l'écran. Un budget global masquerait ce facteur et laisserait un
# sujet de 15 800 triangles coûter un quart de million à lui seul — ce qu'il
# faisait.
#
# 3 500 vient de la taille à l'écran, pas d'un arrondi : une plante d'1,20 m vue
# entre 2 et 8 m occupe au plus quelques centaines de pixels de haut. À ce
# cadrage, une feuille reçoit déjà plus de triangles que de pixels.
BUDGET_PAR_SUJET = 3_500

# En dessous, décimer abîme plus qu'il n'allège : un maillage déjà économe n'a
# pas d'arêtes courtes à effondrer, et le collapse attaque directement sa forme.
PLANCHER = 1_200


def repartir():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def importer(chemin: Path, a_garder):
    """Importe un glTF et rend les seuls objets que le musée instancie."""
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(chemin))
    nouveaux = [o for o in bpy.data.objects if o not in avant and o.type == "MESH"]
    gardes = []
    for o in list(nouveaux):
        if o.name in a_garder:
            gardes.append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    return gardes


def triangles(obj) -> int:
    """Triangles réels, quads compris : une face de n côtés en vaut n − 2."""
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def decimer(obj, ratio: float) -> None:
    if ratio >= 1.0:
        return
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name="Allegement", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    # Un `use_collapse_triangulate` laisserait des triangles partout ; l'export
    # glTF triangule de toute façon, autant garder les quads jusque-là — ils
    # donnent au collapse de meilleures arêtes à choisir.
    bpy.ops.object.modifier_apply(modifier=mod.name)


def redimensionner_textures(cote: int = 512) -> None:
    """
    Ramène chaque texture à `cote` pixels de côté au plus.

    Poly Haven livre du 4K : 16 mégapixels par carte pour une plante en pot, là
    où la géométrie vient d'être ramenée à 3 500 triangles. Le déséquilibre est
    absurde — à la distance où le sujet est vu, la carte est échantillonnée bien
    en dessous du 512, et le reste n'est que de la VRAM et du temps de
    téléchargement. C'est ce qui faisait tenir le kit en 8,4 Mo alors que sa
    géométrie ne pèse plus rien.

    `scale` rééchantillonne en place ; l'export GLB embarque ensuite l'image
    réduite. Puissance de deux, pour que le mipmapping reste exact.
    """
    for img in bpy.data.images:
        if img.size[0] <= cote and img.size[1] <= cote:
            continue
        avant = tuple(img.size)
        facteur = cote / max(avant)
        img.scale(max(1, int(avant[0] * facteur)), max(1, int(avant[1] * facteur)))
        print(f"PLANTS_TEX {img.name:34} {avant[0]}×{avant[1]} -> {img.size[0]}×{img.size[1]}")


def traiter(fichiers, gardes, budget, sortie, etiquette):
    """
    Importe, allège, exporte. Un jeu à la fois, dans une scène neuve.

    `budget` est soit un entier — le même plafond pour tous les sujets — soit une
    fonction `espece -> entier`, quand un arbre et un arbuste n'ont pas le même
    droit au détail.
    """
    repartir()
    a_garder = {nom for noms in gardes.values() for nom in noms}

    objets = []
    for nom in fichiers:
        chemin = PLANTES / nom
        if not chemin.exists():
            print(f"{etiquette}_MANQUANT {nom} — lance d'abord `node tools/fetch-assets.ts`")
            sys.exit(1)
        objets.extend(importer(chemin, a_garder))

    if not objets:
        print(f"{etiquette}_VIDE aucun maillage importé")
        sys.exit(1)

    avant = {o.name: triangles(o) for o in objets}
    total_avant = sum(avant.values())
    parNom = {o.name: o for o in objets}

    # Un sujet à la fois : le budget est le sien, pas celui de la planche.
    for espece, noms in gardes.items():
        pieces = [parNom[n] for n in noms if n in parNom]
        if not pieces:
            continue
        plafond = budget(espece) if callable(budget) else budget
        depart = sum(avant[o.name] for o in pieces)
        if depart <= plafond:
            print(f"{etiquette}_SUJET {espece:12} {depart:7} tri — sous budget, intact")
            continue

        # Répartition PROPORTIONNELLE entre les pièces d'un sujet : le feuillage
        # qui pèse les deux tiers reçoit les deux tiers du budget, et toutes
        # subissent donc le même taux. Un budget également réparti massacrerait
        # le feuillage tout en laissant intact le tronc, qui n'est pas le
        # problème.
        facteur = plafond / depart
        for o in pieces:
            d = avant[o.name]
            if d <= PLANCHER:
                continue
            decimer(o, max(PLANCHER, math.floor(d * facteur)) / d)
        arrive = sum(triangles(o) for o in pieces)
        print(f"{etiquette}_SUJET {espece:12} {depart:7} -> {arrive:6} tri "
              f"({100 * arrive / depart:.0f} %)")

    redimensionner_textures()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(sortie),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )

    total_apres = sum(triangles(o) for o in objets)
    print(f"{etiquette}_TOTAL {total_avant} -> {total_apres} triangles "
          f"({100 * total_apres / total_avant:.1f} %)")
    print(f"{etiquette}_POIDS {sortie.stat().st_size} octets -> {sortie.relative_to(ROOT)}")


def main():
    traiter(FICHIERS, GARDES, BUDGET_PAR_SUJET, SORTIE, "PLANTS")
    # Le parc dans une scène SÉPARÉE : mêler cinq arbres aux quatre plantes
    # d'intérieur dans un seul fichier forcerait le navigateur à décoder les
    # arbres pour afficher une salle, et réciproquement.
    traiter(
        FICHIERS_PARC,
        GARDES_PARC,
        lambda espece: BUDGET_ARBRE if espece.startswith("arbre") else BUDGET_ARBUSTE,
        SORTIE_PARC,
        "PARK",
    )


if __name__ == "__main__":
    main()
