/**
 * Le GAZON : de vrais brins d'herbe, pas une texture qui brille (« un vrai
 * gazon, pas une simple texture qui brille », Philippe).
 *
 * Des dizaines de milliers de brins en UN appel de dessin : un seul brin
 * (quelques triangles effilés), instancié. Le semis est un carré de côté
 * `cote` qui SUIT la caméra en se repliant sur lui-même — chaque brin garde sa
 * place dans le monde (`coin + mod(brin − coin, cote)`), il ne fait que passer
 * d'un bord du carré à l'autre quand on marche. Au-delà de `rayon`, les brins
 * rapetissent jusqu'à rien : la pelouse texturée, mate, prend le relais.
 *
 * Le shader lit une carte du sol (0,5 m par texel) : la cote du relief
 * (`hauteurDuParc`) et où l'herbe a le droit de pousser — ni sur le parvis, ni
 * dans une allée, ni dans l'eau, ni au pied d'un tronc. Le vent la couche en
 * vagues ; la lumière du jour (Lambert, sans reflet) l'assombrit la nuit.
 */
import * as THREE from 'three'

import type { Allee, Parc } from '../plan/park'
import { surUneAllee } from '../plan/park'
import { BORDURE, GALETS, champDesAllees } from '../plan/allees'
import { JARDIN, TABLIER, distanceEtang, distanceRuisseau, presDeLEau } from '../plan/jardin'
import { distanceParvis, hauteurDuParc } from '../plan/relief'
import { INTEMPERIES } from './intemperies'
import type { Rect } from '../plan/types'

/** Un texel de la carte du sol, en mètres. */
const TEXEL = 0.5
/** Les niveaux d'un brin : assez pour qu'il se courbe. */
const NIVEAUX = 3
/** L’herbe s’arrête à tant de l’eau : là où la berge creusée (build-jardin.py) plonge vraiment. */
const BERGE = 1.2

const dansRect = (r: Rect, x: number, z: number, marge = 0) =>
  x >= r.x - marge && x <= r.x + r.width + marge && z >= r.z - marge && z <= r.z + r.depth + marge

/** Le rayon nu au pied d’un sujet, par essence : le tronc d’un érable (× taille), une boule taillée (× encombrement). */
const PIED: Partial<Record<string, number>> = { 'erable-rouge': 0.25, 'erable-vert': 0.25, buis: 0.7, azalee: 0.7 }

/**
 * La distance à l’eau au centre de la maille d’un mètre qui contient (x, z). Une
 * distance varie d’au plus 0,71 m sur la maille : sa valeur borne tous ses points.
 */
const EAU = new Map<string, number>()
function eauProche(x: number, z: number): number {
  const [i, j] = [Math.floor(x), Math.floor(z)]
  const cle = `${i}:${j}`
  let d = EAU.get(cle)
  if (d === undefined) EAU.set(cle, (d = Math.min(distanceRuisseau(i + 0.5, j + 0.5), distanceEtang(i + 0.5, j + 0.5))))
  return d
}

/** Le sol nu : hors du terrain, sur le parvis ou le tablier, dans l'eau et ses berges creusées. */
function solNu(parc: Parc, x: number, z: number): boolean {
  if (!dansRect(parc.terrain, x, z) || distanceParvis(parc.parvis, x, z) < 0.1 || dansRect(TABLIER, x, z, 0.6)) return true
  // L’eau, coûteuse à tester : seulement au jardin, dans une maille à cheval sur la berge.
  if (!JARDIN.zones.some((r) => dansRect(r, x, z, 2))) return false
  const d = eauProche(x, z)
  return d < BERGE - 0.71 || (d < BERGE + 0.71 && presDeLEau(x, z, BERGE))
}

/** Ce qui dégarnit le gazon, hors des allées, en bandes (un disque est une bande de longueur nulle). */
function pelades(parc: Parc): Allee[] {
  const disque = (x: number, z: number, r: number): Allee => ({ a: { x, z }, b: { x, z }, largeur: 2 * r })
  return [
    ...parc.plantations.map((p) => {
      const r = p.espece.startsWith('rocher') ? p.rayon * 0.6 : (PIED[p.espece] ?? 0) * (p.espece.startsWith('erable') ? p.scale : p.rayon)
      return disque(p.x, p.z, r)
    }),
    disque(JARDIN.lanterne.x, JARDIN.lanterne.z, 0.5),
    ...JARDIN.pas.map(([x, z]) => disque(x, z, 0.45)),
  ].filter((p) => p.largeur > 0)
}

