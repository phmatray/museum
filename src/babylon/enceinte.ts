/**
 * Le MUR D'ENCEINTE du parc (`plan/enceinte.ts`, Enceinte de ParkLayer.tsx) :
 * brique du musée, chaperon et piles de pierre, grilles de fer forgé ; et les
 * pierres du belvédère (`pierresDuBelvedere`) : ses murs et son parapet dans le
 * lot de pierre, sa terrasse et ses marches dans le `dallage` du parvis. Quatre
 * maillages fusionnés (UV en mètres), quatre appels de dessin. Les boîtes sont
 * déjà calées sur `hauteurDuParc` : posées telles quelles.
 *
 * Le mur a vécu (`vieillirBrique`, `mousserChaperon` + `ECLATS(1)` de three) :
 * deux greffes, `VieuxMur` sur la brique et `Chaperon` sur la pierre, qui lisent
 * la position dans la boîte (`attributsDUsure`) ; puis `intemperer` (pluie, neige) par-dessus.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { pierresDuBelvedere } from '../plan/belvedere.ts'
import { enceinte } from '../plan/enceinte.ts'
import type { Box } from '../plan/mesh.ts'
import { hauteurDuParc } from '../plan/relief.ts'
import { boitesFusionnees, gabaritCube, matiere } from './boites.ts'
import { dialecte, greffer } from './greffe.ts'
import { intemperer } from './intemperies.ts'
import { brancherLueurs } from './lueurs.ts'
import { attributsDUsure } from './parement.ts'
import { dallage, PARC } from './parc.ts'
import { creerBrique, creerPierre } from './pierre.ts'

/** Le mur, calculé une fois : le lierre (lierre.ts, végétation) en lit les pieds et les plaques. */
export const MUR = enceinte(PARC.terrain, PARC.allees)

/** Les quatre lots : brique, pierre (mur + murs du belvédère), foulées (terrasse et marches du belvédère), fer. */
export function lotsDeLEnceinte(): { brique: Box[]; pierre: Box[]; foulees: Box[]; fer: Box[] } {
  const b = pierresDuBelvedere(hauteurDuParc)
  return {
    brique: MUR.brique,
    pierre: [...MUR.pierre, ...b.filter((x) => x.kind === 'wall')],
    foulees: b.filter((x) => x.kind !== 'wall'),
    fer: MUR.fer,
  }
}

/** Le hachage et le bruit de valeur de three (`iHash`, `iBruit`), et `mod`, absent du WGSL. */
function outils(wgsl: boolean): string {
  const { fn, V, tr } = dialecte(wgsl)
  return tr(`
${fn('emHash', [['p', 'vec2']], 'float', 'return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);')}
${fn('emBruit', [['p', 'vec2']], 'float', `
  ${V('i', 'vec2', 'floor(p)')}
  ${V('fr', 'vec2', 'fract(p)')}
  ${V('u', 'vec2', 'fr * fr * (3.0 - 2.0 * fr)')}
  return mix(mix(emHash(i), emHash(i + vec2(1.0, 0.0)), u.x), mix(emHash(i + vec2(0.0, 1.0)), emHash(i + vec2(1.0, 1.0)), u.x), u.y);`)}
${fn('emMod', [['a', 'float'], ['b', 'float']], 'float', 'return a - b * floor(a / b);')}`)
}

/** `boite` / `taille` (attributs d'usure) passés au fragment. */
function sommets(wgsl: boolean): Record<string, string> {
  const { attribut, varying, vin, vout } = dialecte(wgsl)
  return {
    CUSTOM_VERTEX_DEFINITIONS: `${attribut('boite', 'vec3')}\n${attribut('taille', 'vec3')}\n${varying('vmBoite', 'vec3')}\n${varying('vmTaille', 'vec3')}`,
    CUSTOM_VERTEX_MAIN_END: `${vout('vmBoite')} = ${vin('boite')};\n${vout('vmTaille')} = ${vin('taille')};`,
  }
}

/**
 * `vieillirBrique` de three (intemperies.ts) : pans de fournée, coulures, pied
 * humide, algues plus hautes au nord ; sur les faces verticales, brique par
 * brique : cuisson, reprises au ciment, briques isolées, salpêtre. L'UV brute
 * (vMainUV1) est déjà en mètres : c'est le `vMapUv × motif` de three.
 */
