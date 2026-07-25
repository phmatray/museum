/**
 * LOT 4 — La bibliothèque de matières (spec §9.4).
 *
 * `io/textures.ts` sait OÙ sont les images et comment les déclarer au GPU. Ce
 * fichier-ci sait à quoi elles doivent RESSEMBLER une fois posées : à quelle
 * échelle, avec quel niveau d'albédo, quelle rugosité, et quoi faire des faces
 * qui ne voient aucune lumière.
 *
 * ── L'échelle, ou pourquoi la répétition se calcule en mètres ──
 *
 * Une répétition exprimée en UV normalisées donne un motif ÉTIRÉ sur les grandes
 * surfaces : le mur d'enceinte de 38 m et la cloison de 7 m montreraient le même
 * nombre de dalles de béton, donc des dalles cinq fois plus larges sur le
 * premier. C'est le défaut qui trahit une texture procédurale au premier coup
 * d'œil, avant même qu'on ait identifié la matière. `repetitionMonde` raisonne
 * donc en MÈTRES : un motif tous les `MOTIF_METRES`, quelle que soit la surface.
 *
 * Il faut pour cela savoir dans quelle unité sont les UV de la géométrie, et
 * elles ne sont PAS les mêmes partout dans ce projet :
 *
 *  - `ExtrudeGeometry` (murs, dalles, toiture) passe par le `WorldUVGenerator`
 *    de three, qui recopie les coordonnées du plan de la `Shape` dans l'UV : les
 *    UV sont déjà en mètres, et la répétition est alors CONSTANTE ;
 *  - `BoxGeometry` (garde-corps) donne un carré unité par face : la répétition
 *    doit être proportionnelle aux dimensions.
 *
 * Les deux chemins produisent la même densité au mètre — c'est l'invariant que
 * les tests vérifient, et il n'y a que ça à vérifier.
 *
 * ── Les faces tournées vers le bas ──
 *
 * Le bâtiment n'a que deux lumières venues d'en haut. Le dessous d'une dalle, la
 * sous-face d'une rampe, l'envers d'une main courante ne reçoivent donc que la
 * couleur « sol » de l'hémisphérique — mesuré à l'écran : une masse NOIRE occupe
 * le bas de la vue d'entrée. Dans la réalité ces faces sont éclairées par le
 * rebond du sol, qui n'existe dans aucun rendu direct. On le PEINT, comme le
 * §9.2 peint les flaques de spot : un terme émissif proportionnel à
 * `max(0, -n.y)`, modulé par l'albédo. Zéro lumière, zéro draw call.
 *
 * ── Mutualisation ──
 *
 * Une texture ne porte qu'une seule répétition : deux surfaces d'échelles
 * différentes exigent deux objets `Texture`. Mais un CLONE partage la `Source`
 * de son maître, donc l'image décodée ET l'unique texture GPU — à condition que
 * les paramètres d'échantillonnage (bouclage, filtres, anisotropie, espace
 * colorimétrique) soient identiques, parce qu'ils entrent dans la clé de cache
 * de three. C'est pour ça que `configurerJeu` les pose sur le maître, une fois,
 * avant tout clonage.
 *
 * Aucun aléa, aucune horloge : deux appels sur la même matière produisent les
 * mêmes réglages, flottant pour flottant.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import * as THREE from 'three'

import type { ThemeId, WallKind } from '../domain/types'
import type { JeuDeCartes, MatiereId } from '../io/textures'
import { abonnerAuxMatieres, chargerMatiere, matiereEnCache } from '../io/textures'

export type { JeuDeCartes, MatiereId } from '../io/textures'

// ── Échelle ──────────────────────────────────────────────────────────────

/**
 * Côté du motif au mur, en mètres. Deux mètres est la maille d'une banche de
 * béton et d'une lame de parquet vue de loin : assez grande pour que le 1K reste
 * net, assez petite pour qu'on lise la répétition comme un appareillage et non
 * comme un papier peint.
 */
export const MOTIF_METRES = 2

export interface OptionsRepetition {
  /** Côté du motif, en mètres. Par défaut `MOTIF_METRES`. */
  motif?: number
  /**
   * Vrai si les UV de la géométrie sont DÉJÀ en mètres — c'est le cas de tout ce
   * qui sort d'`ExtrudeGeometry` dans ce projet (murs, dalles, toiture).
   */
  uvMetriques?: boolean
}

/** En deçà, une surface est du bruit numérique : on ne divise pas par ça. */
const EPS = 1e-6

