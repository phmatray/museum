/**
 * LOT 3 — L'éclairage peint (spec §9.2) — LOT 4 — les douze sources (§9.4).
 *
 * La seconde moitié du fichier (« Éclairage multi-sources ») répartit les douze
 * lumières temps réel du §9.4 révisé. Elle est PURE et sans `react` : la règle
 * d'allocation — qui décide quelles salles sont éclairées et lesquelles ne
 * consomment rien — est exactement le genre de décision qu'une capture d'écran
 * ne peut pas juger, et elle se teste donc sans canvas.
 *
 * ── Pourquoi ce fichier existe ──
 *
 * Le §9.2 a supprimé les projecteurs par œuvre : 100 `SpotLight` avec ombres ne
 * tournent dans aucun navigateur, et le budget du §9 plafonne à 4 lumières temps
 * réel. Mais un musée sans flaques de lumière sur les murs n'est plus un musée,
 * c'est un entrepôt. La signature visuelle d'un spot se réduit à deux choses :
 * une ELLIPSE DOUCE sur le mur à l'aplomb de la toile, et une surbrillance sur
 * la toile elle-même. Aucune des deux n'a besoin d'être calculée — les deux
 * peuvent être PEINTES dans le matériau, pour zéro lumière et zéro draw call
 * supplémentaires.
 *
 * Ce module fabrique donc le matériau de mur : un `MeshStandardMaterial`
 * ordinaire (il reste éclairé par l'hémisphérique et la directionnelle, et il
 * reçoit l'ombre de la verrière) auquel `onBeforeCompile` ajoute, dans le
 * fragment, une somme de halos elliptiques et un lèche-mur vertical.
 *
 * ── Ce que le shader ajoute, et pourquoi c'est de l'émissif × albédo ──
 *
 * La contribution est ajoutée à `totalEmissiveRadiance`, PUIS multipliée par
 * `diffuseColor` — c'est-à-dire par l'albédo du mur. C'est ce qui distingue une
 * flaque de lumière d'un autocollant lumineux : un mur ardoise renvoie peu, un
 * mur crème renvoie beaucoup, exactement comme sous un vrai spot. Un émissif
 * pur, non modulé, blanchirait tous les murs de la même façon et trahirait
 * immédiatement la peinture.
 *
 * ── Le piège des programmes shader ──
 *
 * Les halos diffèrent d'un mur à l'autre : il faut donc UN MATÉRIAU PAR MUR
 * (~70 dans le bâtiment) et non plus un par salle. Cela ne change PAS le nombre
 * de draw calls (il y avait déjà un mesh par mur) mais cela changerait le nombre
 * de PROGRAMMES si three croyait avoir 70 shaders différents : d'où
 * `customProgramCacheKey`, constant, et un `MAX_HALOS` figé dans la source avec
 * un compteur en uniforme. Un seul programme, quel que soit le nombre de murs.
 *
 * Aucun aléa, aucune horloge : deux appels sur le même mur produisent les mêmes
 * uniformes, flottant pour flottant.
 */
import * as THREE from 'three'

import type { Floor, Museum, Room, ThemeId, Vec3, Wall } from '../domain/types'

// ── Constantes ───────────────────────────────────────────────────────────

/**
 * Nombre maximal de flaques peintes sur un mur.
 *
 * Le musée réel plafonne à 7 accrochages sur un mur ; 8 laisse une marge sans
 * gonfler le bloc d'uniformes (8 × 5 flottants = 40, négligeable). Au-delà, les
 * accrochages surnuméraires ne reçoivent pas de flaque — c'est une dégradation
 * visuelle, jamais une erreur de rendu.
 */
export const MAX_HALOS = 8

/**
 * Clé de cache de programme. Constante et distincte de celle d'un
 * `MeshStandardMaterial` nu : tous les murs partagent le programme, et aucun
 * autre matériau standard de la scène ne le récupère par erreur.
 */
const PROGRAM_CACHE_KEY = 'museum:wall-pools:v1'

/**
 * Rendu des tons. R3F applique `ACESFilmicToneMapping` par défaut, dont la
 * courbe en S écrase les basses lumières : sous deux lumières seulement, tout
 * l'intérieur du bâtiment tombait dans le pied de la courbe et le musée
 * apparaissait noir alors que les matériaux étaient clairs (mesuré à l'écran).
 * `NeutralToneMapping` (Khronos PBR Neutral) garde les moyens tons linéaires et
 * ne comprime que les hautes lumières — c'est exactement le compromis d'un
 * intérieur clair sous verrière.
 */
export const TONE_MAPPING = THREE.NeutralToneMapping

/** Exposition. Légèrement au-dessus de 1 : le bâtiment est un intérieur clair. */
export const TONE_EXPOSURE = 1.15

// ── Palette des thèmes ───────────────────────────────────────────────────

export interface ThemePalette {
  /** Albédo du mur. */
  wall: string
  roughness: number
  /** Teinte de la flaque de lumière. */
  halo: string
  /** Amplitude de la flaque, en multiples de l'albédo. */
  haloStrength: number
  /** Lèche-mur au pied du mur. */
  washLow: number
  /** Lèche-mur sous le plafond — la lumière vient toujours d'en haut. */
  washHigh: number
}

/**
 * Palette par thème.
 *
 * ── Pourquoi `immersive` n'est plus un thème sombre ──
 *
 * `immersive` vient des user stories : « salle sombre, éclairée aux spots
 * uniquement ». Le §9.2 a supprimé les spots. Les deux décisions sont
 * incompatibles : un mur ardoise sans source locale ne donne pas une salle
 * dramatique, il donne une salle NOIRE — c'est exactement ce que le bâtiment
 * montrait, et la salle d'honneur du rez-de-chaussée, seule salle `immersive`,
 * était la première chose que voyait le visiteur.
 *
 * On garde donc le nom mais on inverse la définition : `immersive` est la salle
 * où LA LUMIÈRE EST LE SUJET — murs clairs et froids, lèche-mur le plus marqué
 * du bâtiment, flaques les plus larges et les plus contrastées. C'est la seule
 * lecture de « immersive » qui survive à la suppression des spots, et elle rend
 * la salle d'honneur — qui est sous la verrière de l'atrium et qui est l'entrée
 * — au plus lumineux espace du musée, comme il se doit.
 *
 * `vault`, lui, reste sombre à bon droit : la réserve est au niveau −1, sous
 * terre, et aucun puits de lumière ne l'atteint. Sombre y est une information,
 * pas un accident.
 */
