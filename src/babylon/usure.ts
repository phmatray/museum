/**
 * Les matières qui ont vécu, dehors (`userFacade` et `pietiner` de three) : la
 * façade coulée sous ses saillies, éclaboussée au pied, verdie au nord, ses
 * pierres épaufrées aux arêtes ; le gravier foulé au milieu des allées, verdi
 * sur les bords, les joints du dallage moussus là où l'on ne marche pas.
 *
 * Où, et combien, vient de la géométrie (`plan/usure.ts` : la façade dépliée et
 * le sol du parc vu du ciel, deux textures partagées) ; le shader n'ajoute que
 * le grain. Greffes de priorité 250 : après les Lueurs (200), avant
 * `intemperer` (300), pour que la pluie et la neige passent par-dessus l'usure.
 * Dedans (pied des plinthes, terrazzo terni) et le chaperon de l'enceinte sont
 * dans parement.ts et enceinte.ts.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Box } from '../plan/mesh.ts'
import { MUSEE } from '../plan/musee.ts'
import { COTE_DALLAGE } from '../plan/relief.ts'
import { SALISSURE, carteDesPassages, carteDesSalissures } from '../plan/usure.ts'
import { gabaritCube } from './boites.ts'
import { dialecte, greffer } from './greffe.ts'
import { bruit, METEO } from './intemperies.ts'
import { PARC } from './parc.ts'
import { attributsDUsure } from './parement.ts'

const f = (x: number) => `(${x.toFixed(4)})`

/** Une texture par scène et par carte, calculée au premier appel. */
function uneParScene(creer: (s: Scene) => RawTexture): (s: Scene) => RawTexture {
  const deja = new WeakMap<Scene, RawTexture>()
  return (s) => {
    const t = deja.get(s) ?? creer(s)
    deja.set(s, t)
    return t
  }
}