/**
 * Facteur de répétition d'une surface de `largeur` × `hauteur` mètres.
 *
 * Le raisonnement est en deux temps, et c'est ce qui rend les deux conventions
 * d'UV interchangeables : on décide d'abord combien de motifs doivent tenir sur
 * la surface (`dimension / motif`), puis on divise par l'ÉTENDUE UV de cette
 * surface — 1 pour des UV normalisées, sa dimension en mètres pour des UV
 * métriques. Dans les deux cas la densité au mètre est la même.
 */
export function repetitionMonde(
  largeur: number,
  hauteur: number,
  options: OptionsRepetition = {},
): [number, number] {
  const motif = options.motif ?? MOTIF_METRES
  if (motif <= 0) {
    throw new RangeError(`repetitionMonde: motif non positif (${motif})`)
  }

  // Une surface dégénérée ne doit pas produire un NaN qui contaminerait la
  // matrice UV du matériau, et donc TOUT le maillage.
  const l = Math.max(EPS, Math.abs(largeur))
  const h = Math.max(EPS, Math.abs(hauteur))

  const etendueU = options.uvMetriques ? l : 1
  const etendueV = options.uvMetriques ? h : 1
  return [l / motif / etendueU, h / motif / etendueV]
}

/**
 * Répétition d'une géométrie extrudée, dont les UV sont déjà en mètres. Le
 * raccourci le plus courant du bâtiment : murs, dalles et toiture y passent
 * tous, et aucun n'a besoin de connaître ses propres dimensions.
 */
export function repetitionMetrique(motif: number = MOTIF_METRES): [number, number] {
  return repetitionMonde(1, 1, { motif, uvMetriques: true })
}

// ── Réglages par matière ─────────────────────────────────────────────────

export interface ReglageMatiere {
  /**
   * Gain d'albédo appliqué à la carte de couleur.
   *
   * La carte donne la TEINTE et le grain ; ce gain donne le NIVEAU. Les albédos
   * d'ambientCG sont photographiés sous lumière neutre et tombent autour de 0,5
   * en linéaire — poser une telle carte sur un mur qui valait 0,73 en aplat
   * assombrit tout le bâtiment de 30 %. Le gain rattrape ce niveau sans toucher
   * à la variation, qui est la seule chose qu'on est venu chercher.
   */
  gain: number
  /** Multiplicateur de la carte de rugosité. > 1 dépolit, < 1 rend brillant. */
  roughness: number
  metalness: number
  /**
   * Amplitude du rebond peint sur les faces tournées vers le bas, en multiples
   * de l'albédo. Zéro pour une matière qui n'a pas de sous-face visible.
   */
  rebond: number
  /**
   * Côté du motif de CETTE matière, en mètres.
   *
   * Ce n'est pas un réglage de confort : chaque matière a une taille réelle, et
   * s'en écarter se voit tout de suite. Une banche de béton fait deux mètres et
   * demi, une lame de parquet une trentaine de centimètres de large (soit trois
   * mètres pour la tuile qui en contient dix), un enduit n'a aucune échelle
   * propre — on l'étale donc au maximum pour espacer la répétition, qui est la
   * seule chose qu'on ait à cacher.
   */
  motif: number
  /**
   * Teinte de base, appliquée par `creerMatiere` avant le gain. Sert à corriger
   * la DOMINANTE d'une carte, pas son niveau : le marbre d'ambientCG est
   * légèrement bleuté et, sous un ciel bleu, vire à la glace.
   */
  teinte?: string
}

/**
 * Réglages des six matières.
 *
 * Les gains sont calibrés sur la moyenne mesurée de chaque carte de couleur
 * (`sharp().stats()`), pas au jugé : le béton sort à 184/255 en sRGB, soit 0,48
 * en linéaire, d'où un gain autour de 1,5 pour retrouver un béton clair. Le
 * marbre et le métal montent plus haut — l'un est poli et clair par nature,
 * l'autre est un albédo de métal brossé que le rendu doit sortir du noir.
 */