/**
 * Le béton de l'enceinte : une seule teinte pour tout le bâtiment, thèmes
 * compris.
 *
 * Choisie entre le plus clair et le plus sombre des thèmes (#eeece7 et #7f7768)
 * plutôt qu'à l'un des deux bouts : l'enveloppe doit lire comme du béton banché,
 * ni comme du plâtre blanc ni comme un mur de cave.
 */
const BETON_ENCEINTE = '#cec8bc'

/** Le béton brut est plus mat que n'importe quel enduit de salle. */
const RUGOSITE_ENCEINTE = 0.95

export const THEME_PALETTE: Record<ThemeId, ThemePalette> = {
  classic: {
    wall: '#ded4c2',
    roughness: 0.94,
    halo: '#fff2d9',
    haloStrength: 0.5,
    washLow: 0.1,
    washHigh: 0.3,
  },
  modern: {
    wall: '#eeece7',
    roughness: 0.9,
    halo: '#ffffff',
    haloStrength: 0.36,
    washLow: 0.12,
    washHigh: 0.26,
  },
  immersive: {
    wall: '#e9e5dc',
    roughness: 0.9,
    halo: '#fff6e6',
    haloStrength: 0.45,
    washLow: 0.16,
    washHigh: 0.42,
  },
  vault: {
    wall: '#7f7768',
    roughness: 0.96,
    halo: '#ffd7a0',
    haloStrength: 0.55,
    washLow: 0.05,
    washHigh: 0.17,
  },
}

// ── Ambiance spéculaire ──────────────────────────────────────────────────

/**
 * Intensité de l'environnement. Volontairement faible : l'éclairage diffus reste
 * l'affaire de l'hémisphérique, l'environnement n'est là que pour donner au
 * spéculaire quelque chose à refléter.
 */
export const ENVIRONMENT_INTENSITY = 0.45

/**
 * Un dégradé ciel → horizon → sol, en équirectangulaire, pré-filtré en carte
 * d'environnement.
 *
 * ── Pourquoi c'est nécessaire ──
 *
 * Une `hemisphereLight` n'éclaire QUE le diffus. Le garde-corps de l'atrium est
 * un métal (`metalness: 0.6`) : son diffus est presque nul par définition, et
 * sans environnement son spéculaire réfléchit le vide, c'est-à-dire du NOIR. Les
 * quatre côtés de chaque trémie apparaissaient donc comme des bandes noires
 * encadrant le puits de lumière — exactement là où le regard va. Constaté à
 * l'écran.
 *
 * ── Pourquoi ce n'est pas une lumière de plus ──
 *
 * Une carte d'environnement est échantillonnée par les shaders qui existent
 * déjà : zéro lumière temps réel, zéro shadow map, zéro draw call. Elle coûte
 * une texture de quelques centaines de kilo-octets en VRAM et une passe de
 * pré-filtrage au démarrage. C'est le seul poste du §9 qu'elle touche.
 *
 * Le dégradé est calculé, pas chargé : aucun fichier à télécharger, et deux
 * exécutions donnent le même octet.
 */
export function buildAmbientEnvironment(
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const LARGEUR = 16
  const HAUTEUR = 64

  const ciel = new THREE.Color('#dbe6f5')
  const horizon = new THREE.Color('#c8ccd2')
  const sol = new THREE.Color('#dcd8d0')

  const data = new Uint8Array(LARGEUR * HAUTEUR * 4)
  const teinte = new THREE.Color()
  for (let y = 0; y < HAUTEUR; y++) {
    // v = 0 au zénith, 1 au nadir : c'est la convention équirectangulaire de
    // three, et l'inverser retournerait le ciel sous les pieds du visiteur.
    const v = y / (HAUTEUR - 1)
    if (v < 0.5) {
      teinte.copy(ciel).lerp(horizon, v * 2)
    } else {
      teinte.copy(horizon).lerp(sol, (v - 0.5) * 2)
    }
    for (let x = 0; x < LARGEUR; x++) {
      const i = (y * LARGEUR + x) * 4
      data[i] = Math.round(teinte.r * 255)
      data[i + 1] = Math.round(teinte.g * 255)
      data[i + 2] = Math.round(teinte.b * 255)
      data[i + 3] = 255
    }
  }

  const equirect = new THREE.DataTexture(data, LARGEUR, HAUTEUR)
  equirect.colorSpace = THREE.SRGBColorSpace
  equirect.mapping = THREE.EquirectangularReflectionMapping
  equirect.needsUpdate = true

  const pmrem = new THREE.PMREMGenerator(renderer)
  const cible = pmrem.fromEquirectangular(equirect)
  // La source et le générateur ne servent plus après le pré-filtrage : les
  // garder fuirait un tampon GPU à chaque rechargement à chaud du musée.
  pmrem.dispose()
  equirect.dispose()

  return cible.texture
}

// ── Puits de lumière ─────────────────────────────────────────────────────

/**
 * Lèche-mur du CÔTÉ ATRIUM d'un mur, en fonction de l'altitude du niveau.
 *
 * La face intérieure d'une salle est traitée par son thème ; la face qui donne
 * sur le vide central, elle, ne reçoit rien du thème et tomberait au noir. C'est
 * pourtant elle qui doit faire lire le puits de lumière : le faisceau entre par
 * la trémie de la toiture et s'épuise en descendant. On peint donc ce dégradé
 * plutôt que de le calculer — une lumière de plus par niveau ferait exploser le
 * budget du §9 pour un effet qu'une interpolation linéaire rend aussi bien.
 *
 * Bornes choisies sur le bâtiment réel : réserve à −4,7 m, dernier plafond à
 * +13,7 m. Hors de ces bornes la valeur est simplement plafonnée.
 */
export function lightWellWash(elevation: number): number {
  const BAS = -5
  const HAUT = 14
  const t = Math.min(1, Math.max(0, (elevation - BAS) / (HAUT - BAS)))
  return 0.05 + 0.34 * t
}

// ── Halos d'un mur ───────────────────────────────────────────────────────