/** La façade dépliée (`carteDesSalissures`) : R coulure, G eau des angles, B abri ; quatre faces empilées. */
const carteFacade = uneParScene((scene) => {
  const c = carteDesSalissures(MUSEE)
  const t = new RawTexture(c.data, c.nu, c.nv * 4, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE
  return t
})

/** Le sol du parc vu du ciel (`carteDesPassages`) : R le piétinement, G la mousse (en RGBA : pas d'alignement de ligne à craindre). */
const carteDuParc = uneParScene((scene) => {
  const c = carteDesPassages(PARC, MUSEE)
  const rgba = new Uint8Array(c.nx * c.nz * 4)
  for (let i = 0; i < c.nx * c.nz; i++) rgba.set([c.data[2 * i], c.data[2 * i + 1], 0, 255], 4 * i)
  const t = new RawTexture(rgba, c.nx, c.nz, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE
  return t
})

function echantillonneur(wgsl: boolean, n: string): string {
  return wgsl ? `var ${n}Sampler: sampler;\nvar ${n}: texture_2d<f32>;` : `uniform sampler2D ${n};`
}
const lire = (wgsl: boolean, n: string, uv: string) => (wgsl ? `textureSample(${n}, ${n}Sampler, ${uv})` : `texture2D(${n}, ${uv})`)
const S = (wgsl: boolean, c: string, a: string, b: string) => (wgsl ? `select(${b}, ${a}, ${c})` : `(${c} ? ${a} : ${b})`)

/**
 * Le code de `userFacade` (exporté pour les tests) : coulures, eau des angles,
 * abri sous les saillies (la carte), éclaboussures au pied, mousse et algues au
 * nord, poussière sur les dessus ; `pierre` grise les coulures, ajoute la patine
 * du calcaire et les arêtes épaufrées (attributs `boite`/`taille`).
 */
export function codeFacade(wgsl: boolean, pierre: boolean) {
  const { V, G, u, fin, tr, rugosite, attribut, varying, vin, vout } = dialecte(wgsl)
  const { u0, largeur, hauteur } = SALISSURE
  const P = fin('vPositionW')
  const [B, T] = [fin('vuBoite'), fin('vuTaille')]
  const corps = tr(`{
  ${V('uNw', 'vec3', `normalize(${fin('vNormalW')})`)}
  ${V('uVert', 'float', '1.0 - smoothstep(0.35, 0.65, abs(uNw.y))')}
  ${V('uD', 'vec4', `vec4(-${P}.z, ${P}.z - ${f(MUSEE.depth)}, -${P}.x, ${P}.x - ${f(MUSEE.width)})`)}
  ${V('uM', 'float', 'max(max(uD.x, uD.y), max(uD.z, uD.w))')}
  ${V('uF', 'float', S(wgsl, 'uM == uD.x', '0.0', S(wgsl, 'uM == uD.y', '1.0', S(wgsl, 'uM == uD.z', '2.0', '3.0'))))}
  ${V('uU', 'float', S(wgsl, 'uF < 1.5', `${P}.x`, `${P}.z`))}
  ${V('uUV', 'vec2', `vec2((uU - ${f(u0)}) / ${f(largeur)}, (uF + clamp(${P}.y / ${f(hauteur)}, 0.006, 0.994)) / 4.0)`)}
  ${V('uS', 'vec3', `${lire(wgsl, 'usSalissure', 'uUV')}.rgb`)}
  usRugoA = 0.0;
  usRugoB = 0.0;
  if (uM > -0.02) {
    // Le fil des coulures : étiré en hauteur, chacune sa largeur, quelques-unes franches.
    ${V('uFil', 'float', `usBruit(vec2(uU * 26.0, ${P}.y * 0.8)) * 0.5 + usBruit(vec2(uU * 7.0, ${P}.y * 0.25)) * 0.35 + usBruit(vec2(uU * 61.0, ${P}.y * 1.5)) * 0.15`)}
    ${V('uCoule', 'float', 'smoothstep(0.06, 0.55, uS.r * (0.15 + 1.6 * uFil * uFil)) * uVert')}
    ${V('uAngle', 'float', `smoothstep(0.1, 0.75, uS.g * (0.5 + 1.0 * usBruit(vec2(uU * 8.0, ${P}.y * 0.45)))) * uVert`)}
    ${V('uAbri', 'float', `uS.b * uVert * (0.55 + 0.45 * usBruit(vec2(uU * 3.1, ${P}.y * 3.7)))`)}
    ${V('uSale', 'vec3', pierre ? 'vec3(0.4, 0.39, 0.37)' : 'vec3(0.42, 0.4, 0.4)')}
    surfaceAlbedo *= mix(vec3(1.0), uSale, clamp(uCoule * 0.85 + uAngle * 0.7 + uAbri * 0.45, 0.0, 0.9));
    // Sous l'averse, l'eau suit les coulures et les angles : ils luisent.
    usRugoA = ${u('usMouille')} * max(uCoule, uAngle) * 0.8;
    // Le pied : la pluie rejaillit du parvis sur une quarantaine de centimètres.
    ${V('uHaut', 'float', `${P}.y - ${f(COTE_DALLAGE)}`)}
    ${V('uBord', 'float', '0.24 + 0.12 * usBruit(vec2(uU * 2.3, 1.7)) + 0.07 * usBruit(vec2(uU * 13.0, 4.1))')}
    ${V('uEclab', 'float', `(1.0 - smoothstep(uBord - 0.14, uBord, uHaut)) * uVert * (0.6 + 0.4 * usBruit(vec2(uU * 19.0, ${P}.y * 23.0)))`)}
    surfaceAlbedo *= mix(vec3(1.0), vec3(0.6, 0.56, 0.5), uEclab);
    // Au nord, jamais au soleil : la mousse gagne le pied, et les dessus des appuis.
    ${V('uNord', 'float', 'step(uF, 0.5)')}
    ${V('uTache', 'float', `smoothstep(0.45, 0.75, usBruit(vec2(uU * 3.3, ${P}.y * 4.1)) * 0.55 + usBruit(vec2(uU * 14.0, ${P}.y * 15.0)) * 0.3 + usBruit(vec2(uU * 47.0, ${P}.y * 47.0)) * 0.15)`)}
    ${V('uMonte', 'float', '0.12 + 0.35 * usBruit(vec2(uU * 1.3, 5.0))')}
    ${V('uMousse', 'float', 'uNord * uTache * max((1.0 - smoothstep(0.0, uMonte, uHaut)) * uVert, smoothstep(0.6, 0.9, uNw.y) * 0.7)')}
    ${V('uL', 'float', 'dot(surfaceAlbedo, vec3(0.3, 0.59, 0.11))')}
    surfaceAlbedo = mix(surfaceAlbedo, vec3(0.19, 0.23, 0.11) * (0.6 + 0.7 * uL), uMousse * 0.6);
    // Et le nord verdit d'un voile d'algues, plus haut que la mousse.
    surfaceAlbedo *= mix(vec3(1.0), vec3(0.86, 0.92, 0.8), uNord * uVert * (1.0 - smoothstep(0.2, 1.2, uHaut)) * 0.8);${pierre ? `
    // La patine du calcaire : des pans plus gris, d'autres plus chauds, à l'échelle des blocs.
    ${V('uPat', 'float', `usBruit(vec2(uU * 0.7, ${P}.y * 0.9) + uF * 13.0) * 0.6 + usBruit(vec2(uU * 2.6, ${P}.y * 3.1)) * 0.4`)}
    surfaceAlbedo *= mix(vec3(0.84, 0.84, 0.83), vec3(1.03, 1.01, 0.97), uPat);` : ''}
    // Les dessus : la poussière et la suie que la pluie n'emporte pas tout à fait.
    ${V('uDessus', 'float', `smoothstep(0.6, 0.9, uNw.y) * (0.55 + 0.45 * usBruit(vec2(uU * 5.0, ${P}.y * 9.0 + uF)))`)}
    surfaceAlbedo *= 1.0 - 0.22 * uDessus;
  }${pierre ? `
  {
    // Les arêtes épaufrées (ECLATS(1) de three).
    ${V('uE', 'vec3', `${T} * 0.5 - abs(${B})`)}
    ${V('uLo', 'float', 'min(uE.x, min(uE.y, uE.z))')}
    ${V('uHi', 'float', 'max(uE.x, max(uE.y, uE.z))')}
    ${V('uArete', 'float', 'uE.x + uE.y + uE.z - uLo - uHi')}
    ${V('uT', 'float', `dot(${P}, vec3(1.0, 0.83, 1.17))`)}
    ${V('uN', 'float', 'usBruit(vec2(uT * 9.0, 1.3)) * 0.5 + usBruit(vec2(uT * 27.0, 7.7)) * 0.3 + usBruit(vec2(uT * 71.0, 2.9)) * 0.2')}
    ${V('uLarge', 'float', '0.004 + 0.07 * pow(uN, 1.8)')}
    ${V('uEclat', 'float', '1.0 - smoothstep(uLarge * 0.75, uLarge, uArete)')}
    ${V('uLisere', 'float', '(1.0 - uEclat) * (1.0 - smoothstep(uLarge, uLarge + 0.004, uArete)) * step(0.006, uLarge)')}
    surfaceAlbedo *= mix(1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.008, uArete)) + 0.12 * uLisere, 0.68, uEclat);
    usRugoB = 0.1 * uEclat;
  }` : ''}
}`)
  return {
    vertex: pierre
      ? {
          CUSTOM_VERTEX_DEFINITIONS: `${attribut('boite', 'vec3')}\n${attribut('taille', 'vec3')}\n${varying('vuBoite', 'vec3')}\n${varying('vuTaille', 'vec3')}`,
          CUSTOM_VERTEX_MAIN_END: `${vout('vuBoite')} = ${vin('boite')};\n${vout('vuTaille')} = ${vin('taille')};`,
        }
      : undefined,
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${pierre ? `${varying('vuBoite', 'vec3')}\n${varying('vuTaille', 'vec3')}\n` : ''}${G('usRugoA', 'float')}\n${G('usRugoB', 'float')}\n${echantillonneur(wgsl, 'usSalissure')}\n${bruit(wgsl, 'us')}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: corps,
      [rugosite]: '$0\nroughness = min(1.0, mix(roughness, 0.22, usRugoA) + usRugoB);\nmicroSurface = 1.0 - roughness;',
    },
  }
}