export interface CarteDuSol {
  /** Rouge = cote du relief ; vert = 1 où l'herbe pousse. Demi-flottants, filtrés. */
  texture: THREE.DataTexture
  /** Le rectangle couvert, (x, z, largeur, profondeur) : le shader en tire ses coordonnées. */
  cadre: THREE.Vector4
}

/**
 * La carte du sol, un texel par `TEXEL`. Allées, pieds et pierres sont
 * estampés chacun sur sa boîte englobante : les tester tous à chaque texel
 * bloquait le chargement près d'une seconde.
 */
export function carteDuSol(parc: Parc): CarteDuSol {
  const { terrain } = parc
  const [nx, nz] = [Math.round(terrain.width / TEXEL), Math.round(terrain.depth / TEXEL)]
  const data = new Uint16Array(nx * nz * 4)
  const [un, zero] = [THREE.DataUtils.toHalfFloat(1), THREE.DataUtils.toHalfFloat(0)]
  const centre = (i: number, j: number) => [terrain.x + (i + 0.5) * TEXEL, terrain.z + (j + 0.5) * TEXEL] as const
  // Pas un brin dans l'allée, sur sa bordure ni dans son lit de galets (`allees.ts`) :
  // la pelouse s'arrête net au bord, et le filtrage éclaircit les brins qui le touchent.
  const { reseau } = champDesAllees(parc)
  const bord = BORDURE.dehors + GALETS - 0.1
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, z] = centre(i, j)
      const k = (j * nx + i) * 4
      data[k] = THREE.DataUtils.toHalfFloat(hauteurDuParc(x, z))
      data[k + 1] = solNu(parc, x, z) || reseau(x, z) < bord ? zero : un
      data[k + 3] = un
    }
  }
  for (const p of pelades(parc)) {
    const m = p.largeur / 2
    const [i0, i1] = [Math.max(0, Math.floor((Math.min(p.a.x, p.b.x) - m - terrain.x) / TEXEL)), Math.min(nx - 1, Math.ceil((Math.max(p.a.x, p.b.x) + m - terrain.x) / TEXEL))]
    const [j0, j1] = [Math.max(0, Math.floor((Math.min(p.a.z, p.b.z) - m - terrain.z) / TEXEL)), Math.min(nz - 1, Math.ceil((Math.max(p.a.z, p.b.z) + m - terrain.z) / TEXEL))]
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (surUneAllee([p], ...centre(i, j))) data[(j * nx + i) * 4 + 1] = zero
  }
  const texture = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { texture, cadre: new THREE.Vector4(terrain.x, terrain.z, terrain.width, terrain.depth) }
}

/** FNV-1a puis mulberry32, comme `park.ts` : le même gazon à chaque chargement. */
function generateur(graine: number): () => number {
  let etat = graine >>> 0
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ReglageGazon {
  nombre: number
  /** Côté du carré semé, en mètres : deux fois le rayon, au moins. */
  cote: number
  /** Au-delà, plus un brin : la pelouse texturée prend le relais. */
  rayon: number
  /** Largeur d'un brin à sa base, et sa hauteur (min, max). */
  largeur: number
  hauteur: [number, number]
}

/**
 * Un brin effilé, instancié `nombre` fois. `position.x` ∈ [−½, ½] est le
 * travers, déjà effilé ; `position.y` ∈ [0, 1] la hauteur relative.
 */
export function brinsDeGazon({ nombre, cote }: ReglageGazon, graine = 7): THREE.InstancedBufferGeometry {
  const pos: number[] = []
  const index: number[] = []
  for (let k = 0; k < NIVEAUX; k++) {
    const t = k / NIVEAUX
    const l = 0.5 * (1 - t) ** 0.7
    pos.push(-l, t, 0, l, t, 0)
    if (k > 0) index.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k)
  }
  pos.push(0, 1, 0)
  const pointe = 2 * NIVEAUX
  index.push(pointe - 2, pointe - 1, pointe)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setIndex(index)
  const alea = generateur(graine)
  const brins = new Float32Array(nombre * 4)
  for (let i = 0; i < nombre; i++) brins.set([alea() * cote, alea() * cote, alea(), alea()], 4 * i)
  g.setAttribute('aBrin', new THREE.InstancedBufferAttribute(brins, 4))
  g.instanceCount = nombre
  return g
}

export interface MatiereGazon {
  material: THREE.MeshLambertMaterial
  /** À chaque image : la caméra (x, z) et le temps, pour le repli du semis et le vent. */
  animer: (x: number, z: number, t: number) => void
}