/** Uniformes géométriques d'un mur, prêts à être versés dans le matériau. */
export interface WallHalos {
  count: number
  /** Centres des flaques, dans le repère du niveau (x/z monde, y au-dessus du plancher). */
  centres: THREE.Vector3[]
  /** Demi-axes (horizontal, vertical) de chaque ellipse, en mètres. */
  rayons: THREE.Vector2[]
  /** Axe `u` du mur, unitaire : direction `a → b`. */
  tangente: THREE.Vector3
  /** Normale intérieure, unitaire. Sert à ne peindre que la face vue de la salle. */
  normale: THREE.Vector3
}

/**
 * Élévation du centre de la flaque au-dessus du centre de l'œuvre, en multiples
 * de la hauteur de l'œuvre. Un spot muséal est accroché au plafond et vise vers
 * le bas : le cœur de la tache tombe au-dessus de l'axe du cadre, jamais dessus.
 */
const HALO_RISE = 0.35

/** Débord de l'ellipse autour du cadre. Une flaque plus étroite que la toile ne se verrait pas. */
const HALO_SPREAD_H = 1.3
const HALO_SPREAD_V = 1.8

/** Une flaque n'est jamais plus petite que ça, même pour une vignette. */
const HALO_MIN_H = 0.85
const HALO_MIN_V = 1.3

/**
 * Position et taille des flaques d'un mur, déduites de ses accrochages.
 *
 * Fonction PURE : elle ne lit que le contrat de domaine et ne touche à aucun
 * état graphique. C'est ce qui la rend testable sans canvas.
 */
export function wallHalos(wall: Wall): WallHalos {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const longueur = Math.hypot(dx, dz)
  // Mur dégénéré : pas d'axe, donc pas de repère. On rend un jeu vide plutôt
  // qu'une tangente NaN, qui contaminerait tout le fragment shader.
  const tangente =
    longueur > 1e-6
      ? new THREE.Vector3(dx / longueur, 0, dz / longueur)
      : new THREE.Vector3(1, 0, 0)

  const nx = wall.normal.x
  const nz = wall.normal.z
  const nLen = Math.hypot(nx, nz)
  const normale =
    nLen > 1e-6
      ? new THREE.Vector3(nx / nLen, 0, nz / nLen)
      : new THREE.Vector3(0, 0, -1)

  const centres: THREE.Vector3[] = []
  const rayons: THREE.Vector2[] = []

  for (const placement of wall.placements.slice(0, MAX_HALOS)) {
    centres.push(
      new THREE.Vector3(
        wall.a.x + tangente.x * placement.u,
        placement.centerHeight + placement.height * HALO_RISE,
        wall.a.z + tangente.z * placement.u,
      ),
    )
    rayons.push(
      new THREE.Vector2(
        Math.max(HALO_MIN_H, placement.width * HALO_SPREAD_H),
        Math.max(HALO_MIN_V, placement.height * HALO_SPREAD_V),
      ),
    )
  }

  return { count: centres.length, centres, rayons, tangente, normale }
}

// ── Matériau de mur ──────────────────────────────────────────────────────

export interface WallMaterialOptions {
  theme: ThemeId
  wall: Wall
  /** Élévation du plancher du niveau, en mètres. Ne sert qu'au puits de lumière. */
  elevation: number
}

/**
 * Le matériau d'un mur : standard, plus les flaques peintes.
 *
 * Les uniformes sont créés ICI et capturés par `onBeforeCompile`, qui les
 * réinjecte dans `shader.uniforms`. C'est le seul moyen de garder une référence
 * stable : `onBeforeCompile` n'est appelé qu'à la première compilation, mais
 * three relit l'objet `uniforms` à chaque frame.
 */