/**
 * La façade usée (`userFacade` de three) ; `pierre` : avec les arêtes
 * épaufrées, qui lisent la position dans la boîte (poser `attributsFacade` sur le maillage).
 */
export function userFacade(m: Material, { pierre = false } = {}): void {
  const t = carteFacade(m.getScene())
  greffer(m, {
    nom: pierre ? 'UsureFacadePierre' : 'UsureFacade',
    priorite: 250,
    attributs: pierre ? ['boite', 'taille'] : [],
    samplers: ['usSalissure'],
    uniforms: [{ name: 'usMouille', size: 1, type: 'float' }],
    lier: (ubo) => {
      ubo.updateFloat('usMouille', METEO.mouille)
      ubo.setTexture('usSalissure', t)
    },
    code: (wgsl) => codeFacade(wgsl, pierre),
  })
}

/** Les attributs `boite`/`taille` des arêtes épaufrées, sur un maillage de `boitesFusionnees`. */
export function attributsFacade(m: Mesh, boites: readonly Box[]): void {
  const a = attributsDUsure(gabaritCube(m.getScene()), boites)
  m.setVerticesData('boite', a.boite, false, 3)
  m.setVerticesData('taille', a.taille, false, 3)
}

/**
 * Le code de `pietiner` (exporté pour les tests) : le milieu foulé, la mousse
 * des bords. `joints` : le dallage (blocs de 1,20 × 0,60 m à joints croisés,
 * lus sur l'UV en mètres), poli au milieu, moussu dans les joints, lichen.
 */
