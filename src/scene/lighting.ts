/**
 * LOT 3 — L'éclairage peint (spec §9.2).
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

import type { ThemeId, Wall } from '../domain/types'

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
    color: palette.wall,
    roughness: palette.roughness,
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