function vieuxMur(wgsl: boolean) {
  const { V, varying, fin, fn, tr } = dialecte(wgsl)
  const [P, B, T] = [fin('vPositionW'), fin('vmBoite'), fin('vmTaille')]
  const N = `normalize(${fin('vNormalW')})`
  const fragment = tr(`{
  ${V('iN', 'vec3', N)}
  ${V('iDans', 'float', `${B}.y / max(${T}.y, 0.0001) + 0.5`)}
  ${V('iS', 'float', `${P}.x + ${P}.z`)}
  ${V('iPan', 'float', `emBruit(vec2(iS * 0.18, ${P}.y * 0.35)) * 0.7 + emBruit(vec2(iS * 0.7, ${P}.y * 1.3)) * 0.3`)}
  surfaceAlbedo *= mix(vec3(0.78, 0.78, 0.8), vec3(1.08, 1.0, 0.94), iPan);
  ${V('iCol', 'float', 'emBruit(vec2(iS * 3.1, 0.5)) * emBruit(vec2(iS * 0.45, 2.5))')}
  ${V('iLong', 'float', '0.35 + 0.5 * emBruit(vec2(iS * 2.3, 7.1))')}
  ${V('iCoule', 'float', `smoothstep(0.2, 0.5, iCol) * smoothstep(1.0 - iLong, 1.0, iDans) * (0.6 + 0.4 * emBruit(vec2(iS * 9.0, ${P}.y * 0.7)))`)}
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(0.42, 0.44, 0.42), iCoule * 0.7);
  ${V('iBord', 'float', '0.3 + 0.08 * emBruit(vec2(iS * 1.5, 3.3))')}
  ${V('iPied', 'float', '1.0 - smoothstep(iBord - 0.08, iBord + 0.04, iDans)')}
  ${V('iAlgue', 'float', `smoothstep(0.45, 0.75, emBruit(vec2(iS * 1.3 + 11.0, ${P}.y * 2.2)) * 0.7 + emBruit(vec2(iS * 6.0, ${P}.y * 6.0)) * 0.3)`)}
  surfaceAlbedo *= mix(vec3(1.0), vec3(0.62, 0.62, 0.58), iPied);
  ${V('iNord', 'float', 'smoothstep(0.3, 0.8, -iN.z)')}
  ${V('iVerdit', 'float', 'iAlgue * (0.2 + 0.5 * iPied) + iNord * iAlgue * 0.45 * (1.0 - smoothstep(0.35, 0.75, iDans))')}
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(0.6, 0.78, 0.45), clamp(iVerdit, 0.0, 0.85));
#ifdef MAINUV1
  ${V('iM', 'vec2', fin('vMainUV1'))}
  // Hors du « if » : le WGSL ne dérive qu'en flot uniforme.
  ${V('iNet', 'float', '1.0 - smoothstep(0.04, 0.12, max(fwidth(iM.x), fwidth(iM.y)) * 2.0)')}
  if (abs(iN.y) < 0.5) {
    ${V('iRb', 'float', 'floor(iM.y / 0.075)')}
    ${V('iDec', 'float', 'emMod(11.0 - emMod(iRb, 12.0), 2.0) * 0.5')}
    ${V('iCell', 'vec2', 'vec2(floor(iM.x / 0.23 - iDec), iRb)')}
    ${V('iFy', 'float', 'fract(iM.y / 0.075) * 0.075')}
    ${V('iFx', 'float', 'fract(iM.x / 0.23 - iDec) * 0.23')}
    ${V('iBrique', 'float', 'step(0.01, iFy) * step(iFx, 0.22)')}
    ${V('iOrigine', 'vec2', `floor(vec2(emLe(iN, ${P}) - iM.x, ${P}.y - iM.y) * 10.0 + 0.5) / 10.0`)}
    ${V('iOu', 'vec2', 'iOrigine + (iCell + vec2(iDec + 0.5, 0.5)) * vec2(0.23, 0.075)')}
    ${V('iH', 'float', 'emHash(iOu * 7.13)')}
    surfaceAlbedo *= mix(1.0, mix(0.84, 1.12, iH), iBrique * iNet);
    ${V('iRep', 'float', 'step(0.74, emBruit(iOu * vec2(0.55, 0.9) + 31.0) * 0.8 + emBruit(iOu * 2.3) * 0.2)')}
    ${V('iNeuve', 'vec3', 'surfaceAlbedo * vec3(1.14, 0.98, 0.9) * (1.0 + 0.25 * iPan)')}
    ${V('iCiment', 'vec3', 'vec3(0.52, 0.52, 0.5) * (0.8 + 0.25 * iPan)')}
    surfaceAlbedo = mix(surfaceAlbedo, mix(iCiment, iNeuve, iBrique), iRep * mix(0.55, 0.9, iBrique));
    ${V('iSeule', 'float', 'step(0.985, emHash(iOu * 3.71 + 5.0)) * iBrique')}
    surfaceAlbedo = mix(surfaceAlbedo, mix(vec3(0.46, 0.2, 0.13), vec3(0.3, 0.17, 0.15), step(0.5, emHash(iOu))), iSeule * iNet);
    ${V('iSel', 'float', `smoothstep(0.58, 0.85, emBruit(vec2(iS * 1.9, ${P}.y * 3.0) + 17.0) * 0.6 + emBruit(vec2(iS * 8.0, ${P}.y * 11.0)) * 0.25 + emBruit(vec2(iS * 30.0, ${P}.y * 30.0)) * 0.15)`)}
    ${V('iZone', 'float', 'smoothstep(iBord - 0.02, iBord + 0.06, iDans) * (1.0 - smoothstep(iBord + 0.08, iBord + 0.3, iDans)) + smoothstep(0.88, 0.97, iDans) * 0.7')}
    surfaceAlbedo = mix(surfaceAlbedo, vec3(0.8, 0.78, 0.72), iSel * iZone * (0.12 + 0.4 * (1.0 - iBrique)) * (1.0 - iRep * 0.7));
  }
#endif
}`)
  // L'abscisse du mur, lue de gauche à droite face à lui (le `iLe` de three).
  const le = fn('emLe', [['n', 'vec3'], ['p', 'vec3']], 'float', `
  if (n.z > 0.5) { return p.x; }
  if (n.z < -0.5) { return -p.x; }
  if (n.x > 0.5) { return -p.z; }
  return p.z;`)
  return {
    vertex: sommets(wgsl),
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varying('vmBoite', 'vec3')}\n${varying('vmTaille', 'vec3')}\n${outils(wgsl)}\n${le}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: fragment,
    },
  }
}

