/**
 * Le CATALOGUE des modèles : quels fichiers, quels nœuds, pour quel identifiant.
 *
 * ── Pourquoi ces tables ne vivent plus dans les chargeurs ──
 *
 * Ce sont des DONNÉES — des noms de nœuds et des chemins relatifs — et elles
 * n'ont besoin ni de `three`, ni de React, ni de Vite. Elles vivaient pourtant
 * dans `propAssets.ts` et `parkAssets.ts`, qui importent tous deux `three` et
 * lisent `import.meta.env`. Conséquence concrète, découverte en écrivant
 * `tools/measure-props.ts` : un outil Node qui veut seulement savoir quel nœud
 * porte le banc devait tirer le moteur de rendu entier, et `tsc -b` le refusait
 * — `tsconfig.node.json` ne connaît pas `import.meta.env`, et il a raison de ne
 * pas le connaître.
 *
 * La réponse n'était pas d'élargir la configuration Node jusqu'à faire entrer
 * Vite dedans : c'était de reconnaître que la frontière était au bon endroit et
 * que le catalogue, lui, était du mauvais côté.
 *
 * `propAssets.ts` et `parkAssets.ts` réexportent tout ce qui suit : aucun
 * consommateur existant ne change d'import.
 *
 * ⚠️ Ces tables sont un CONTRAT avec Blender. Les noms doivent correspondre à ce
 * que `tools/blender/decimate-plants.py` écrit dans ses fichiers ; des tests le
 * vérifient plutôt que de compter sur la discipline, parce qu'un nom qui ne
 * correspond pas ne provoque aucune erreur — le sujet disparaît simplement de la
 * scène, avec un avertissement en console que personne ne lit.
 */
import type { PropId } from '../domain/props'
import type { EspeceParc } from '../domain/park'
import type { DecorId } from '../domain/decor'

// ── Chemins ──────────────────────────────────────────────────────────────
//
// Tous RELATIFS : le site vit sous `/<dépôt>/` sur GitHub Pages, et un chemin
// absolu y donne un 404 silencieux.

export const KIT_PATH = 'assets/props/museum-kit.glb'
export const PLANTS_LOD = 'assets/plants/plants-lod.glb'
export const PARK_LOD = 'assets/plants/park-lod.glb'
export const DRACO_PATH = 'draco/'

/**
 * Le décor, produit par `tools/blender/process-meshy.py`.
 *
 * DEUX fichiers, et la séparation n'est pas un rangement : `decorAssets.ts`
 * fusionne chaque kit en un maillage unique, donc en une seule boîte englobante.
 * Mettre le parc et l'intérieur dans le même donnerait une boîte allant du hall
 * au fond de la parcelle, que le culling ne pourrait plus jamais écarter.
 */
export const DECOR_KIT_PATH = 'assets/props/musee-fixe.glb'
export const DECOR_PARC_PATH = 'assets/props/musee-parc.glb'

/**
 * Le nœud du kit de décor qui porte chaque pièce.
 *
 * ⚠️ Meshy sort ses nœuds ANONYMES : ce nom naît dans la table `PIECES` de
 * `process-meshy.py`, et nulle part ailleurs. Les deux tables sont donc deux
 * listes séparées par une frontière de langage, exactement comme `GARDES` et
 * `ESPECES_GLB` — et un test les rapproche, parce qu'un nom qui ne correspond
 * pas ne lève rien : la pièce disparaît de la scène avec un avertissement.
 */
export const NOEUDS_DU_DECOR: Record<string, DecorId> = {
  // musee-fixe.glb
  NervureAtrium: 'nervure-atrium',
  MatArborescent: 'mat-arborescent',
  NervureLanterneau: 'nervure-lanterneau',
  Console: 'console',
  SculptureAtrium: 'sculpture-atrium',
  SuspensionAtrium: 'suspension-atrium',
  BanqueAccueil: 'banque-accueil',
  Totem: 'totem',
  BorneInfo: 'borne-info',
  PoteauFile: 'poteau-file',
  Portemanteau: 'portemanteau',
  Corbeille: 'corbeille',
  BancCourbe: 'banc-courbe',
  PupitreCartel: 'pupitre-cartel',
  SocleHaut: 'socle-haut',
  SocleBas: 'socle-bas',
  Vitrine: 'vitrine',
  Lampadaire: 'lampadaire',
  JardiniereLongue: 'jardiniere-longue',
  JardiniereRonde: 'jardiniere-ronde',
}

