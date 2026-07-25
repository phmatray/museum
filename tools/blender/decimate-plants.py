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


def importer(chemin: Path):
    """Importe un glTF et rend les seuls objets que le musée instancie."""
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(chemin))
    nouveaux = [o for o in bpy.data.objects if o not in avant and o.type == "MESH"]
    gardes = []
    for o in list(nouveaux):
        if o.name in A_GARDER:
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


def main():
    repartir()

    objets = []
    for nom in FICHIERS:
        chemin = PLANTES / nom
        if not chemin.exists():
            print(f"PLANTS_MANQUANT {nom} — lance d'abord `node tools/fetch-assets.ts`")
            sys.exit(1)
        objets.extend(importer(chemin))

    if not objets:
        print("PLANTS_VIDE aucun maillage importé")
        sys.exit(1)

    avant = {o.name: triangles(o) for o in objets}
    total_avant = sum(avant.values())
    parNom = {o.name: o for o in objets}

    # Un sujet à la fois : le budget est le sien, pas celui de la planche.
    for espece, noms in GARDES.items():
        pieces = [parNom[n] for n in noms if n in parNom]
        if not pieces:
            continue
        depart = sum(avant[o.name] for o in pieces)
        if depart <= BUDGET_PAR_SUJET:
            print(f"PLANTS_SUJET {espece:10} {depart:6} tri — sous budget, intact")
            continue

        # Répartition PROPORTIONNELLE entre les pièces du sujet : le feuillage
        # qui pèse les deux tiers reçoit les deux tiers du budget, et toutes
        # subissent donc le même taux. Un budget également réparti massacrerait
        # le feuillage tout en laissant intact le pot, qui n'est pas le problème.
        facteur = BUDGET_PAR_SUJET / depart
        for o in pieces:
            d = avant[o.name]
            if d <= PLANCHER:
                continue
            decimer(o, max(PLANCHER, math.floor(d * facteur)) / d)
        arrive = sum(triangles(o) for o in pieces)
        print(f"PLANTS_SUJET {espece:10} {depart:6} -> {arrive:5} tri "
              f"({100 * arrive / depart:.0f} %)")

    apres = {o.name: triangles(o) for o in objets}
    total_apres = sum(apres.values())

    redimensionner_textures()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(SORTIE),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )

    for nom in sorted(avant, key=lambda n: -avant[n]):
        part = 100 * apres[nom] / avant[nom] if avant[nom] else 100
        print(f"PLANTS_OBJ {nom:38} {avant[nom]:7} -> {apres[nom]:6} tri  ({part:5.1f} %)")
    print(f"PLANTS_TOTAL {total_avant} -> {total_apres} triangles "
          f"({100 * total_apres / total_avant:.1f} %)")
    print(f"PLANTS_POIDS {SORTIE.stat().st_size} octets -> {SORTIE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