export const REGLAGE_MATIERE: Record<MatiereId, ReglageMatiere> = {
  beton: { gain: 1.45, roughness: 1, metalness: 0, rebond: 0.24, motif: 2.6 },
  platre: { gain: 1.25, roughness: 1, metalness: 0, rebond: 0.14, motif: 3.2 },
  'platre-peint': { gain: 1.45, roughness: 1, metalness: 0, rebond: 0.14, motif: 3.2 },
  parquet: { gain: 1.2, roughness: 0.9, metalness: 0, rebond: 0.2, motif: 3 },
  // Deux corrections mesurées à l'écran. La carte de rugosité du marbre plafonne
  // à 0,07 : brut, le sol devient un miroir et le bâtiment s'y reflète en
  // double — on le dépolit d'un facteur 2,5. Et son albédo tire vers le bleu
  // (172, 173, 182) : sous un ciel bleu et une hémisphérique bleutée, le
  // rez-de-chaussée virait à la patinoire. Un gain plus sage et une teinte
  // chaude le ramènent à un marbre d'intérieur.
  marbre: {
    gain: 1.3,
    roughness: 2.5,
    metalness: 0,
    rebond: 0.24,
    motif: 2,
    teinte: '#fff3e4',
  },
  /**
   * Le garde-corps de l'atrium. `metalness` était à 0,6 sur une couleur sombre :
   * un métal n'a PAS de diffus, il ne rend que ce qu'il réfléchit, et il ne
   * réfléchissait qu'un dégradé d'ambiance discret — le garde-corps sortait
   * presque noir sur un tiers de la vue d'entrée (constaté à l'écran, lot 3).
   * Un aluminium anodisé de garde-corps est d'abord une surface CLAIRE : on
   * descend la métallicité et on remonte franchement l'albédo.
   */
  metal: { gain: 2.3, roughness: 3.2, metalness: 0.22, rebond: 0.3, motif: 2 },
  // Le parc. Motifs LARGES : une pelouse dont on voit la tuile se répéter tous
  // les deux mètres se lit comme une moquette. À 6 m, la récurrence tombe sous
  // l'horizon de perception depuis la hauteur d'œil.
  herbe: { gain: 1.15, roughness: 1, metalness: 0, rebond: 0, motif: 6 },
  gravier: { gain: 1.35, roughness: 1, metalness: 0, rebond: 0, motif: 3.5 },
}

/**
 * Répétition « naturelle » d'une matière sur une géométrie extrudée.
 *
 * C'est l'appel par défaut de tout le bâtiment : chaque matière porte sa propre
 * échelle réelle, et aucun composant n'a à la connaître.
 */
export function repetitionDeMatiere(id: MatiereId): [number, number] {
  return repetitionMetrique(REGLAGE_MATIERE[id].motif)
}

/**
 * Couleur du rebond peint sous les faces basses. Un gris très légèrement chaud :
 * la lumière qui remonte a rebondi sur le béton et le parquet, jamais sur le
 * ciel. Un rebond bleuté lirait comme une deuxième source, pas comme un rebond.
 */
const COULEUR_REBOND = '#e4ddd0'

/** Clé de cache de programme des matières. Une seule, quelles que soient elles. */
const PROGRAM_CACHE_KEY = 'museum:matiere:v1'

// ── Affectation des matières ─────────────────────────────────────────────

/**
 * Quelle matière pour quel mur.
 *
 * Le mur d'enceinte est du béton banché, y compris vu de l'intérieur : c'est la
 * structure, et un musée contemporain la montre. Les cloisons prennent le plâtre
 * du thème de la salle. La réserve, au niveau −1, reste en béton brut — ce qui
 * est une information sur ce qu'elle est, pas une économie de matière.
 */
export function matiereDeMur(kind: WallKind, theme: ThemeId): MatiereId {
  if (kind === 'outer') return 'beton'
  switch (theme) {
    case 'classic':
      return 'platre'
    case 'vault':
      return 'beton'
    default:
      return 'platre-peint'
  }
}

/**
 * Quelle matière pour la dalle d'un niveau.
 *
 * Le §9.4 attribue le marbre au rez-de-chaussée et à l'atrium : c'est le sol que
 * le visiteur voit en premier et le seul qui reçoive le puits de lumière, donc
 * le seul où un poli sert à quelque chose. Les étages sont en parquet, la réserve
 * en béton.
 */
export function matiereDeDalle(level: number): MatiereId {
  if (level < 0) return 'beton'
  if (level === 0) return 'marbre'
  return 'parquet'
}

// ── Cartes répétées ──────────────────────────────────────────────────────

/**
 * Clone les trois cartes d'une matière à une répétition donnée.
 *
 * Le clone est ce qui permet à deux échelles de coexister sans doubler la VRAM :
 * `Texture.clone()` recopie les réglages mais PARTAGE la `Source`, c'est-à-dire
 * l'image décodée. Comme `configurerJeu` a posé les mêmes paramètres
 * d'échantillonnage sur le maître, les clones tombent sur la même clé de cache
 * et three n'alloue qu'une texture GPU pour tous.
 *
 * La répétition est posée sur les TROIS cartes : depuis r152 chaque carte d'un
 * `MeshStandardMaterial` a sa propre matrice UV, et n'en régler qu'une ferait
 * glisser le relief par rapport à la couleur.
 */