/** Le brin en Lambert : diffus seul, aucun reflet, éclairé par le soleil et le ciel de l'heure. */
export function matiereGazon(sol: CarteDuSol, { cote, rayon, largeur, hauteur }: ReglageGazon): MatiereGazon {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
  const uniforms = {
    uCam: { value: new THREE.Vector2() },
    uTemps: { value: 0 },
    uSol: { value: sol.texture },
    uCadre: { value: sol.cadre },
    uCote: { value: cote },
    uRayon: { value: rayon },
    uLargeur: { value: largeur },
    uHauteur: { value: new THREE.Vector2(...hauteur) },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, INTEMPERIES)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec2 uCam;
uniform float uTemps, uCote, uRayon, uLargeur;
uniform vec2 uHauteur;
uniform vec4 uCadre;
uniform sampler2D uSol;
uniform float uEnneige, uVent;
attribute vec4 aBrin;
varying float vT;
varying float vTeinte;`)
      .replace('#include <beginnormal_vertex>', `
  // Le semis replié autour de la caméra : chaque brin garde sa place au monde.
  vec2 coin = uCam - 0.5 * uCote;
  vec2 p = coin + mod(aBrin.xy - coin, uCote);
  vec2 st = (p - uCadre.xy) / uCadre.zw;
  vec4 sol = textureLod(uSol, st, 0.0);
  float dedans = step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
  // Plus clairsemé en bord de pelouse (le vert filtré descend vers 0) : pas de lisière au cordeau.
  float garde = smoothstep(aBrin.z * 0.7 + 0.15, aBrin.z * 0.7 + 0.3, sol.g) * dedans;
  float fondu = 1.0 - smoothstep(uRayon * 0.6, uRayon, distance(p, uCam));
  // Sous la neige, on ne voit plus que la pointe des plus hauts brins.
  float h = mix(uHauteur.x, uHauteur.y, aBrin.w * aBrin.w) * garde * fondu * (1.0 - 0.85 * uEnneige);
  float t = position.y;
  float a = aBrin.z * 43.0;
  vec2 travers = vec2(cos(a), sin(a));
  vec2 face = vec2(-travers.y, travers.x);
  // Chaque brin penche un peu à sa façon ; le vent passe en vagues sur la pelouse.
  float vent = sin(uTemps * 1.3 + p.x * 0.31 + p.y * 0.17) * 0.6 + sin(uTemps * 2.9 + p.x * 1.1 - p.y * 0.7) * 0.25;
  vec2 penche = face * (fract(aBrin.w * 17.0) - 0.5) * 0.9 + vec2(0.8, 0.45) * vent * 0.45 * clamp(0.6 + 0.2 * uVent, 0.5, 3.0);
  float courbe = t * t;
  vec3 herbe = vec3(p.x, sol.r - 0.03 + t * h * (1.0 - 0.25 * courbe * dot(penche, penche)), p.y);
  herbe.xz += travers * position.x * uLargeur * min(1.0, h * 6.0) + penche * courbe * h;
  // Des normales tirées vers le haut : l'herbe s'éclaire comme le sol qui la porte.
  vec3 objectNormal = normalize(vec3(face.x, 2.5, face.y));
  vT = t;
  vTeinte = fract(aBrin.z * 7.0 + aBrin.w * 3.0);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = herbe;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uEnneige, uMouille, uJaune, uTerne;
varying float vT;
varying float vTeinte;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
  // Sombre au pied, à l'ombre des autres brins ; plus clair et plus jaune à la pointe.
  vec3 pointe = mix(vec3(0.12, 0.26, 0.05), vec3(0.23, 0.33, 0.07), vTeinte);
  pointe = mix(pointe, vec3(0.08, 0.2, 0.06), step(0.8, vTeinte));
  vec4 diffuseColor = vec4(mix(vec3(0.045, 0.09, 0.022), pointe, smoothstep(0.0, 0.9, vT)), opacity);
  // La saison (jaunie fin d'été, éteinte l'hiver), la pluie qui fonce, le givre des pointes.
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.45, 1.15, 0.45), uJaune * 0.6 * vT);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.2, 1.05, 0.6), uTerne * 0.65) * (1.0 - 0.15 * uTerne) * (1.0 - 0.3 * uMouille);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.93), uEnneige * (0.45 + 0.5 * smoothstep(0.2, 1.0, vT)));`)
      // Double face, mais la normale reste celle du dessus : le revers d'un brin n'est pas noir.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );')
  }
  return {
    material,
    animer: (x, z, t) => {
      uniforms.uCam.value.set(x, z)
      uniforms.uTemps.value = t
    },
  }
}