export function codePietiner(wgsl: boolean, joints: boolean) {
  const { V, G, fin, tr, rugosite } = dialecte(wgsl)
  const P = fin('vPositionW')
  const t = PARC.terrain
  const corps = tr(`{
  ${V('uP', 'vec2', `${lire(wgsl, 'usPassage', `(${P}.xz - vec2(${f(t.x)}, ${f(t.z)})) / vec2(${f(t.width)}, ${f(t.depth)})`)}.rg`)}
  ${V('uB', 'float', `usBruit(${P}.xz * 2.1) * 0.55 + usBruit(${P}.xz * 7.3) * 0.3 + usBruit(${P}.xz * 23.0) * 0.15`)}
  // Le milieu foulé : la trace s'effiloche sur ses bords.
  ${V('uPas', 'float', 'smoothstep(0.15, 0.75, uP.r + (uB - 0.5) * 0.45)')}
  ${V('uL', 'float', 'dot(surfaceAlbedo, vec3(0.3, 0.59, 0.11))')}${joints ? `
  ${V('uMousse', 'float', '0.0')}
  ${V('uJoint', 'float', '0.0')}
  ${V('uDalle', 'float', '0.5')}
#ifdef MAINUV1
  {
    // Les joints du dallage, lus sur l'UV en mètres.
    ${V('uM', 'vec2', fin('vMainUV1'))}
    ${V('uRang', 'float', 'floor(uM.y / 0.6)')}
    ${V('uDec', 'float', S(wgsl, 'uRang - 2.0 * floor(uRang / 2.0) < 0.5', '0.6', '0.0'))}
    ${V('uFz', 'float', 'fract(uM.y / 0.6)')}
    ${V('uFx', 'float', 'fract((uM.x - uDec) / 1.2)')}
    ${V('uJz', 'float', 'min(uFz, 1.0 - uFz) * 0.6')}
    ${V('uJx', 'float', 'min(uFx, 1.0 - uFx) * 1.2')}
    ${V('uJ', 'float', 'min(uJz, uJx)')}
    ${V('uCol', 'float', 'floor((uM.x - uDec) / 1.2)')}
    // Chaque dalle s'use à sa façon : l'une plus que sa voisine.
    uDalle = usHash(vec2(uCol, uRang) + 0.5);
    // Le joint lui-même, un tronçon par côté de dalle : la mousse le prend, ou pas.
    ${V('uTroncon', 'vec2', S(wgsl, 'uJz < uJx', 'vec2(uCol, floor(uM.y / 0.6 + 0.5))', 'vec2(floor((uM.x - uDec) / 1.2 + 0.5), uRang + 300.0)'))}
    ${V('uPris', 'float', 'usHash(uTroncon * 1.37 + 11.0)')}
    // À l'ombre et contre le mur, la plupart des joints ; au soleil, quelques-uns.
    ${V('uSeuil', 'float', '1.0 - 0.95 * uP.g')}
    ${V('uPlein', 'float', 'smoothstep(uSeuil, uSeuil + 0.3, uPris)')}
    // Et le long du joint, la mousse s'interrompt par touffes.
    ${V('uLong', 'float', S(wgsl, 'uJz < uJx', 'uM.x', 'uM.y'))}
    ${V('uTouffe', 'float', 'smoothstep(0.35, 0.65, usBruit(vec2(uLong * 7.0, uPris * 40.0)) * 0.7 + usBruit(vec2(uLong * 23.0, uPris * 9.0)) * 0.3)')}
    ${V('uLarge', 'float', '0.005 + 0.02 * uPlein * uP.g')}
    uJoint = 1.0 - smoothstep(0.004, 0.012, uJ);
    uMousse = (1.0 - smoothstep(uLarge * 0.5, uLarge, uJ)) * uPlein * uTouffe * smoothstep(0.08, 0.4, uP.g);
  }
#endif
  // Foulé : la pierre ne fonce pas, elle se POLIT ; la crasse va aux bords de la trace et dans ses joints.
  ${V('uTache', 'float', `usBruit(${P}.xz * 1.3 + 3.0) * 0.6 + usBruit(${P}.xz * 4.1) * 0.4`)}
  ${V('uPoli', 'float', 'min(1.0, uPas * (0.55 + 0.3 * uDalle + 0.3 * uTache))')}
  ${V('uBordTrace', 'float', 'smoothstep(0.05, 0.3, uP.r) * (1.0 - smoothstep(0.35, 0.7, uP.r)) * (0.5 + 0.5 * uTache)')}
  surfaceAlbedo *= (1.0 + 0.05 * uPoli) * (1.0 - 0.1 * uBordTrace) * (1.0 - 0.28 * uJoint * smoothstep(0.1, 0.5, uP.r));
  usPlancher = 0.3;
  usPoli = 0.3 * uPoli;
  // Et, où l'on ne marche jamais, du lichen par plaques sur la pierre même.
  ${V('uLichen', 'float', 'smoothstep(0.62, 0.8, uB) * smoothstep(0.35, 0.8, uP.g)')}
  // La mousse des joints : vert-brun sombre, éteint, pas un néon.
  ${V('uVertMousse', 'vec3', `mix(vec3(0.1, 0.11, 0.06), vec3(0.17, 0.19, 0.09), usBruit(${P}.xz * 5.0))`)}
  surfaceAlbedo = mix(surfaceAlbedo, uVertMousse * (0.8 + 0.6 * uL), uMousse * 0.85);
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(0.84, 0.86, 0.78), uLichen * 0.45);` : `
  // Le gravier tassé : moins de cailloux clairs qui roulent, la terre qui affleure entre eux.
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.4 + 0.35 * uL) * vec3(0.92, 0.86, 0.76), uPas * 0.5) * (1.0 - 0.22 * uPas);
  usPlancher = 0.5;
  usPoli = 0.1 * uPas;
  // Sur les bords qu'on ne foule pas, entre les cailloux, le vert qui prend.
  ${V('uVert', 'float', 'smoothstep(0.45, 0.8, uP.g * (0.55 + 0.9 * uB)) * smoothstep(0.55, 0.25, uL)')}
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.15, 0.2, 0.07) * (0.6 + 1.2 * uL), uVert * 0.7);`}
}`)
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${G('usPlancher', 'float')}\n${G('usPoli', 'float')}\n${echantillonneur(wgsl, 'usPassage')}\n${bruit(wgsl, 'us')}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: corps,
      [rugosite]: '$0\nroughness = max(usPlancher, roughness - usPoli);\nmicroSurface = 1.0 - roughness;',
    },
  }
}

/** Le sol du parc sous les pas (`pietiner` de three) ; `joints` pour le dallage de pierre. */
export function pietiner(m: Material, { joints = false } = {}): void {
  const t = carteDuParc(m.getScene())
  greffer(m, {
    nom: joints ? 'UsureDalles' : 'UsureGravier',
    priorite: 250,
    samplers: ['usPassage'],
    lier: (ubo) => ubo.setTexture('usPassage', t),
    code: (wgsl) => codePietiner(wgsl, joints),
  })
}