export function repeterJeu(
  jeu: JeuDeCartes,
  repetition: [number, number],
): JeuDeCartes {
  const [rx, ry] = repetition
  const clone = (source: THREE.Texture): THREE.Texture => {
    const carte = source.clone()
    carte.repeat.set(rx, ry)
    carte.needsUpdate = true
    return carte
  }
  return {
    couleur: clone(jeu.couleur),
    normale: clone(jeu.normale),
    rugosite: clone(jeu.rugosite),
  }
}

/** Libère un jeu de clones. Le maître, lui, reste en cache pour la suite. */
export function libererJeu(jeu: JeuDeCartes): void {
  jeu.couleur.dispose()
  jeu.normale.dispose()
  jeu.rugosite.dispose()
}

/**
 * Pose les cartes d'une matière sur un matériau déjà construit.
 *
 * Séparé de la création parce que tous les matériaux du bâtiment ne sont pas
 * créés ici : celui d'un mur vient de `lighting.ts`, qui y peint les flaques de
 * lumière du §9.2 et dont la palette de thème doit rester le niveau d'albédo. On
 * MULTIPLIE donc la couleur existante par le gain plutôt que de l'écraser.
 */
export function appliquerCartes(
  material: THREE.MeshStandardMaterial,
  jeu: JeuDeCartes | null,
  id: MatiereId,
): THREE.MeshStandardMaterial {
  if (!jeu) return material

  const reglage = REGLAGE_MATIERE[id]
  material.map = jeu.couleur
  material.normalMap = jeu.normale
  material.roughnessMap = jeu.rugosite
  material.color.multiplyScalar(reglage.gain)
  material.roughness *= reglage.roughness
  // Ajouter une carte change les `#define` du shader : sans ceci, three garde le
  // programme compilé sans `USE_MAP` et la texture n'apparaît jamais.
  material.needsUpdate = true
  return material
}

// ── Matériau ─────────────────────────────────────────────────────────────

export interface OptionsMatiere {
  /**
   * Amplitude du rebond peint sous les faces basses. Par défaut, celle de la
   * matière. Zéro coupe l'effet sans changer de programme.
   */
  rebond?: number
  /** Teinte multiplicative, en plus du gain de la matière. Blanc par défaut. */
  teinte?: string
}

/**
 * Un `MeshStandardMaterial` texturé, plus le rebond des sous-faces.
 *
 * Le `jeu` peut être `null` : la matière rend alors un aplat de la bonne teinte,
 * ce qui est exactement ce qu'on veut pendant la seconde où les JPEG arrivent —
 * une surface blanche vaut mieux qu'une surface absente, et le matériau sera
 * recompilé avec ses cartes au rendu suivant.
 */
export function creerMatiere(
  id: MatiereId,
  jeu: JeuDeCartes | null,
  options: OptionsMatiere = {},
): THREE.MeshStandardMaterial {
  const reglage = REGLAGE_MATIERE[id]

  const material = new THREE.MeshStandardMaterial({
    color: options.teinte ?? reglage.teinte ?? '#ffffff',
    // Sans carte de rugosité, le multiplicateur devient la rugosité elle-même :
    // on le plafonne pour ne pas sortir du domaine [0, 1] d'un matériau nu.
    roughness: jeu ? 1 : Math.min(1, reglage.roughness),
    metalness: reglage.metalness,
  })

  appliquerCartes(material, jeu, id)
  peindreRebond(material, options.rebond ?? reglage.rebond)
  return material
}

/**
 * Ajoute le rebond du sol sur les faces tournées vers le bas.
 *
 * Le terme est ajouté à `totalEmissiveRadiance` PUIS multiplié par l'albédo,
 * comme les flaques du §9.2 : c'est ce qui distingue un rebond d'un autocollant
 * lumineux. Une sous-face de béton clair remonte, une sous-face sombre reste
 * sombre — exactement ce que fait la lumière.
 *
 * À appeler AVANT la première compilation ; three ne rappelle `onBeforeCompile`
 * que lorsque le programme change.
 */
