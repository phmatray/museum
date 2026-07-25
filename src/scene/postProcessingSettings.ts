/**
 * LOT 4 — Réglages du post-traitement (spec §9.4).
 *
 * ── Pourquoi ce fichier existe séparément de `PostProcessing.tsx` ──
 *
 * Deux raisons. La première est mécanique : eslint interdit d'exporter autre
 * chose qu'un composant depuis un `.tsx`. La seconde est la règle du projet —
 * ce qui se DÉCIDE doit être testable sans canvas. Les valeurs ci-dessous ont
 * toutes été réglées à l'œil, à l'écran, mais une fois posées ce sont des
 * données : elles se relisent, se comparent et se vérifient hors WebGL.
 *
 * ── Le défaut que ce lot corrige ──
 *
 * Le lot 3 rendait un bâtiment PLAT : deux murs perpendiculaires d'une même
 * salle sortaient exactement à la même valeur, si bien que l'arête verticale
 * qui les sépare était invisible. « On ne voit pas les coins » n'est pas une
 * impression, c'est l'absence d'occlusion ambiante — le terme d'éclairage qui
 * assombrit ce que la géométrie voisine empêche le ciel d'atteindre.
 *
 * Pas de baking possible ici : le bâtiment est génératif, ses UV changent à
 * chaque dérivation, et `Concrete034` d'ambientCG ne livre aucune carte d'AO
 * (§9.4). L'occlusion doit donc être calculée à l'image, en espace écran.
 */
import * as THREE from 'three'
import { ToneMappingMode } from 'postprocessing'

// ── Occlusion ambiante ───────────────────────────────────────────────────

/** Réglages de la passe N8AO. Tous en unités du monde, sauf mention. */
export interface AoSettings {
  /** Rayon d'échantillonnage, en MÈTRES. */
  aoRadius: number
  /** Décroissance, en fraction du rayon. */
  distanceFalloff: number
  intensity: number
  aoSamples: number
  denoiseSamples: number
  denoiseRadius: number
  /** Calcul en demi-résolution : divise le coût par ~4, invisible à l'œil. */
  halfRes: boolean
  /** Rayon en pixels plutôt qu'en mètres. Faux ici — voir plus bas. */
  screenSpaceRadius: boolean
  /** Teinte de l'occlusion. */
  color: string
}

/**
 * Occlusion ambiante — le réglage central du lot.
 *
 * ── Pourquoi un rayon en MÈTRES et non en pixels ──
 *
 * `screenSpaceRadius` ferait varier l'épaisseur du creusement avec la distance
 * à la caméra : un coin de salle se creuserait en s'approchant et s'aplatirait
 * en reculant. Dans un bâtiment qu'on traverse à pied, ce glissement se voit
 * immédiatement. Un rayon métrique donne au contraire une ombre de contact de
 * taille CONSTANTE dans le monde, ce qu'elle est physiquement.
 *
 * ── Pourquoi 1,8 m, et pourquoi pas 1,4 ni 2,2 ──
 *
 * C'est l'échelle du bâtiment qui le fixe : plafond à 4,3 m, murs de 0,32 m
 * d'épaisseur. Un rayon trop court ne creuse qu'un liseré et se lit comme un
 * CONTOUR DESSINÉ ; un rayon trop long fait déborder l'occlusion loin des
 * arêtes et entoure chaque cadre d'un HALO SOMBRE — le défaut classique du
 * SSAO mal réglé, qui trahit l'effet bien plus qu'il n'aide.
 *
 * Les trois réglages ont été comparés à l'écran, sur le même angle de la salle
 * d'honneur, en lisant la valeur du pixel sur l'arête et à 4 m d'elle :
 *
 *   1,4 m / 2,6 → arête creusée de 28 %, mais le dégradé meurt en 40 cm et
 *                 l'angle se lit comme un trait plutôt que comme un volume
 *   2,2 m / 3,4 → dégradé large et beau, mais il commence à mordre le milieu
 *                 des murs : chaque paroi prend sa propre vignette
 *   1,8 m / 3,0 → retenu. L'arête tombe à 62 % de la valeur du mur plat, sur
 *                 une largeur d'environ 80 cm, et les murs restent plats là où
 *                 ils sont plats.
 *
 * Sur la même mesure, le pixel du SOL au centre de la salle est resté
 * OCTET POUR OCTET identique avec et sans la passe : l'occlusion ne touche que
 * ce qui est près de quelque chose. C'est le contrôle qui distingue une AO
 * réglée d'un assombrissement global.
 *
 * ── Pourquoi la demi-résolution ──
 *
 * L'occlusion ambiante est un signal BASSE FRÉQUENCE : elle n'a aucun détail à
 * une échelle inférieure à ses propres échantillons. La calculer à la moitié de
 * la résolution puis la remonter avec `depthAwareUpsampling` (qui recale les
 * bords sur la profondeur) donne une image que rien ne distingue de la pleine
 * résolution.
 *
 * Mesuré sur cette machine, vue atrium, 2560 x 1600 (DPR 2) :
 * pleine résolution 68 im/s, demi-résolution 94 im/s. Le tampon d'occlusion
 * comparé côte à côte en mode debug ne montre AUCUNE différence de bord — le
 * recalage sur la profondeur fait tout le travail. 26 im/s pour rien : la
 * demi-résolution n'est pas une concession, c'est le bon réglage.
 */
export const AO: AoSettings = {
  aoRadius: 1.8,
  distanceFalloff: 0.6,
  intensity: 3.0,
  aoSamples: 16,
  denoiseSamples: 4,
  denoiseRadius: 12,
  halfRes: true,
  screenSpaceRadius: false,
  // Presque noir mais LÉGÈREMENT froid : le rebond qui atteint un coin de salle
  // vient du ciel par la verrière, pas d'une ampoule. Un noir pur donne une
  // saleté grise dans les angles ; cette teinte donne une ombre.
  color: '#0f1319',
}