export function createWallMaterial({
  theme,
  wall,
  elevation,
}: WallMaterialOptions): THREE.MeshStandardMaterial {
  const palette = THEME_PALETTE[theme]
  const halos = wallHalos(wall)

  // Les tableaux d'uniformes doivent avoir la taille DÉCLARÉE dans le shader,
  // pas celle du mur : three envoie `MAX_HALOS` éléments quoi qu'il arrive, et
  // un tableau court laisserait les derniers slots sur des valeurs de la frame
  // précédente — donc des flaques fantômes.
  const centres = Array.from(
    { length: MAX_HALOS },
    (_, i) => halos.centres[i] ?? new THREE.Vector3(),
  )
  const rayons = Array.from(
    { length: MAX_HALOS },
    (_, i) => halos.rayons[i] ?? new THREE.Vector2(1, 1),
  )

  const uniforms = {
    uHaloCount: { value: halos.count },
    uHaloPos: { value: centres },
    uHaloRadius: { value: rayons },
    uHaloColor: { value: new THREE.Color(palette.halo) },
    uHaloStrength: { value: palette.haloStrength },
    uWallTangent: { value: halos.tangente },
    uWallNormal: { value: halos.normale },
    uWallHeight: { value: Math.max(0.001, wall.height) },
    uWashLow: { value: palette.washLow },
    uWashHigh: { value: palette.washHigh },
    // Le dos d'un mur intérieur donne sur l'atrium et doit lire le puits de
    // lumière ; le dos d'un mur extérieur est la façade, déjà en plein soleil,
    // et la repeindre ne ferait que la brûler.
    uWashBack: {
      value: wall.kind === 'outer' ? 0 : lightWellWash(elevation),
    },
  }

  const material = new THREE.MeshStandardMaterial({
    // Un mur d'enceinte n'appartient pas à la salle qui se trouve derrière lui.
    //
    // La teinte du thème était appliquée à TOUS les murs, mur de façade compris.
    // Vue de l'extérieur, l'enveloppe devenait donc un patchwork : un panneau
    // taupe pour la réserve, un blanc pour le rez-de-chaussée, un crème pour les
    // étages, avec les joints entre salles lisibles en façade. Un bâtiment ne
    // change pas de matériau parce qu'on a changé de salle à l'intérieur.
    //
    // L'enceinte reçoit donc UNE teinte, celle du bâtiment. C'est déjà ce que
    // `matiereDeMur` supposait en renvoyant 'beton' pour tout mur `outer` : la
    // carte était bien du béton, seul le niveau d'albédo trahissait le thème.
    color: wall.kind === 'outer' ? BETON_ENCEINTE : palette.wall,
    roughness: wall.kind === 'outer' ? RUGOSITE_ENCEINTE : palette.roughness,
    metalness: 0,
  })

  // Les uniformes ne sont accessibles nulle part une fois le shader compilé :
  // three ne les republie pas sur le matériau. Les exposer ici est ce qui permet
  // de les régler à l'écran (et de les vérifier en test) sans recompiler.
  material.userData.pools = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vFlaquePos;
         varying vec3 vFlaqueNrm;`,
      )
      // `objectNormal` n'existe qu'après ce chunk, et c'est la normale du
      // repère de l'objet — le seul repère où la normale intérieure du mur,
      // calculée sur la donnée de domaine, ait un sens.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vFlaqueNrm = objectNormal;`,
      )
      // Le `RigidBody` de la salle ne pose que la translation d'élévation :
      // `position` est donc déjà en x/z monde, avec y au-dessus du plancher —
      // exactement le repère dans lequel `wallHalos` a placé les centres.
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vFlaquePos = position;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         #define MAX_HALOS ${MAX_HALOS}
         uniform int   uHaloCount;
         uniform vec3  uHaloPos[MAX_HALOS];
         uniform vec2  uHaloRadius[MAX_HALOS];
         uniform vec3  uHaloColor;
         uniform float uHaloStrength;
         uniform vec3  uWallTangent;
         uniform vec3  uWallNormal;
         uniform float uWallHeight;
         uniform float uWashLow;
         uniform float uWashHigh;
         uniform float uWashBack;
         varying vec3  vFlaquePos;
         varying vec3  vFlaqueNrm;`,
      )
      // Après ce chunk, `diffuseColor` et `totalEmissiveRadiance` existent tous
      // les deux : c'est le seul point du shader standard où l'on peut ajouter
      // une lumière peinte ET la moduler par l'albédo.
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           vec3 n = normalize(vFlaqueNrm);
           // La face que voit la salle est celle dont la normale suit la
           // normale intérieure ; le dos et les tableaux d'about (jambages,
           // linteaux) ne reçoivent rien, sans quoi les flaques traverseraient
           // le mur et éclaireraient la salle voisine.
           float dedans = smoothstep(0.4, 0.85, dot(n, uWallNormal));
           float dehors = smoothstep(0.4, 0.85, dot(n, -uWallNormal));

           // Lèche-mur : la lumière tombe du plafond, le pied du mur reste
           // dans l'ombre de contact. Sans ce dégradé les murs sont des aplats
           // et la salle n'a plus de volume.
           float h = clamp(vFlaquePos.y / uWallHeight, 0.0, 1.0);
           float wash = mix(uWashLow, uWashHigh, h * h);

           float flaques = 0.0;
           for (int i = 0; i < MAX_HALOS; i++) {
             if (i >= uHaloCount) break;
             vec3 d = vFlaquePos - uHaloPos[i];
             float du = dot(d, uWallTangent) / uHaloRadius[i].x;
             float dv = d.y / uHaloRadius[i].y;
             float r = sqrt(du * du + dv * dv);
             // Pas de cœur plat : une flaque à plateau se lit comme un
             // autocollant blanc. Un smoothstep depuis 0, élevé au carré,
             // décroît dès le centre : c'est le profil d'un spot à lentille.
             float f = 1.0 - smoothstep(0.0, 1.0, r);
             flaques += f * f;
           }
           // Deux flaques qui se recouvrent ne doivent pas doubler la mise :
           // au-delà, le mur se saturerait entre deux toiles voisines.
           flaques = min(flaques, 1.0);

           float peint = dedans * (wash + flaques * uHaloStrength) + dehors * uWashBack;
           totalEmissiveRadiance += diffuseColor.rgb * uHaloColor * peint;
         }`,
      )
  }

  // Sans cela, three prend la source de `onBeforeCompile` comme clé : une
  // fermeture différente par mur, donc ~70 programmes compilés pour un seul
  // shader. Le budget du §9 compte les programmes.
  material.customProgramCacheKey = () => PROGRAM_CACHE_KEY

  return material
}

// ═════════════════════════════════════════════════════════════════════════
// LOT 4 — Éclairage multi-sources (spec §9.4)
// ═════════════════════════════════════════════════════════════════════════
//
// ── Pourquoi douze, et pourquoi ce n'est pas « quatre plus huit » ──
//
// Le §9.2 s'était interdit toute source locale parce que le budget de quatre
// lumières avait été calibré sur 256 œuvres visibles à la fois. La mesure du
// lot 3 a donné 83 draw calls : le plafond est relevé à douze, dont deux au
// plus projettent une ombre. Mais douze lumières ne suffisent pas à éclairer
// dix-sept salles — et n'ont pas à le faire. La règle est une règle
// d'ALLOCATION, pas d'addition :
//
//   permanentes (3)   hémisphérique, soleil de verrière (ombre), rebond
//   salles proches(6) des sources douces au plafond, réaffectées en marchant,
//                     la salle qui contient le visiteur toujours servie d'abord
//   puits d'atrium(3) la descente de lumière, décroissante avec la profondeur
//   ────────────────  ────────────────────────────────────────────────────
//   12 exactement, quel que soit le nombre de salles du bâtiment.
//
// Une salle éloignée ne consomme RIEN. C'est ce qui rend le plafond tenable :
// un musée de cent salles n'allume pas une lumière de plus qu'un musée de six.
//
// ── Pourquoi le nombre de créneaux ne varie JAMAIS ──
//
// three compile un programme par configuration de lumières
// (`NUM_POINT_LIGHTS` est un `#define`). Allumer une lumière de plus en
// marchant recompilerait TOUS les shaders du bâtiment au milieu d'un pas —
// un à-coup de plusieurs dizaines de millisecondes, exactement au moment où
// le joueur bouge. Les créneaux sont donc montés une fois pour toutes et ne
// s'éteignent qu'en passant leur intensité à zéro : le nombre de lumières
// dans le graphe est constant, donc le nombre de programmes aussi.
//
// ── Ce que ces sources doivent faire, et que le peint ne fait pas ──
//
// Les flaques du §9.2 sont plaquées sur la face intérieure d'un mur : elles
// ignorent la géométrie voisine et ne peuvent donc PAS révéler un angle. Une
// vraie source ponctuelle au plafond, elle, éclaire les deux faces d'un dièdre
// à des angles différents — c'est cette différence, et elle seule, qui fait
// exister le coin. L'occlusion ambiante creuse, la lumière révèle ; il faut
// les deux, et c'est la raison d'être de ce lot.

