"""
Ramène une pièce en volume aux cotes et au budget du musée.

    blender --background --python tools/blender/build-sculptures.py -- \
        bavette "/chemin/vers/Bavette Catnap Texture.glb"

Produit `public/assets/sculptures/<id>.glb`.

── Pourquoi ──

Un générateur de modèles 3D produit du maillage de RENDU : la source de Bavette
pèse 1 954 738 triangles et 6,5 Mo de cartes 2048², pour un objet vu entre 1,5 et
21 m. Le budget géométrique du musée entier est de 1 000 000 (spec parent §9.5),
et la vue la plus chère en consomme déjà ~938 000 : posée brute, cette seule
pièce doublerait le budget de la scène.

18 000 est un chiffre REGARDÉ, pas estimé — trois décimations rendues de face à
2 m, œil à 1,62 m. À 8 000 le plaid et la lisse du fauteuil montrent des facettes
franches ; à 40 000 l'écart avec 18 000 est invisible pour 2,2 fois le coût.

Même méthode et même leçon que `decimate-plants.py` : « 6 000 était BEAUCOUP trop
bas, et le défaut ne se voyait pas dans les chiffres — l'arbre sort en
SQUELETTE ». Un budget de triangles ne se choisit pas dans un tableur.

── Ce que le script GARANTIT, et dont le reste du code dépend ──

  1. l'échelle est RÉELLE — la source est normalisée dans une boîte de deux
     unités, donc son échelle ne veut rien dire ;
  2. l'origine est AU SOL et centrée en plan — c'est le point d'ancrage que
     `domain/sculptures.ts` calcule, la convention du kit de props ;
  3. la face avant regarde +Z — c'est la convention de `yawDeFacing()`.

  L'ORDRE de ces étapes n'est pas indifférent : la décimation passe AVANT
  l'échelle et l'ancrage. Un `COLLAPSE` déplace les sommets de bord — mesuré :
  décimer après ancrage rendait une hauteur de 0,903 m au lieu des 0,900 m
  imposés et une base 3 mm sous le sol. L'emprise qui sert au facteur d'échelle
  doit être celle du maillage RÉELLEMENT exporté.

Déterministe : aucun aléa, aucune horloge.
"""

import sys
from pathlib import Path

import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[2]
SORTIE = ROOT / "public" / "assets" / "sculptures"

# Budget de triangles, cote maximale des cartes, hauteur réelle et rotation de
# mise en face, PAR PIÈCE.
#
# `front_yaw` est en degrés autour de Z (l'axe vertical de Blender), appliqué
# AVANT l'export. Il amène la face avant de la pièce sur −Y de Blender, qui
# devient +Z après l'export Y-up — la convention de `yawDeFacing()`. Zéro quand
# la source est déjà dans le bon sens, ce qui est le cas de Bavette : vérifié en
# rendant les quatre quarts de tour de la source.
PIECES = {
    "bavette": {
        "triangles": 18_000,
        "textures": 1024,
        "hauteur": 0.90,
        "front_yaw": 0.0,
    },
}

# En dessous, décimer abîme plus qu'il n'allège : un maillage déjà économe n'a
# pas d'arêtes courtes à effondrer, et le collapse attaque directement sa forme.
PLANCHER = 1_200