/**
 * `mousserChaperon` puis `ECLATS(1)` de three (usure.ts) : mousse le long des
 * arêtes et des joints du dessus, coussinets, débord sur les faces, lichen,
 * pierre jamais lavée ; arêtes épaufrées, plus rugueuses.
 */
function chaperon(wgsl: boolean) {
  const { V, G, varying, fin, tr, rugosite } = dialecte(wgsl)
  const [P, B, T] = [fin('vPositionW'), fin('vmBoite'), fin('vmTaille')]
  const fragment = tr(`{
  ${V('uNw', 'vec3', `normalize(${fin('vNormalW')})`)}
  ${V('uSousDessus', 'float', `${T}.y * 0.5 - ${B}.y`)}
  ${V('uB', 'float', `emBruit(${P}.xz * 3.1 + ${P}.y) * 0.6 + emBruit(${P}.xz * 11.0 + ${P}.y * 3.0) * 0.4`)}
  ${V('uDessus', 'float', 'smoothstep(0.6, 0.9, uNw.y)')}
  ${V('uBord', 'vec2', `${T}.xz * 0.5 - abs(${B}.xz)`)}
  ${V('uLong', 'float', `mix(${B}.z, ${B}.x, 1.0 - step(${T}.x, ${T}.z))`)}
  ${V('uJoint', 'float', 'abs(fract(uLong / 0.6 + 0.5) - 0.5) * 0.6')}
  ${V('uNid', 'float', 'min(min(uBord.x, uBord.y), uJoint)')}
  ${V('uGrain', 'float', `emBruit(${P}.xz * 19.0 + ${P}.y * 5.0) * 0.6 + emBruit(${P}.xz * 47.0 - ${P}.y * 3.0) * 0.4`)}
  ${V('uFrange', 'float', '0.012 + 0.05 * uGrain * smoothstep(0.3, 0.7, uB)')}
  ${V('uSurLeDessus', 'float', '(1.0 - smoothstep(uFrange * 0.5, uFrange, uNid)) * smoothstep(0.35, 0.55, uGrain)')}
  ${V('uCoussin', 'float', `smoothstep(0.78, 0.86, emBruit(${P}.xz * 41.0 + 7.0)) * smoothstep(0.45, 0.7, uB)`)}
  ${V('uDeborde', 'float', '(1.0 - smoothstep(0.0, 0.01 + 0.025 * uGrain, uSousDessus)) * (1.0 - uDessus) * smoothstep(0.4, 0.6, uGrain)')}
  ${V('uMousse', 'float', 'max(uDessus * max(uSurLeDessus, uCoussin * 0.8), uDeborde * 0.8)')}
  ${V('uL', 'float', 'dot(surfaceAlbedo, vec3(0.3, 0.59, 0.11))')}
  ${V('uVert', 'vec3', 'mix(vec3(0.06, 0.075, 0.03), vec3(0.14, 0.17, 0.06), uGrain)')}
  surfaceAlbedo = mix(surfaceAlbedo, uVert * (0.7 + 0.6 * uL), uMousse * 0.9);
  ${V('uLichen', 'float', `smoothstep(0.78, 0.84, emBruit(vec2(dot(${P}.xz, vec2(1.0)) * 9.0, ${P}.y * 9.0)))`)}
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.62, 0.64, 0.5), uLichen * 0.4 * (1.0 - uDessus));
  surfaceAlbedo *= 0.86 + 0.14 * uB;
  ${V('uE', 'vec3', `${T} * 0.5 - abs(${B})`)}
  ${V('uLo', 'float', 'min(uE.x, min(uE.y, uE.z))')}
  ${V('uHi', 'float', 'max(uE.x, max(uE.y, uE.z))')}
  ${V('uArete', 'float', 'uE.x + uE.y + uE.z - uLo - uHi')}
  ${V('uT', 'float', `dot(${P}, vec3(1.0, 0.83, 1.17))`)}
  ${V('uN', 'float', 'emBruit(vec2(uT * 9.0, 1.3)) * 0.5 + emBruit(vec2(uT * 27.0, 7.7)) * 0.3 + emBruit(vec2(uT * 71.0, 2.9)) * 0.2')}
  ${V('uLarge', 'float', '0.004 + 0.07 * pow(uN, 1.8)')}
  ${V('uEclat', 'float', '1.0 - smoothstep(uLarge * 0.75, uLarge, uArete)')}
  ${V('uLisere', 'float', '(1.0 - uEclat) * (1.0 - smoothstep(uLarge, uLarge + 0.004, uArete)) * step(0.006, uLarge)')}
  surfaceAlbedo *= mix(1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.008, uArete)) + 0.12 * uLisere, 0.68, uEclat);
  emRugo = 0.1 * uEclat;
}`)
  return {
    vertex: sommets(wgsl),
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varying('vmBoite', 'vec3')}\n${varying('vmTaille', 'vec3')}\n${G('emRugo', 'float')}\n${outils(wgsl)}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: fragment,
      [rugosite]: '$0\nroughness = min(1.0, roughness + emRugo);\nmicroSurface = 1.0 - roughness;',
    },
  }
}