/** Plafond du §9.4. Ni le rendu ni les tests ne doivent le dépasser. */
export const BUDGET_LUMIERES = 12

/**
 * Plafond des shadow maps du §9 : la verrière, plus la salle courante.
 *
 * ── UNE SEULE est dépensée, et c'est une décision mesurée ──
 *
 * La seconde était prévue pour la salle courante, sous la forme d'un
 * projecteur zénithal qui aurait posé le banc et les plantes SUR le parquet.
 * Elle a été écrite, montée, et mesurée : +77 draw calls, pour AUCUN occulteur
 * à l'image. Tout ce qu'une salle contient est explicitement `castShadow=false`
 * — les props (`PropsLayer`) comme les œuvres (`ArtworkLayer`), décidé par les
 * lots qui possèdent ces fichiers quand la verrière était la seule ombre du
 * bâtiment. La passe rendait donc les murs, qui n'ombrent qu'eux-mêmes.
 *
 * Le budget est un plafond, pas un quota : mieux vaut une ligne non dépensée
 * que soixante-dix-sept draw calls pour un résultat invisible. Le jour où
 * `PropsLayer` passera `castShadow` à `true`, la seconde ombre vaudra son
 * prix — c'est un mot à changer, et rien d'autre.
 */
export const BUDGET_OMBRES = 2

/** Hémisphérique + soleil de verrière + rebond. Toujours allumées. */
export const LUMIERES_PERMANENTES = 3

/**
 * Créneaux réaffectables pour les salles, salle courante comprise.
 *
 * Six, et pas cinq plus une : toutes les sources de salle sont identiques, et
 * la salle qui contient le visiteur n'est privilégiée qu'au CLASSEMENT — elle
 * passe devant, donc elle est servie, mais elle n'a besoin d'aucun matériel
 * particulier. Un créneau distinct pour elle n'aurait existé que pour porter
 * une ombre, et cette ombre n'est pas dépensée (voir `BUDGET_OMBRES`).
 */
export const BUDGET_SALLES = 6

/** Créneaux réaffectables dans le puits de l'atrium. */
export const BUDGET_PUITS = 3

// ── Sources permanentes ──────────────────────────────────────────────────

/**
 * L'hémisphérique, plancher d'exposition du bâtiment.
 *
 * Elle valait 2,9 au lot 3, quand elle était la SEULE lumière à atteindre
 * l'intérieur des salles : à ce niveau, tout ressortait à la même valeur et le
 * bâtiment s'aplatissait — un mur au fond d'une salle sortait aussi clair que
 * celui qu'on avait sous le nez. Elle redescend à 1,15 maintenant que chaque
 * salle proche a sa propre source : ce qui manquait n'était pas de la lumière,
 * c'était de l'ÉCART entre deux surfaces. Descendre le plancher est ce qui
 * donne aux onze autres sources quelque chose à révéler.
 *
 * Son « sol » reste volontairement clair : c'est lui qui éclaire les faces
 * tournées vers le bas (voir `REBOND`), et un sol sombre les rendrait au noir.
 */
export const AMBIANCE = {
  ciel: '#dbe6f5',
  sol: '#dcd8d0',
  intensite: 1.15,
} as const

/**
 * Le soleil de la verrière. Seule source du bâtiment à porter une ombre depuis
 * le lot 2, et la seule qui entre par la trémie de la toiture.
 *
 * Il monte de 1,5 à 1,8 : l'hémisphérique ayant baissé, c'est lui qui doit
 * maintenant faire la différence entre le plein soleil de la toiture et le fond
 * d'une salle. Sa teinte est très légèrement chaude — un soleil parfaitement
 * blanc à côté d'un ciel bleu lit comme une lampe de bureau.
 */
export const SOLEIL = {
  couleur: '#fff3e0',
  intensite: 1.8,
} as const

/**
 * LE REBOND — la correction des sous-faces, qui étaient noires.
 *
 * Toutes les sources du bâtiment sont zénithales : soleil, plafonniers, puits
 * d'atrium. Une face tournée vers le BAS — dessous d'une dalle, dessous d'une
 * volée de rampe, dessous d'un banc — n'en reçoit donc structurellement aucune,
 * et tombait au noir : une masse sombre occupait le bas de la vue d'entrée.
 *
 * Dans la réalité, ces faces sont éclairées par ce que le SOL leur renvoie.
 * C'est une directionnelle inversée : posée sous le bâtiment et visant
 * l'origine, sa lumière VOYAGE VERS LE HAUT et n'atteint donc que les faces qui
 * regardent vers le bas. Sans ombre — un rebond diffus n'en projette pas, et il
 * n'y a que deux shadow maps au budget, toutes deux dépensées ailleurs.
 *
 * Sa teinte est celle du sol qui rebondit : marbre et parquet, donc un beige
 * chaud, jamais un blanc neutre.
 *
 * ── Pourquoi 0,45 et pas davantage ──
 *
 * Calibré à l'écran, sur la vue d'entrée. À 0,85, la sous-face de la dalle du
 * premier — un parquet clair qui occupe le haut du champ — ressortait PLUS
 * CLAIRE que le marbre du sol qu'elle est censée refléter. Un rebond ne peut
 * pas dépasser sa source : au-delà, l'image se retourne et le plafond devient
 * le sujet. La sous-face reçoit déjà le « sol » de l'hémisphérique ; le rebond
 * n'est qu'un appoint directionnel, pas l'éclairage principal.
 */
export const REBOND = {
  couleur: '#efe6d6',
  intensite: 0.45,
  /** Position, en multiples du rayon du bâtiment. Sous le plancher le plus bas. */
  profondeur: 1.5,
} as const

// ── Sources de salle ─────────────────────────────────────────────────────

/**
 * Retrait du plafonnier sous la dalle, en mètres.
 *
 * Collé au plafond, un point lumineux n'éclaire plus le plafond lui-même
 * (l'angle d'incidence tend vers 90°) et la dalle du dessus reste noire. Un
 * demi-mètre suffit à ce que la lumière lèche le plafond, ce qui est aussi la
 * hauteur réelle d'une suspension muséale sous rail.
 */
