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
    """
    blanc = matiere("Prop_SocleBlanc", (0.90, 0.89, 0.87), 0.75)
    s = cube("Socle", (0.45, 0.45, 1.05), (0, 0, 0.525))
    s.data.materials.append(blanc)
    chanfreiner(s, largeur=0.003)
    return s


def projecteur():
    """
    Projecteur sur rail — PUREMENT VISUEL.

    Il n'émet aucune lumière : le §9.2 interdit une source par œuvre, et
    l'éclairage des toiles est peint dans le matériau de mur. Mais un plafond de
    musée sans rail de projecteurs se remarque immédiatement. C'est un objet qui
    justifie visuellement une lumière qui n'existe pas.
    """
    metal = matiere("Prop_AcierNoir", (0.08, 0.08, 0.09), 0.42, metallique=0.85)
    verre = matiere("Prop_Reflecteur", (0.92, 0.90, 0.82), 0.15, metallique=0.7)

    corps = cube("corps", (0.09, 0.09, 0.20), (0, 0, -0.10))
    corps.data.materials.append(metal)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.055, depth=0.02, location=(0, 0, -0.205))
    lentille = bpy.context.active_object
    lentille.name = "lentille"
    lentille.data.materials.append(verre)

    tige = cube("tige", (0.03, 0.03, 0.06), (0, 0, 0.03))
    tige.data.materials.append(metal)

    p = fusionner([corps, lentille, tige], "Projecteur")
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
    return ext


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