def triangles(obj) -> int:
    """Triangles réels, quads compris : une face de n côtés en vaut n − 2."""
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def emprise(objets):
    """Bornes monde, transformations de nœud comprises. Blender est Z-up."""
    xs, ys, zs = [], [], []
    for o in objets:
        for coin in o.bound_box:
            p = o.matrix_world @ mathutils.Vector(coin)
            xs.append(p.x)
            ys.append(p.y)
            zs.append(p.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def redimensionner_textures(cote: int) -> None:
    """
    Ramène chaque carte à `cote` pixels de côté au plus.

    2048² pour une pièce d'un mètre vue à 1,5 m est un déséquilibre : à ce
    cadrage la carte est échantillonnée bien en dessous, et le reste n'est que
    de la VRAM et du temps de téléchargement. 1024 et non 512 — le réglage des
    plantes — parce que celle-ci se regarde de près, et que c'est tout l'objet
    d'une pièce exposée.
    """
    for img in bpy.data.images:
        if max(img.size) <= cote:
            continue
        avant = tuple(img.size)
        facteur = cote / max(avant)
        img.scale(max(1, int(avant[0] * facteur)), max(1, int(avant[1] * facteur)))
        print(f"SCULPT_TEX {img.name:22} {avant[0]}×{avant[1]} -> {img.size[0]}×{img.size[1]}")


def construire(identifiant: str, source: Path) -> None:
    reglage = PIECES.get(identifiant)
    if reglage is None:
        print(f"SCULPT_INCONNUE {identifiant} — ajoute-la à PIECES")
        sys.exit(1)
    if not source.exists():
        print(f"SCULPT_MANQUANTE {source}")
        sys.exit(1)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    objets = [o for o in bpy.data.objects if o.type == "MESH"]
    if not objets:
        print("SCULPT_VIDE aucun maillage importé")
        sys.exit(1)

    depart = sum(triangles(o) for o in objets)

    # 1. LA MISE EN FACE, d'abord : elle change l'emprise, donc elle doit
    #    précéder le recentrage.
    if reglage["front_yaw"] != 0.0:
        for o in objets:
            o.rotation_euler.rotate_axis("Z", reglage["front_yaw"] * 3.14159265358979 / 180)
    bpy.context.view_layer.update()

    # 2. LA DÉCIMATION, ensuite — et avant l'échelle et l'ancrage : un
    #    `COLLAPSE` déplace les sommets de bord, donc l'emprise mesurée APRÈS
    #    décimation n'est pas celle d'AVANT. La calculer sur le maillage encore
    #    plein ferait rater la hauteur imposée et laisserait la base flotter au
    #    lieu de toucher le sol. Un budget par PIÈCE et non par objet : la
    #    pièce est ce qu'on expose, et c'est son total qui compte dans le
    #    budget de la scène.
    for o in objets:
        depart_obj = triangles(o)
        if depart_obj <= reglage["triangles"]:
            continue
        part = max(PLANCHER, int(reglage["triangles"] * depart_obj / depart))
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new(name="Allegement", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = part / depart_obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.update()

    # 3. L'ÉCHELLE RÉELLE, sur le maillage RÉELLEMENT exporté. Z est la
    #    verticale de Blender.
    (_, _), (_, _), (z0, z1) = emprise(objets)
    facteur = reglage["hauteur"] / (z1 - z0)
    for o in objets:
        o.scale = (facteur, facteur, facteur)
    bpy.context.view_layer.update()

    # 4. L'ANCRAGE : centré en X et Y, base posée sur Z = 0.
    (x0, x1), (y0, y1), (z0, z1) = emprise(objets)
    for o in objets:
        o.location = (
            o.location.x - (x0 + x1) / 2,
            o.location.y - (y0 + y1) / 2,
            o.location.z - z0,
        )
    bpy.context.view_layer.update()

    redimensionner_textures(reglage["textures"])

    SORTIE.mkdir(parents=True, exist_ok=True)
    fichier = SORTIE / f"{identifiant}.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(fichier),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )

    arrive = sum(triangles(o) for o in objets)
    (x0, x1), (y0, y1), (z0, z1) = emprise(objets)
    print(
        f"SCULPT {identifiant} : {depart} -> {arrive} tri "
        f"({100 * arrive / depart:.2f} %) · {fichier.stat().st_size / 1024:.0f} Ko · "
        f"emprise {x1 - x0:.3f}×{y1 - y0:.3f}×{z1 - z0:.3f} m"
    )


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 2:
        print("usage: … -- <identifiant> <chemin/vers/source.glb>")
        sys.exit(1)
    construire(argv[0], Path(argv[1]))


if __name__ == "__main__":
    main()