/*
  Relevé de 0,55 à 0,85 le 2026-08-16, sur mesure.

  À 55 cm, une source ponctuelle qui décroît en 1/d² frappe la dalle juste
  au-dessus d'elle à bout portant : la vue `plafond` sortait à 34,3 % de pixels
  quasi blancs, 2,59 % d'ÉCRÊTÉS, et l'écart-type le plus faible des dix vues —
  un aplat crème surexposé, c'est-à-dire l'inverse exact du défaut du §9.4 et
  tout aussi illisible.

  0,85 m divise l'éclairement au zénith par 2,4 et ÉLARGIT la flaque au lieu de
  la creuser. La raison d'être du retrait ne change pas — un point collé au
  plafond ne l'éclaire plus du tout — on la calibre simplement sur ce qui a été
  mesuré plutôt que sur la hauteur d'une suspension de catalogue.
*/
export const RETRAIT_PLAFOND = 0.85

/**
 * Rayon utile d'un plafonnier, en mètres — bornes.
 *
 * Une source ponctuelle décroît en 1/d² : dans une galerie de 30 m, une seule
 * lampe calibrée sur la diagonale brûlerait son centre pour éclairer ses bouts.
 * On plafonne donc le rayon : les grandes salles restent plus sombres à leurs
 * extrémités, ce qui n'est pas un défaut mais l'atmosphère d'une enfilade.
 */
export const RAYON_SALLE_MIN = 4.5
export const RAYON_SALLE_MAX = 8.5

/**
 * Éclairement visé au rayon utile, en lux trois-js.
 *
 * L'intensité d'une `PointLight` de three est une INTENSITÉ (candela) : ce
 * qu'on perçoit à la distance `r` vaut `intensite / r²`. On raisonne donc à
 * l'envers, sur l'éclairement voulu au bord de la zone utile, et la constante
 * garde le même rendu dans une salle de 6 m et dans une galerie de 17 m.
 */
export const ECLAIREMENT_SALLE = 0.62

/** Teinte des plafonniers : blanc de galerie, très légèrement chaud. */
export const COULEUR_SALLE = '#fff4e6'

/**
 * Ce qu'il faut savoir pour poser une source ponctuelle, et rien de plus.
 *
 * Le contrat commun des plafonniers et du puits : la couche de scène ne verse
 * que ces trois nombres dans un `PointLight`, et n'a donc pas à savoir si le
 * créneau qu'elle remplit éclaire une salle ou une trémie.
 */
export interface SourcePlacee {
  /** Position MONDE, élévation du niveau comprise. */
  position: [number, number, number]
  intensity: number
  /** Portée au-delà de laquelle three coupe la source (0 = infinie). */
  distance: number
}

/** Un plafonnier, prêt à être versé dans un créneau. */
export interface LumiereDeSalle extends SourcePlacee {
  roomId: string
  level: number
}

/**
 * Le plafonnier d'une salle. Fonction PURE : rien qu'une lecture du domaine.
 *
 * Au centre de l'emprise, sous le plafond. Pas de tirage aléatoire, pas
 * d'horloge : deux appels sur la même salle donnent le même flottant.
 */
export function lumiereDeSalle(
  room: Room,
  elevation: number,
  ceilingHeight: number,
): LumiereDeSalle {
  const { x, z, width, depth } = room.footprint
  const rayon = Math.min(
    RAYON_SALLE_MAX,
    Math.max(RAYON_SALLE_MIN, Math.hypot(width, depth) / 2),
  )
  return {
    roomId: room.id,
    level: 0,
    position: [
      x + width / 2,
      elevation + Math.max(0.6, ceilingHeight - RETRAIT_PLAFOND),
      z + depth / 2,
    ],
    intensity: ECLAIREMENT_SALLE * rayon * rayon,
    // La portée dépasse franchement le rayon utile : couper net à `rayon`
    // dessinerait un cercle sur le sol, ce que ne fait aucune lampe.
    distance: rayon * 2.2,
  }
}

/**
 * Les plafonniers de TOUTES les salles du bâtiment, calculés une fois.
 *
 * Le catalogue complet est bon marché (dix-sept objets pour ce musée) et il ne
 * change jamais : c'est l'allocation, pas la géométrie, qui varie en marchant.
 */
export function lumieresDeSalles(museum: Museum): LumiereDeSalle[] {
  const toutes: LumiereDeSalle[] = []
  for (const floor of museum.floors) {
    for (const room of floor.rooms) {
      toutes.push({
        ...lumiereDeSalle(room, floor.elevation, floor.ceilingHeight),
        level: floor.level,
      })
    }
  }
  return toutes
}

/**
 * Pénalité de distance appliquée par niveau d'écart, en mètres.
 *
 * Une salle de l'étage au-dessus peut être à six mètres de l'œil et pourtant
 * séparée de lui par quarante centimètres de béton : la distance euclidienne
 * seule surestime largement son intérêt.
 *
 * Quatorze mètres, et non neuf : le bâtiment fait trente mètres de côté, si
 * bien que deux salles du MÊME niveau peuvent être distantes de vingt mètres.
 * Mesuré à l'écran depuis le premier étage, une pénalité de neuf laissait deux
 * salles du niveau courant éteintes pendant que la réserve, deux dalles plus
 * bas, consommait un créneau. Quatorze fait passer tout le niveau courant
 * devant, sans exclure les autres : depuis l'atrium du rez-de-chaussée, qui
 * n'a qu'une seule salle, les cinq créneaux restants vont bien aux étages —
 * et ce sont précisément les salles qu'on voit d'en bas.
 */
export const PENALITE_NIVEAU = 14