/**
 * Les nœuds du kit du PARC. Même contrat, autre fichier.
 *
 * ⚠️ `BalustradeNervuree` est dans `musee-fixe.glb` et n'apparaît dans AUCUNE de
 * ces deux tables : elle attend l'escalier sculpté, qui n'existe pas encore. Un
 * nœud présent dans le GLB mais absent d'ici n'est simplement pas chargé — voir
 * `DECOR_IDS`.
 */
export const NOEUDS_DU_PARC: Record<string, DecorId> = {
  Portique: 'portique',
  SculptureParvis: 'sculpture-parvis',
  BancParc: 'banc-parc',
  BorneParc: 'borne-parc',
  Vasque: 'vasque',
}

// ── Mobilier ─────────────────────────────────────────────────────────────

/**
 * Le nœud du kit qui porte chaque prop.
 *
 * Les noms viennent du fichier Blender, pas d'une convention : les lire ici
 * plutôt que de se fier à l'ordre des nœuds fait qu'un remaniement du kit casse
 * bruyamment au chargement au lieu d'intervertir silencieusement le banc et le
 * socle.
 */
export const NOEUDS_DU_KIT: Record<string, PropId> = {
  Banc: 'banc',
  Socle: 'socle',
  Projecteur: 'projecteur',
  Jardiniere: 'jardiniere',
}

// ── Végétation d'intérieur ───────────────────────────────────────────────

export interface EspeceGlb {
  id: PropId
  /**
   * Les nœuds du sujet dans `plants-lod.glb`. Plusieurs quand le sujet est
   * réparti sur ses pièces — pot, feuillage, terre.
   *
   * DOIT rester synchronisée avec `GARDES` de `tools/blender/decimate-plants.py`,
   * qui décide de ce que le fichier contient. Un test le vérifie.
   */
  noeuds: readonly string[]
}

/**
 * Les quatre espèces, et le spécimen retenu dans chaque fichier.
 *
 * Poly Haven livre plusieurs sujets par fichier (`_a`, `_b`, `_c`…) : ce sont
 * des individus distincts du même relevé photogrammétrique, pas des niveaux de
 * détail. On en choisit UN par espèce — celui dont la silhouette est la plus
 * franche — parce que chaque géométrie retenue coûte un lot d'instances.
 *
 * Deux de ces quatre modèles sont des planches BOTANIQUES : le sujet s'arrête à
 * la motte, sans contenant. `domain/props.ts` leur adjoint une jardinière (voir
 * `ESPECES` et son drapeau `autoportante`), sans quoi le feuillage flotterait à
 * quelques centimètres du sol.
 */
export const ESPECES_GLB: readonly EspeceGlb[] = [
  { id: 'plante-01', noeuds: ['anthurium_botany_01_a'] },
  { id: 'plante-02', noeuds: ['calathea_orbifolia_01_a'] },
  { id: 'plante-03', noeuds: ['potted_plant_02_leaves', 'potted_plant_02_pot'] },
  {
    id: 'plante-04',
    noeuds: ['potted_plant_04_pot', 'potted_plant_04_plant', 'potted_plant_04_ground'],
  },
]

// ── Végétation du parc ───────────────────────────────────────────────────

/**
 * Les nœuds de chaque essence dans `park-lod.glb`.
 *
 * DOIT rester synchronisée avec `GARDES_PARC` de `decimate-plants.py`, qui
 * décide de ce que le fichier contient. Un test le vérifie plutôt que de compter
 * sur la discipline.
 */
export const ESPECES_PARK_GLB: readonly { id: EspeceParc; noeuds: readonly string[] }[] = [
  { id: 'arbre-01', noeuds: ['island_tree_01_LOD0'] },
  { id: 'arbre-02', noeuds: ['island_tree_02_LOD0'] },
  { id: 'arbuste-01', noeuds: ['shrub_01_a'] },
  { id: 'arbuste-02', noeuds: ['shrub_03_a'] },
]
