# Assets

Deux régimes, et ils ne se mélangent pas.

## Matières, HDRI, végétation — CC0

Tous en CC0 (domaine public). Aucune attribution n'est requise ; elle est donnée
par correction et pour documenter la provenance.

Récupérés par `node tools/fetch-assets.ts`, non versionnés — sauf les LOD de
végétation, qui exigent Blender et sont donc commités.

| Asset | Source | Licence | Usage |
|---|---|---|---|
| Concrete034 | ambientCG | CC0 | murs extérieurs, dalles, rampes |
| Plaster001 | ambientCG | CC0 | murs de salle, thème classic |
| PaintedPlaster017 | ambientCG | CC0 | murs de salle, thème modern |
| WoodFloor007 | ambientCG | CC0 | sols des salles |
| Terrazzo005 | ambientCG | CC0 | sol du rez-de-chaussée et de l’atrium |
| Metal032 | ambientCG | CC0 | mains courantes, cadres |
| Grass004 | ambientCG | CC0 | pelouse du parc |
| Gravel023 | ambientCG | CC0 | allées et parvis du parc |
| brown_photostudio_02 | Poly Haven | CC0 | carte d'environnement, spéculaire |
| potted_plant_02 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| potted_plant_04 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| calathea_orbifolia_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| anthurium_botany_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| island_tree_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| island_tree_02 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| jacaranda_tree | Poly Haven | CC0 | végétation, décimée dans les LOD |
| shrub_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| shrub_03 | Poly Haven | CC0 | végétation, décimée dans les LOD |

## Mobilier et architecture — généré par Meshy AI

Ces pièces ne sont **pas CC0**, et elles ne sont **pas reproductibles en CI**.
Elles sortent d'un modèle génératif. Trois fichiers versionnés portent tout ce
qu'il faut pour les refaire :

| Fichier | Ce qu'il porte |
|---|---|
| `tools/meshy/pieces.json` | les **prompts**, un par pièce, plus le suffixe de style commun aux trente. C'est la SOURCE de ces assets |
| `tools/meshy/tasks.json` | les identifiants de tâche Meshy : la provenance, et l'historique des reprises avec leur motif |
| `tools/meshy/reference/` | les images qui ont servi à générer la 3D, réduites à 768 px (0,6 Mo au total) |
| `tools/blender/process-meshy.py` | la table `PIECES` : échelle, ancrage, budget de triangles, couleur — ce qu'on FAIT du maillage, pas ce qu'on demande |

Depuis une image de référence, `meshy_image_to_3d` refait un maillage équivalent
pour une vingtaine de crédits ; depuis les seuls prompts, il faut repasser par la
génération d'image.

⚠️ **Meshy ne documente pas la provenance de son entraînement.** Consigné ici
sans être maquillé : c'est une information que quiconque republie ces pièces doit
avoir.

- **Licence** — compte Meshy **payant** : le titulaire du compte possède les
  modèles générés, usage commercial et redistribution compris. Aucune mention
  n'est donc due dans la page publiée. ⚠️ Cette ligne est à revérifier si le
  compte repasse au palier gratuit, qui livre en **CC BY 4.0** et exigerait une
  attribution *dans le site lui-même*, pas seulement ici.
- **Traçabilité** — Meshy ne documente pas les œuvres de son entraînement. La
  géométrie n'est rattachable à aucune source identifiable. C'est un fait qu'on
  consigne, pas une licence qu'on invoque.
- **Reproductibilité** — un rebuild ne repasse PAS par cet outil. Il repasse par
  `meshy_image_to_3d` sur l'image de référence versionnée, puis par
  `blender --background --python tools/blender/process-meshy.py`. C'est
  pourquoi les kits sortis sont commités : la CI n'a ni Blender, ni compte Meshy.

| Pièce | Id | Kit | Rendu | Référence |
|---|---|---|---|---|
| Nervure d'atrium | `nervure-atrium` | musee-fixe.glb | couleur de sommet | `tools/meshy/reference/nervure-atrium.png` |