export function monterEnceinte(scene: Scene): Mesh[] {
  const lots = lotsDeLEnceinte()
  const brique = creerBrique(scene, 'enceinte:brique')
  const pierre = creerPierre(scene, 'enceinte:pierre')
  const fer = matiere('enceinte:fer', scene, '#1c1e1d', 0.45)
  fer.metallic = 0.7
  brancherLueurs([brique, pierre, fer])
  greffer(brique, { nom: 'VieuxMur', attributs: ['boite', 'taille'], code: vieuxMur })
  greffer(pierre, { nom: 'Chaperon', attributs: ['boite', 'taille'], code: chaperon })
  // La neige tient par-dessus la mousse et la patine (priorité 300 > 200).
  intemperer(brique)
  intemperer(pierre)
  const gabarit = gabaritCube(scene)
  const poser = (nom: string, boites: Box[], mat: Material, usure: boolean): Mesh => {
    const m = boitesFusionnees(nom, boites, scene, mat)
    if (usure) {
      const u = attributsDUsure(gabarit, boites)
      m.setVerticesData('boite', u.boite, false, 3)
      m.setVerticesData('taille', u.taille, false, 3)
    }
    m.receiveShadows = true
    return m
  }
  return [
    poser('enceinte:brique', lots.brique, brique, true),
    poser('enceinte:pierre', lots.pierre, pierre, true),
    poser('enceinte:foulees', lots.foulees, dallage(scene), false),
    poser('enceinte:fer', lots.fer, fer, false),
  ]
}