/**
 * Classe les plafonniers du plus utile au moins utile pour un œil donné.
 *
 * Trois règles, dans cet ordre :
 *
 *  1. la salle qui CONTIENT le visiteur passe devant tout le reste. Le seul
 *     critère de distance la perdrait dès qu'il s'approche d'une cloison : le
 *     centre de la petite salle voisine peut être plus près de lui que le
 *     centre de la sienne, et sa propre salle s'éteindrait sous ses pieds ;
 *  2. les salles du niveau du visiteur avant celles des autres niveaux, à
 *     `PENALITE_NIVEAU` près. `niveauJoueur` vient du registre de culling, qui
 *     l'établit AVEC HYSTÉRÉSIS : en montant une rampe, la valeur ne bascule
 *     qu'une fois, franchement, au lieu d'osciller au rythme du contrôleur
 *     cinématique — ce qui ferait sauter les six lumières d'un étage à l'autre
 *     plusieurs fois par seconde. C'est exactement pour ça qu'on lit ce suivi
 *     au lieu d'en refaire un ;
 *  3. le reste par distance au point d'éclairage, en trois dimensions.
 *
 * Les ex æquo sont départagés par identifiant : deux appels sur la même
 * position rendent le même ordre, toujours.
 */
export function classerLumieresDeSalles(
  toutes: readonly LumiereDeSalle[],
  oeil: Vec3,
  salleCourante: string | null,
  niveauJoueur: number | null = null,
): LumiereDeSalle[] {
  const cout = (lumiere: LumiereDeSalle): number => {
    const ecart =
      niveauJoueur === null ? 0 : Math.abs(lumiere.level - niveauJoueur) * PENALITE_NIVEAU
    return distanceCarree(lumiere.position, oeil) + ecart * ecart
  }
  return [...toutes].sort((a, b) => {
    if (a.roomId === salleCourante) return -1
    if (b.roomId === salleCourante) return 1
    const da = cout(a)
    const db = cout(b)
    if (da !== db) return da - db
    return a.roomId < b.roomId ? -1 : 1
  })
}

/**
 * Verse les salles retenues dans des créneaux STABLES.
 *
 * Sans cette étape, une salle qui recule d'un rang change de créneau, et la
 * lumière du créneau qu'elle libère saute d'un bout du bâtiment à l'autre à
 * l'image suivante — un clignotement franc, en marchant, sur des surfaces qui
 * n'ont aucune raison de changer. On garde donc chaque salle dans le créneau
 * qu'elle occupait déjà ; seuls les créneaux réellement libérés changent de
 * locataire.
 *
 * `precedent` est le contenu des créneaux à l'image d'avant (`null` = libre).
 * La longueur du résultat est TOUJOURS celle de `precedent` : le nombre de
 * lumières dans le graphe ne bouge pas, c'est la condition de non-recompilation
 * des shaders.
 */
export function affecterCreneaux<T extends { roomId: string }>(
  precedent: readonly (string | null)[],
  retenues: readonly T[],
): (T | null)[] {
  const creneaux: (T | null)[] = precedent.map(() => null)
  const restantes: T[] = []

  for (const lumiere of retenues) {
    const place = precedent.indexOf(lumiere.roomId)
    if (place >= 0 && creneaux[place] === null) creneaux[place] = lumiere
    else restantes.push(lumiere)
  }

  let curseur = 0
  for (const lumiere of restantes) {
    while (curseur < creneaux.length && creneaux[curseur] !== null) curseur++
    if (curseur >= creneaux.length) break
    creneaux[curseur] = lumiere
  }
  return creneaux
}

// ── Puits de lumière de l'atrium ─────────────────────────────────────────

/**
 * Hauteur de la source au-dessus du plancher percé, en mètres.
 *
 * La source matérialise le faisceau qui DESCEND dans la trémie : elle doit
 * donc être dans le volume du vide, à mi-hauteur de l'étage, et non collée au
 * plafond où elle n'éclairerait que la dalle du dessus.
 */
export const HAUTEUR_PUITS = 2.1

/** Portée d'une source de puits : elle doit traverser tout un étage. */
export const PORTEE_PUITS = 17

/** Teinte du puits : lumière du jour, franchement plus froide que les salles. */
export const COULEUR_PUITS = '#e8f0ff'

/** Bornes de la décroissance, en mètres. Réserve à −4,7 m, toiture à +13,7 m. */
export const PUITS_BAS = -5
export const PUITS_HAUT = 14

/** Intensité maximale, atteinte juste sous la trémie de la toiture. */
export const PUITS_INTENSITE_MAX = 46

/**
 * Intensité du puits à une élévation donnée.
 *
 * ── Pourquoi ce n'est PAS linéaire ──
 *
 * Le faisceau qui entre par la trémie de la toiture est intercepté à chaque
 * niveau par la dalle qui borde le vide : il ne s'atténue pas, il se fait
 * MANGER par tranches. Une décroissance quadratique rend cela — le dernier
 * étage baigne, le rez-de-chaussée reçoit un fond, la réserve n'a rien. C'est
 * la même courbe que `lightWellWash`, qui peint le dos des murs sur l'atrium :
 * les deux doivent raconter la même descente, sinon le mur et l'air qu'il borde
 * se contredisent.
 *
 * Le plancher de 0,12 n'est pas une précaution : sans lui, le bas de l'atrium
 * ne serait pas sombre mais ÉTEINT, ce qui est un défaut de rendu et non une
 * ambiance.
 */
export function intensiteDuPuits(elevation: number): number {
  const t = Math.min(1, Math.max(0, (elevation - PUITS_BAS) / (PUITS_HAUT - PUITS_BAS)))
  return PUITS_INTENSITE_MAX * (0.12 + 0.88 * t * t)
}

export interface LumiereDePuits extends SourcePlacee {
  /** Niveau dont la trémie porte cette source. */
  level: number
}

/**
 * Les sources du puits, une par niveau RÉELLEMENT percé.
 *
 * Un niveau sans trémie n'a pas de puits : la réserve est sous terre et sa
 * dalle est pleine, y allumer une descente de lumière serait un mensonge. Le
 * catalogue est donc dérivé de `slabHoles`, pas de la liste des niveaux.
 */
export function lumieresDePuits(museum: Museum): LumiereDePuits[] {
  const puits: LumiereDePuits[] = []
  for (const floor of museum.floors) {
    const tremie = plusGrandeTremie(floor)
    if (tremie === null) continue
    const elevation = floor.elevation + HAUTEUR_PUITS
    puits.push({
      level: floor.level,
      position: [tremie.x, elevation, tremie.z],
      intensity: intensiteDuPuits(elevation),
      distance: PORTEE_PUITS,
    })
  }
  return puits.sort((a, b) => a.level - b.level)
}