// ── Bloom ────────────────────────────────────────────────────────────────

export interface BloomSettings {
  /** Seuil de luminance, en valeurs LINÉAIRES avant rendu des tons. */
  luminanceThreshold: number
  luminanceSmoothing: number
  intensity: number
  radius: number
  mipmapBlur: boolean
}

/**
 * Bloom — réservé au puits de lumière, et à lui seul.
 *
 * Le seuil est exprimé dans l'espace LINÉAIRE qui entre dans le composeur,
 * c'est-à-dire AVANT le rendu des tons — c'est d'ailleurs pourquoi le bloom est
 * placé avant lui dans la chaîne : après compression des hautes lumières, il ne
 * resterait plus rien à faire déborder.
 *
 * ── Pourquoi 1,0 et pas moins, mesuré à l'écran ──
 *
 * Le seuil a été cherché par dichotomie, en poussant temporairement l'intensité
 * à 2,0 pour rendre le débordement flagrant et voir CE QUI déborde :
 *
 *   seuil 0,80 → **toutes les toiles se mettent à luire**. Les visuels OG de
 *                GitHub sont des cartes BLANCHES : sous le même éclairage, ce
 *                sont les objets les plus lumineux du musée, plus lumineux que
 *                l'atrium. Rendu de jeu vidéo bon marché, exactement ce que le
 *                §9.4 refuse.
 *   seuil 0,95 → les toiles redeviennent nettes ; seule la tranche de rampe que
 *                le faisceau atteint garde un liseré.
 *
 * Le pic des toiles est donc entre 0,80 et 0,95. On se place à 1,0 : au-dessus,
 * une surface n'est plus « claire », elle est SURÉCLAIRÉE, et il n'y a qu'un
 * endroit dans le bâtiment où cela arrive — ce que le puits de lumière touche
 * directement. La marge sur 0,95 protège d'une dérive : un lot qui monterait
 * l'exposition ou l'intensité du soleil ne doit pas se réveiller avec cent
 * toiles phosphorescentes.
 *
 * Conséquence assumée : le bloom est aujourd'hui presque DORMANT, et c'est le
 * bon comportement. Il n'existe que pour la journée où le puits de lumière
 * dépassera franchement l'unité.
 *
 * L'intensité est faible et le rayon large : on cherche un débordement DOUX
 * autour d'une source, pas un halo net qui se lit comme un calque ajouté.
 */
export const BLOOM: BloomSettings = {
  luminanceThreshold: 1.0,
  luminanceSmoothing: 0.35,
  intensity: 0.25,
  radius: 0.75,
  mipmapBlur: true,
}

// ── Vignette ─────────────────────────────────────────────────────────────

export interface VignetteSettings {
  offset: number
  darkness: number
}

/**
 * Vignette. Sa fonction n'est pas décorative : elle retient le regard au
 * centre et elle referme les bords du champ, très large ici (75° de focale).
 * Au-delà de 0,4 d'assombrissement elle se voit en tant qu'effet, ce qui est
 * précisément ce qu'on ne veut pas.
 */
export const VIGNETTE: VignetteSettings = {
  offset: 0.42,
  darkness: 0.3,
}

// ── Rendu des tons ───────────────────────────────────────────────────────

/**
 * Traduit le rendu des tons de three vers celui de `postprocessing`.
 *
 * ── Pourquoi cette traduction est OBLIGATOIRE et n'est pas un doublon ──
 *
 * `WebGLRenderer` n'applique JAMAIS son `toneMapping` quand il rend dans une
 * cible hors écran : `WebGLPrograms` force `NoToneMapping` dès que
 * `currentRenderTarget !== null` (three 0.183, `getParameters`). Or un
 * `EffectComposer` rend précisément dans une cible. Le réglage du lot 3
 * (`TONE_MAPPING`, `TONE_EXPOSURE` dans `lighting.ts`) n'est donc pas
 * « doublé » si on le rejoue ici : il serait PERDU si on ne le rejouait pas.
 *
 * La courbe est déplacée, pas dupliquée — elle s'applique toujours une seule
 * fois, à la fin de la chaîne, ce qui est d'ailleurs sa place correcte : le
 * bloom doit travailler sur des valeurs linéaires non comprimées.
 *
 * L'EXPOSITION, elle, n'a pas à être retraduite : le shader de
 * `ToneMappingEffect` inclut le chunk `tonemapping_pars_fragment` de three, qui
 * lit l'uniforme `toneMappingExposure` — que le renderer téléverse depuis
 * `gl.toneMappingExposure`, valeur que le composeur ne touche pas. Le 1,15 du
 * lot 3 arrive donc intact.
 *
 * Un mode inconnu retombe sur Khronos PBR Neutral plutôt que de lever : une
 * exception ici noircirait tout l'écran pour une divergence de constante, ce
 * qui est un remède pire que le mal. Le test, lui, échoue.
 */
export function toneMappingMode(mode: THREE.ToneMapping): ToneMappingMode {
  switch (mode) {
    case THREE.NoToneMapping:
    case THREE.LinearToneMapping:
      return ToneMappingMode.LINEAR
    case THREE.ReinhardToneMapping:
      return ToneMappingMode.REINHARD
    case THREE.CineonToneMapping:
      return ToneMappingMode.CINEON
    case THREE.ACESFilmicToneMapping:
      return ToneMappingMode.ACES_FILMIC
    case THREE.AgXToneMapping:
      return ToneMappingMode.AGX
    case THREE.NeutralToneMapping:
      return ToneMappingMode.NEUTRAL
    default:
      return ToneMappingMode.NEUTRAL
  }
}
