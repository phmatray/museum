"""
LOT 8 — Kit de props de musée, généré par Blender en headless.

    blender --background --python tools/blender/build-props.py

Produit `public/assets/props/museum-kit.glb` : un seul fichier glTF binaire
contenant plusieurs objets nommés, que le générateur instancie dans les salles.

POURQUOI BLENDER ET PAS DU PROCÉDURAL DANS THREE.JS
Ces pièces ont besoin de chanfreins sur toutes leurs arêtes vives. Une arête
parfaitement nette ne capte aucune lumière et signe le procédural au premier
coup d'œil ; un chanfrein de 3 mm accroche un filet de spéculaire et suffit à
faire lire l'objet comme un vrai. Le faire à la main dans BufferGeometry pour
chaque pièce serait long et illisible — le modificateur Bevel le fait ici en une
ligne, et le résultat est figé dans un glTF qu'on ne recalcule plus jamais.

POURQUOI PAS DE MCP
Ce script tourne dans l'Action GitHub. Un MCP suppose une instance Blender
ouverte avec un addon connecté : irréproductible en CI. Le MCP sert la
modélisation exploratoire, pas un pipeline de build.

Déterministe : aucune valeur aléatoire, aucune horloge. Deux exécutions
produisent le même fichier.
"""

import sys
import math
from pathlib import Path

import bpy
import bmesh

# Racine du dépôt : le script est dans tools/blender/
ROOT = Path(__file__).resolve().parents[2]
SORTIE = ROOT / "public" / "assets" / "props"