/** Centre de la plus grande trémie d'un niveau, ou `null` s'il n'en a pas. */
function plusGrandeTremie(floor: Floor): { x: number; z: number } | null {
  let meilleure: (typeof floor.slabHoles)[number] | null = null
  for (const trou of floor.slabHoles) {
    if (meilleure === null || trou.width * trou.depth > meilleure.width * meilleure.depth) {
      meilleure = trou
    }
  }
  if (meilleure === null) return null
  return { x: meilleure.x + meilleure.width / 2, z: meilleure.z + meilleure.depth / 2 }
}

/**
 * Les `budget` sources de puits les plus utiles pour un œil à l'altitude `y`.
 *
 * On retient une FENÊTRE CONTIGUË de niveaux autour du visiteur, et non les
 * plus proches un par un : le puits est une colonne continue, et allumer le
 * niveau du dessus et celui du dessous en sautant celui du milieu couperait le
 * faisceau en deux au beau milieu de la vue.
 *
 * La fenêtre est glissée pour rester dans les bornes du bâtiment, ce qui garde
 * le nombre de sources CONSTANT tant qu'il y a assez de niveaux percés — donc
 * pas de recompilation de shader en montant un étage.
 */
export function choisirLumieresDePuits(
  toutes: readonly LumiereDePuits[],
  y: number,
  budget: number = BUDGET_PUITS,
): LumiereDePuits[] {
  if (toutes.length <= budget) return [...toutes]

  // Le plus proche en altitude ancre la fenêtre ; on la centre puis on la
  // recale dans les bornes.
  let ancre = 0
  for (let i = 1; i < toutes.length; i++) {
    if (Math.abs(toutes[i].position[1] - y) < Math.abs(toutes[ancre].position[1] - y)) {
      ancre = i
    }
  }
  let debut = ancre - Math.floor((budget - 1) / 2)
  debut = Math.max(0, Math.min(toutes.length - budget, debut))
  return toutes.slice(debut, debut + budget)
}

// ── Réaffectation : quand recalculer ─────────────────────────────────────

/**
 * Déplacement de l'œil au-delà duquel l'allocation est refaite, en mètres.
 *
 * Refaire le classement à chaque image coûterait un tri de dix-sept éléments
 * soixante fois par seconde pour un résultat identique quatre-vingt-dix-neuf
 * fois sur cent — le visiteur marche à 3 m/s, il lui faut un tiers de seconde
 * pour franchir ce seuil. En dessous, aucune salle ne peut avoir changé de rang
 * de façon visible : les centres de salle sont à plusieurs mètres les uns des
 * autres.
 */
export const PAS_DE_REAFFECTATION = 1.0

/** Ce dont dépend une allocation. Tout changement de l'un la périme. */
export interface EtatDAllocation {
  oeil: Vec3
  /** Salle qui contient l'œil, `null` dans l'atrium ou sur une rampe. */
  salle: string | null
  /** Niveau du registre de culling, `null` avant sa première image. */
  niveau: number | null
}

/**
 * Faut-il refaire l'allocation ? Pure, donc testable sans boucle de rendu.
 *
 * Trois déclencheurs, et le troisième n'est pas cosmétique. Le registre de
 * culling met à jour son niveau dans SON `useFrame`, qui s'exécute APRÈS celui
 * de `RoomLights` (R3F souscrit les enfants avant les parents) : le niveau lu
 * ici a donc toujours une image de retard. Sans le déclencheur sur le niveau,
 * une téléportation — visite guidée, sonde de développement, sortie de rampe —
 * fige l'allocation sur le niveau d'AVANT et n'en sort jamais tant que le
 * visiteur ne remarche pas d'un mètre. Constaté à l'écran : depuis une salle du
 * premier, deux créneaux restaient accrochés au rez-de-chaussée et à la
 * réserve. Avec lui, l'image suivante corrige.
 */
export function reaffectationNecessaire(
  precedent: EtatDAllocation | null,
  courant: EtatDAllocation,
  pas: number = PAS_DE_REAFFECTATION,
): boolean {
  if (precedent === null) return true
  if (courant.salle !== precedent.salle) return true
  if (courant.niveau !== precedent.niveau) return true
  const dx = courant.oeil.x - precedent.oeil.x
  const dy = courant.oeil.y - precedent.oeil.y
  const dz = courant.oeil.z - precedent.oeil.z
  return dx * dx + dy * dy + dz * dz >= pas * pas
}

function distanceCarree(position: readonly [number, number, number], point: Vec3): number {
  const dx = position[0] - point.x
  const dy = position[1] - point.y
  const dz = position[2] - point.z
  return dx * dx + dy * dy + dz * dz
}

// ── Dimensionnement des réserves de créneaux ─────────────────────────────

/** Nombre de lumières à monter pour un musée donné. */
export interface CreneauxDeLumieres {
  /** Plafonniers réaffectables, salle courante comprise. */
  salles: number
  /** Sources de puits. */
  puits: number
  /** Total du graphe, les trois permanentes comprises. */
  total: number
}

/**
 * Combien de créneaux monter, une fois pour toutes, pour ce bâtiment.
 *
 * Deux raisons de ne pas prendre bêtement `BUDGET_SALLES` :
 *
 *  - un bâtiment de deux salles n'a pas besoin de six plafonniers, et chaque
 *    lumière montée coûte une boucle par pixel dans TOUS les shaders, même à
 *    intensité nulle ;
 *  - le total doit être garanti sous le plafond du §9.4 quoi qu'il arrive. Le
 *    vérifier ici, sur la donnée, est ce qui rend la garantie testable sans
 *    ouvrir un canvas — un `console.warn` au montage ne l'aurait pas été.
 *
 * Le résultat ne dépend QUE du musée : il ne bouge pas en marchant, donc aucun
 * shader n'est jamais recompilé après le montage.
 */
export function creneauxDeLumieres(museum: Museum): CreneauxDeLumieres {
  const nbSalles = museum.floors.reduce((somme, f) => somme + f.rooms.length, 0)
  const nbPuits = museum.floors.filter((f) => f.slabHoles.length > 0).length

  const salles = Math.min(BUDGET_SALLES, nbSalles)
  const puits = Math.min(BUDGET_PUITS, nbPuits)

  return {
    salles,
    puits,
    total: LUMIERES_PERMANENTES + salles + puits,
  }
}