export function peindreRebond(
  material: THREE.MeshStandardMaterial,
  force: number,
): THREE.MeshStandardMaterial {
  const uniforms = {
    uRebond: { value: force },
    uRebondCouleur: { value: new THREE.Color(COULEUR_REBOND) },
  }
  // three ne republie pas les uniformes d'un `onBeforeCompile` sur le matériau :
  // les exposer ici est le seul moyen de les régler à l'écran, et de les
  // vérifier en test, sans recompiler.
  material.userData.rebond = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vRebondNrm;`,
      )
      // `objectNormal` n'existe qu'après ce chunk. On la passe en MONDE et non en
      // vue : « vers le bas » est une direction du monde, et la lire dans le
      // repère de la caméra ferait tourner le rebond avec le regard.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vRebondNrm = mat3(modelMatrix) * objectNormal;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uRebond;
         uniform vec3  uRebondCouleur;
         varying vec3  vRebondNrm;`,
      )
      // Après ce chunk, `diffuseColor` et `totalEmissiveRadiance` coexistent :
      // le seul point du shader standard où l'on peut ajouter une lumière peinte
      // ET la moduler par l'albédo.
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           float versLeBas = clamp(-normalize(vRebondNrm).y, 0.0, 1.0);
           totalEmissiveRadiance += diffuseColor.rgb * uRebondCouleur * (uRebond * versLeBas);
         }`,
      )
  }

  // Sans cela, three prend la source de `onBeforeCompile` comme clé de cache :
  // une fermeture par matériau, donc un programme par dalle. Le §9 compte les
  // programmes. La clé est APPENDÉE aux `#define` par three, pas substituée : les
  // variantes avec et sans carte restent bien deux programmes distincts.
  material.customProgramCacheKey = () => PROGRAM_CACHE_KEY

  return material
}

// ── Accès React ──────────────────────────────────────────────────────────

/**
 * Les cartes d'une matière, à mesure qu'elles arrivent.
 *
 * Pas de `Suspense` : suspendre ferait disparaître le bâtiment entier le temps
 * que six matières se téléchargent, alors que le rendu en aplat est parfaitement
 * regardable en attendant. `null` tant que rien n'est là, puis les cartes.
 *
 * `id` accepte `null` pour qu'un composant puisse renoncer à une matière sans
 * appeler le hook conditionnellement.
 */
export function useCartes(
  id: MatiereId | null,
  repetition: [number, number],
): JeuDeCartes | null {
  // Le cache de `io/textures` est un système extérieur à React : on s'y ABONNE,
  // plutôt que de recopier son contenu dans un état local depuis un effet. Un
  // instantané est stable par construction — le cache rend toujours le même
  // objet pour la même matière — donc aucun rendu superflu, et une matière déjà
  // chargée est posée dès la PREMIÈRE image, sans aplat visible au remontage.
  const maitre = useSyncExternalStore(abonnerAuxMatieres, () =>
    id ? (matiereEnCache(id) ?? null) : null,
  )

  useEffect(() => {
    if (!id) return
    chargerMatiere(id).catch((err: unknown) => {
      // Une matière manquante n'est pas une raison de perdre le bâtiment : on
      // reste en aplat, et on le dit.
      console.warn(`museum: matière « ${id} » non chargée`, err)
    })
  }, [id])

  const [rx, ry] = repetition
  const jeu = useMemo(
    () => (maitre ? repeterJeu(maitre, [rx, ry]) : null),
    [maitre, rx, ry],
  )

  // Les clones ne sont pas créés par R3F : il ne libère que ce qu'il a monté en
  // JSX. Sans ceci, chaque changement d'échelle laisse trois textures derrière
  // lui.
  useEffect(() => {
    if (!jeu) return
    return () => {
      libererJeu(jeu)
    }
  }, [jeu])

  return jeu
}

/**
 * La matière `id`, prête à être posée sur un maillage.
 *
 * `repetition` est le facteur à appliquer aux UV de la géométrie ; il se calcule
 * avec `repetitionMonde` ou `repetitionMetrique`, jamais à la main. Par défaut,
 * celui d'une géométrie extrudée — le cas de tout ce que `builders/` produit
 * sauf le garde-corps.
 */
export function useMatiere(
  id: MatiereId,
  repetition: [number, number] = repetitionDeMatiere(id),
  options: OptionsMatiere = {},
): THREE.MeshStandardMaterial {
  const jeu = useCartes(id, repetition)
  const { rebond, teinte } = options

  const material = useMemo(
    () => creerMatiere(id, jeu, { rebond, teinte }),
    [id, jeu, rebond, teinte],
  )

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  return material
}