def repartir():
    """Repart d'une scène vide. `--background` ne garantit pas un fichier neuf."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def chanfreiner(obj, largeur=0.003, segments=2):
    """
    Chanfrein sur toutes les arêtes vives, puis application.

    On applique le modificateur plutôt que de le laisser en pile : l'export glTF
    évalue bien les modificateurs, mais un maillage figé rend le fichier
    inspectable et le résultat indépendant de la version de Blender.
    """
    bpy.context.view_layer.objects.active = obj

    # `harden_normals` exige des normales personnalisées. Jusqu'à Blender 4.0
    # elles venaient de `mesh.use_auto_smooth` ; l'attribut a été SUPPRIMÉ en
    # 4.1 au profit de l'opérateur `shade_auto_smooth`. On tente le moderne, on
    # retombe sur l'ancien, et si aucun n'existe on renonce au durcissement
    # plutôt que de planter — le chanfrein seul fait déjà l'essentiel du travail.
    normales_dures = False
    if hasattr(bpy.ops.object, "shade_auto_smooth"):
        bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
        normales_dures = True
    elif hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True
        normales_dures = True

    mod = obj.modifiers.new(name="Chanfrein", type="BEVEL")
    mod.width = largeur
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    mod.harden_normals = normales_dures
    bpy.ops.object.modifier_apply(modifier=mod.name)


def matiere(nom, couleur, rugosite, metallique=0.0):
    """
    Matériau PBR minimal, exporté tel quel dans le glTF.

    Les valeurs comptent : un banc de musée en chêne huilé n'est pas rugueux à
    0.9 (ça le rend crayeux) ni à 0.2 (ça le rend verni). 0.55 lit comme du bois
    travaillé.
    """
    m = bpy.data.materials.get(nom) or bpy.data.materials.new(nom)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*couleur, 1.0)
    bsdf.inputs["Roughness"].default_value = rugosite
    bsdf.inputs["Metallic"].default_value = metallique
    return m


def cube(nom, taille, position):
    """Pavé droit centré sur `position`, de dimensions `taille` (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    o = bpy.context.active_object
    o.name = nom
    o.scale = taille
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def cylindre(nom, rayon, hauteur, position, segments=16, rotation=(0, 0, 0)):
    """
    Cylindre à faible comptage de segments.

    Le défaut de Blender est 32 : c'est le double de ce qu'un objet de onze
    centimètres, vu à trois mètres cinquante, peut montrer. Seize segments
    donnent un contour dont l'œil ne lit pas les facettes à cette distance, et
    le chanfrein qui suit accroche déjà la lumière sur l'arête de bouche.
    """
    bpy.ops.mesh.primitive_cylinder_add(
        radius=rayon, depth=hauteur, location=position, vertices=segments, rotation=rotation
    )
    o = bpy.context.active_object
    o.name = nom
    return o


def fusionner(objets, nom):
    """Fusionne en un seul objet — un prop = un mesh = une instance à l'usage."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objets[0]
    bpy.ops.object.join()
    fusion = bpy.context.active_object
    fusion.name = nom
    return fusion


# ── Les props ────────────────────────────────────────────────────────────


def banc():
    """
    Banc de musée : assise en chêne sur deux piètements métalliques.
    1,60 m × 0,42 m × 0,45 m — les proportions d'un vrai banc de galerie.
    """
    bois = matiere("Prop_Chene", (0.42, 0.30, 0.19), 0.55)
    metal = matiere("Prop_Acier", (0.24, 0.25, 0.27), 0.35, metallique=0.9)

    assise = cube("assise", (1.60, 0.42, 0.06), (0, 0, 0.42))
    assise.data.materials.append(bois)

    pieds = []
    for signe in (-1, 1):
        p = cube(f"pied{signe}", (0.06, 0.36, 0.39), (signe * 0.6, 0, 0.195))
        p.data.materials.append(metal)
        pieds.append(p)

    b = fusionner([assise, *pieds], "Banc")
    chanfreiner(b, largeur=0.004)
    return b


def socle():
    """
    Socle d'exposition, blanc mat. 0,45 × 0,45 × 1,05 m — hauteur qui met un
    petit objet à hauteur de regard sans dominer la salle.

    ── Le retrait de pied, et pourquoi il change tout ──

    Vu dans Blender pour la première fois, ce socle était un carton : un pavé
    blanc posé à même le sol, sans aucun détail entre la matière et le plancher.
    Le socle de musée réel ne touche jamais le sol par sa face pleine — il
    repose sur une plinthe en retrait de quinze millimètres, et cette ombre
    continue de quatre centimètres le fait FLOTTER. C'est le seul détail qui
    sépare un socle d'exposition d'une caisse, et il coûte huit faces.

    Le retrait doit rester dans l'ombre propre de l'objet : à quinze
    millimètres, aucune lumière rasante de la salle n'y entre, et la ligne se
    lit noire depuis n'importe quel angle. Plus profond, elle deviendrait une
    fente ; moins, elle disparaîtrait sous le chanfrein.
    """
    blanc = matiere("Prop_SocleBlanc", (0.90, 0.89, 0.87), 0.75)
    RETRAIT = 0.015
    H_PLINTHE = 0.04

    corps = cube("corps", (0.45, 0.45, 1.05 - H_PLINTHE), (0, 0, H_PLINTHE + (1.05 - H_PLINTHE) / 2))
    corps.data.materials.append(blanc)

    plinthe = cube(
        "plinthe",
        (0.45 - 2 * RETRAIT, 0.45 - 2 * RETRAIT, H_PLINTHE),
        (0, 0, H_PLINTHE / 2),
    )
    plinthe.data.materials.append(blanc)

    s = fusionner([corps, plinthe], "Socle")
    chanfreiner(s, largeur=0.003)
    return s


def projecteur():
    """
    Projecteur sur rail — PUREMENT VISUEL.

    Il n'émet aucune lumière : le §9.2 interdit une source par œuvre, et
    l'éclairage des toiles est peint dans le matériau de mur. Mais un plafond de
    musée sans rail de projecteurs se remarque immédiatement. C'est un objet qui
    justifie visuellement une lumière qui n'existe pas.

    ── L'INCLINAISON est tout ce qui compte ──

    À trois mètres cinquante sous un plafond, cette pièce fait vingt-cinq pixels
    de haut : aucun détail de modelé n'y survit, seule la SILHOUETTE parle. Or
    la version précédente pendait à la verticale — et un cylindre vertical au
    plafond, à cette taille, se lit comme un détecteur de fumée. Un projecteur
    de musée est incliné vers la cimaise ; c'est cette diagonale, et elle seule,
    qui le rend identifiable.

    `poserLeRail` oriente déjà chaque tête pour que son +Z local vise le mur (il
    applique un lacet de `atan2(−normal.x, −normal.z)`). L'inclinaison se fait
    donc ici, en local, vers +Z — et elle est juste dans toutes les salles sans
    que le poseur ait à en connaître l'existence.

    Le corps était aussi un CUBE portant une lentille plus large que lui : la
    tête débordait de son propre fût, ce qui ne ressemblait à rien de connu. Un
    fût cylindrique dont la bouche est légèrement évasée est la forme réelle, et
    elle coûte moins de faces que le cube chanfreiné qu'elle remplace.
    """
    metal = matiere("Prop_AcierNoir", (0.08, 0.08, 0.09), 0.42, metallique=0.85)
    verre = matiere("Prop_Reflecteur", (0.92, 0.90, 0.82), 0.15, metallique=0.7)

    INCLINAISON = math.radians(28)
    L_FUT = 0.155
    Z_PIVOT = -0.062

    # L'embase plaquée au plafond, puis la tige courte qui porte la tête. Les
    # deux restent verticales : c'est l'articulation qui s'incline, pas le rail.
    embase = cylindre("embase", 0.048, 0.014, (0, 0, -0.007))
    embase.data.materials.append(metal)

    tige = cylindre("tige", 0.013, 0.055, (0, 0, -0.0415))
    tige.data.materials.append(metal)

    # La tête. Son axe part du pivot et descend vers le mur ; tout ce qui suit
    # se place le long de cet axe pour rester solidaire quel que soit l'angle.
    dz = -math.cos(INCLINAISON)
    dy = math.sin(INCLINAISON)

    def sur_axe(distance):
        """Point à `distance` du pivot, le long de l'axe de la tête."""
        return (0, dy * distance, Z_PIVOT + dz * distance)

    fut = cylindre("fut", 0.040, L_FUT, sur_axe(L_FUT / 2), rotation=(INCLINAISON, 0, 0))
    fut.data.materials.append(metal)

    # L'évasement de bouche : une bague de huit millimètres, à peine plus large
    # que le fût. Elle donne l'arête vive qui accroche un filet de spéculaire et
    # signe le bord de la tête contre le plafond clair.
    bague = cylindre("bague", 0.047, 0.012, sur_axe(L_FUT - 0.006), rotation=(INCLINAISON, 0, 0))
    bague.data.materials.append(metal)

    # La lentille, EN RETRAIT dans la bouche. À fleur elle brillerait comme un
    # bouton ; enfoncée de dix millimètres, elle ne se voit que depuis l'axe —
    # c'est-à-dire depuis l'œuvre, exactement comme un vrai réflecteur.
    lentille = cylindre(
        "lentille", 0.034, 0.006, sur_axe(L_FUT - 0.014), rotation=(INCLINAISON, 0, 0)
    )
    lentille.data.materials.append(verre)

    p = fusionner([embase, tige, fut, bague, lentille], "Projecteur")
    chanfreiner(p, largeur=0.002)
    return p


def jardiniere():
    """
    Jardinière en béton, pour recevoir les plantes CC0.

    Les pots livrés avec les modèles Poly Haven sont des pots d'intérieur
    domestiques ; une jardinière massive lit « équipement de musée » et donne à
    la végétation une assise à l'échelle du bâtiment.
    """
    beton = matiere("Prop_Beton", (0.62, 0.61, 0.58), 0.82)
    ext = cube("ext", (0.70, 0.70, 0.50), (0, 0, 0.25))
    ext.data.materials.append(beton)

    # Creusement : on retire un volume intérieur pour que la jardinière soit
    # réellement creuse. Un bloc plein se voit dès qu'on la regarde de haut.
    creux = cube("creux", (0.60, 0.60, 0.44), (0, 0, 0.31))
    mod = ext.modifiers.new(name="Creux", type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = creux
    bpy.context.view_layer.objects.active = ext
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(creux, do_unlink=True)

    ext.name = "Jardiniere"
    chanfreiner(ext, largeur=0.005)

    # ── Le substrat, et pourquoi il manquait ──
    #
    # Regardée de près pour la première fois, cette jardinière était un bac gris
    # OUVERT ET VIDE. Un contenant vide ne se lit pas comme du mobilier de
    # musée : il se lit comme du mobilier pas fini. La plante Poly Haven qu'on
    # pose dedans flotte au-dessus d'un trou.
    #
    # Le substrat n'est pas une décoration, c'est ce qui referme l'objet. Il est
    # sombre et très rugueux — une écorce de paillage, pas de la terre humide :
    # sous l'éclairage zénithal du musée, une surface mate sombre disparaît
    # proprement dans l'ombre du bac, alors qu'une terre à 0,6 de rugosité y
    # attraperait un reflet qui trahirait le plan.
    #
    # Il s'arrête sept centimètres sous la lèvre : au ras, on verrait le disque
    # entier depuis toute la salle et le bac perdrait sa profondeur.
    paillis = matiere("Prop_Paillis", (0.13, 0.10, 0.08), 0.95)
    terre = cube("substrat", (0.60, 0.60, 0.02), (0, 0, 0.43))
    terre.data.materials.append(paillis)

    j = fusionner([ext, terre], "Jardiniere")
    return j


PROPS = [banc, socle, projecteur, jardiniere]


def main():
    repartir()
    produits = []
    for fabrique in PROPS:
        o = fabrique()
        produits.append((o.name, len(o.data.polygons)))

    SORTIE.mkdir(parents=True, exist_ok=True)
    chemin = SORTIE / "museum-kit.glb"

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(chemin),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        # Draco divise par ~4 le poids de la géométrie. three.js le décode via
        # DRACOLoader, déjà livré avec le paquet.
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )

    total = sum(n for _, n in produits)
    print("PROPS_OK " + " | ".join(f"{n}:{p}f" for n, p in produits))
    print(f"PROPS_TOTAL {total} faces -> {chemin.relative_to(ROOT)}")
    print(f"PROPS_POIDS {chemin.stat().st_size} octets")


if __name__ == "__main__":
    main()
