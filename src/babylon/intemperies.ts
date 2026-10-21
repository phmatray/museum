/**
 * Le temps et la saison portés par les matières (scene/intemperies.ts et la
 * boucle de MeteoLayer) :
 *
 * - `METEO` : les valeurs LISSÉES (l'INTEMPERIES de three), réglées à chaque
 *   image par `animerIntemperies(scene)` (main.ts) depuis la météo cible de
 *   l'état vivant : le sol se mouille vite et sèche lentement, la neige tient,
 *   la brume prend la couleur de l'heure, l'éclair d'orage. Lues par le ciel,
 *   l'air, les rayons, la pluie et toutes les greffes ci-dessous. La saison,
 *   elle, n'est pas lissée : `vivant.getState().saison`.
 * - Les greffes, qui CHAÎNENT (plugins nommés, priorité 300 : après les
 *   Lueurs, la végétation et le lierre ; leur rugosité après celle des autres) :
 *   `intemperer(m, { pelouse?, flaques? })` (mouillé, neige, flaques, saison
 *   de la pelouse), `rider(m)` (ronds de pluie sur l'eau), `ruisseler(m)`
 *   (filets sur le verre). Les valeurs passent par `lier` : ni recompilation
 *   ni dégel quand le temps change. Une seule de ces trois greffes par matière.
 * - `AIR` : l'air de l'heure (AtmosphereLayer : `airDuCiel` sous la météo lissée),
 *   la direction du soleil et la force des rayons du dehors, recalculés à chaque
 *   image avec METEO ; lus par le ciel, la greffe d'air et le post-traitement.
 * - `toits(wgsl, nom)` : `toitsGlsl` de plan/toits.ts, aussi en WGSL (brume,
 *   air, pluie : « sous un toit »).
 *
 * Écarts : Babylon calcule en espace monde (la normale des flaques se
 * redresse vers +y monde, pas de viewMatrix) ; les matières sans
 * METALLICWORKFLOW ne prennent pas la rugosité.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

import { airDuCiel, forceDesRayonsDehors, type Air } from '../domain/atmosphere.ts'
import type { Meteo } from '../domain/meteo.ts'
import { directionDuSoleil, type Ciel } from '../domain/soleil.ts'
import { abrisGlsl, toitsGlsl } from '../plan/toits.ts'
import { mouvementReduit, vivant } from './etat.ts'
import { dialecte, greffer } from './greffe.ts'
import { lin } from './lueurs.ts'

const BRUME = { jour: lin('#b4bcc2'), nuit: lin('#161c28'), soir: lin('#c9a78e') }

export const METEO = {
  temps: 0,
  /** La pluie qui tombe (0..1), lissée. */
  pluie: 0,
  /** Le sol mouillé : monte avec la pluie, sèche lentement. */
  mouille: 0,
  /** La neige tenue au sol, sur les toits et les houppiers. */
  enneige: 0,
  /** m/s. */
  vent: 2,
  nuages: 0,
  brume: 0,
  /** La couleur de la brume et du ciel couvert, linéaire. */
  brumeCouleur: lin('#aab2b8'),
  /** Le flash d'orage, 0 le reste du temps. */
  eclair: 0,
  /** La densité exp2 de la brume de scène (0 par beau temps). */
  densite: 0,
}
export type EtatMeteo = typeof METEO

const airDe = (ciel: Ciel) => {
  const temps = { nuages: METEO.nuages, brouillard: METEO.brume }
  const b = METEO.brumeCouleur
  return { air: airDuCiel(ciel, temps, [b.r, b.g, b.b]), soleil: directionDuSoleil(ciel), rayons: forceDesRayonsDehors(ciel, temps) }
}
/** L'air de l'heure (couleurs linéaires), le sens VERS le soleil, la force des rayons du dehors (0..1). */
export const AIR: { air: Air; soleil: [number, number, number]; rayons: number } = airDe(vivant.getState().ciel)

/** Un pas de lissage (MeteoLayer.tsx) : `e` va vers la météo cible `m`. */
export function lisserMeteo(e: EtatMeteo, m: Meteo, ciel: Pick<Ciel, 'jour' | 'crepuscule'>, dt: number): void {
  const pas = Math.min(dt, 0.1)
  const vers = (k: 'pluie' | 'mouille' | 'enneige' | 'vent' | 'nuages' | 'brume', cible: number, vitesse: number) => {
    e[k] += (cible - e[k]) * Math.min(1, pas * vitesse)
  }
  vers('pluie', m.pluie, 0.5)
  vers('mouille', Math.max(m.pluie, m.neige * 0.3), m.pluie > e.mouille ? 0.2 : 0.01)
  vers('enneige', m.neige > 0 ? Math.min(1, 0.4 + m.neige) : 0, m.neige > 0 ? 0.02 : 0.005 + m.pluie * 0.03)
  vers('vent', m.vent, 0.3)
  vers('nuages', m.nuages, 0.3)
  vers('brume', m.brouillard, 0.3)
  Color3.LerpToRef(BRUME.nuit, BRUME.jour, ciel.jour, e.brumeCouleur)
  Color3.LerpToRef(e.brumeCouleur, BRUME.soir, ciel.crepuscule * ciel.jour * 0.4, e.brumeCouleur)
  const d = e.brume * 0.055 + e.pluie * 0.012 + m.neige * 0.02
  e.densite = d > 0.002 ? d : 0
}

/** Le double éclair, `t` s après son début. */
export const lueurEclair = (t: number): number => (t < 0.6 ? Math.max(0, 1 - t / 0.12) + (t > 0.2 ? Math.max(0, 0.7 - (t - 0.2) / 0.3) : 0) : 0)

/** Lisse METEO et recalcule AIR à chaque image ; la météo du chargement tient d'emblée (`?meteo=neige` arrive enneigé). */
export function animerIntemperies(scene: Scene): void {
  const { meteo } = vivant.getState()
  METEO.pluie = METEO.mouille = meteo.pluie
  METEO.enneige = meteo.neige
  const calme = mouvementReduit()
  const e = { prochain: 3, debut: -10 }
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000
    const { meteo, ciel } = vivant.getState()
    lisserMeteo(METEO, meteo, ciel, dt)
    const t = (METEO.temps += dt)
    // L'orage : un double éclair toutes les 4 à 14 s, jamais en mouvement réduit.
    if (meteo.orage && !calme && t > e.prochain) {
      e.debut = t
      e.prochain = t + 4 + Math.random() * 10
    }
    METEO.eclair = lueurEclair(t - e.debut)
    Object.assign(AIR, airDe(ciel))
  })
}

/** Une fonction `float nom(vec2 xz)` des toits (plan/toits.ts) en WGSL. */
export function enWgsl(glsl: string): string {
  return glsl
    .replace(/float (\w+)\(vec2 (\w+)\) \{/g, 'fn $1($2: vec2f) -> f32 {')
    .replace(/\bfloat (\w+) = /g, 'var $1: f32 = ')
    .replace(/if \((.*)\)\s*return ([^;]+);/g, 'if ($1) { return $2; }')
}
/** `toitsGlsl(nom)` dans la langue du moteur. */
export const toits = (wgsl: boolean, nom: string): string => (wgsl ? enWgsl(toitsGlsl(nom)) : toitsGlsl(nom))

/** `${p}Hash` et `${p}Bruit` (bruit de valeur 2D, lissé) dans la langue du moteur : intempéries et brume de l'étang (meteo.ts). */
export function bruit(wgsl: boolean, p: string): string {
  const { fn, V, tr } = dialecte(wgsl)
  const H = `${p}Hash`
  return tr(`${fn(H, [['q', 'vec2']], 'float', 'return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);')}
${fn(`${p}Bruit`, [['q', 'vec2']], 'float', `
  ${V('i', 'vec2', 'floor(q)')}
  ${V('fr', 'vec2', 'fract(q)')}
  ${V('s', 'vec2', 'fr * fr * (3.0 - 2.0 * fr)')}
  return mix(mix(${H}(i), ${H}(i + vec2(1.0, 0.0)), s.x), mix(${H}(i + vec2(0.0, 1.0)), ${H}(i + vec2(1.0, 1.0)), s.x), s.y);`)}`)
}

/** Hachage, bruit de valeur, « dans le musée », ronds de pluie ; préfixés `p` (une greffe, un jeu de noms). */
function commun(wgsl: boolean, p: string): string {
  const { fn, V, tr } = dialecte(wgsl)
  const pour = (v: string, de: number, a: number, corps: string) =>
    wgsl ? `for (var ${v}: i32 = ${de}; ${v} <= ${a}; ${v}++) {${corps}}` : `for (int ${v} = ${de}; ${v} <= ${a}; ${v}++) {${corps}}`
  const fl = (v: string) => (wgsl ? `f32(${v})` : `float(${v})`)
  const H = `${p}Hash`
  const abris = abrisGlsl(`${p}Abri`)
  return `
${wgsl ? enWgsl(abris) : abris}
${bruit(wgsl, p)}
${tr(`${fn(`${p}Interieur`, [['q', 'vec3']], 'float', `return max(step(-0.2, q.x) * step(q.x, 48.2) * step(-0.2, q.z) * step(q.z, 40.2) * step(q.y, 9.3), step(q.y, ${p}Abri(q.xz) - 0.2));`)}
${fn(`${p}Ronds`, [['xz', 'vec2'], ['temps', 'float'], ['pluie', 'float']], 'vec2', `
  ${V('g', 'vec2', 'vec2(0.0)')}
  ${pour('k', 0, 1, `
    ${V('q', 'vec2', `xz * 2.4 + ${fl('k')} * vec2(0.37, 0.71)`)}
    ${V('c', 'vec2', 'floor(q)')}
    ${pour('i', -1, 1, pour('j', -1, 1, `
      ${V('o', 'vec2', `c + vec2(${fl('i')}, ${fl('j')})`)}
      ${V('h', 'float', `${H}(o + ${fl('k')} * 17.0)`)}
      if (h > pluie * 1.3) { continue; }
      ${V('t', 'float', 'fract(temps * (0.55 + 0.4 * h) + h * 9.1)')}
      ${V('v', 'vec2', `q - (o + 0.2 + 0.6 * vec2(h, ${H}(o * 1.7 + 3.1)))`)}
      ${V('d', 'float', 'length(v)')}
      ${V('e', 'float', '(d - t * 0.75) / 0.05')}
      g += v / max(d, 1e-3) * exp(-e * e) * (1.0 - t) * (1.0 - t) * cos((d - t * 0.75) * 60.0);`))}`)}
  return g;`)}`)}`
}

/** Le code d'`intemperer` (exporté pour les tests). */
export function codeIntemperies(wgsl: boolean, { pelouse = false, flaques = false } = {}): { fragment: Record<string, string> } {
  const { V, u, fin, tr } = dialecte(wgsl)
  const [A, B, C] = [u('intA'), u('intB'), u('intC')]
  const P = fin('vPositionW')
  const refl = wgsl ? 'uniforms.vReflectivityColor' : 'vReflectivityColor'
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: commun(wgsl, 'int'),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
${V('iDehors', 'float', `1.0 - intInterieur(${P})`)}
${pelouse ? `{
  ${V('iL', 'float', 'dot(surfaceAlbedo, vec3(0.3, 0.59, 0.11))')}
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(1.3, 1.12, 0.5), ${B}.x * 0.55);
  surfaceAlbedo = mix(surfaceAlbedo, vec3(iL) * vec3(1.1, 1.0, 0.72), ${B}.y * 0.5) * (1.0 - 0.1 * ${B}.y);
}` : ''}
${V('iM', 'float', `${A}.z * iDehors`)}
surfaceAlbedo *= 1.0 - 0.38 * iM;
${V('iSol', 'float', `smoothstep(0.2, 0.75, normalize(${fin('vNormalW')}).y)`)}
${V('iB', 'float', `intBruit(${P}.xz * 1.1) * 0.65 + intBruit(${P}.xz * 4.7) * 0.35`)}
${V('iNeige', 'float', `smoothstep(0.38, 0.62, ${A}.w * iDehors * iSol + (iB - 0.5) * 0.55)`)}
surfaceAlbedo = mix(surfaceAlbedo, vec3(0.88, 0.9, 0.95), iNeige);
${flaques ? `
${V('iEau', 'float', 'smoothstep(0.35, 0.85, iM) * iSol * (1.0 - iNeige)')}
${V('iF', 'float', `intBruit(${P}.xz * 0.9 + 7.3) * 0.6 + intBruit(${P}.xz * 2.6) * 0.28 + intBruit(${P}.xz * 9.0) * 0.12`)}
${V('iSeuil', 'float', '0.74 - 0.05 * iEau')}
${V('iFlaque', 'float', 'smoothstep(iSeuil, iSeuil + 0.015, iF) * iEau')}
${V('iFilm', 'float', 'iEau * (1.0 - iFlaque)')}
${V('iBord', 'float', 'smoothstep(iSeuil - 0.06, iSeuil, iF) * iEau')}
surfaceAlbedo *= (1.0 - 0.2 * iM * iSol) * (1.0 - 0.25 * iBord) * (1.0 - 0.7 * iFlaque);
normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), iFlaque));
if (iFlaque > 0.01 && ${A}.y > 0.01) {
  ${V('iG', 'vec2', `intRonds(${P}.xz, ${A}.x, ${A}.y) * iFlaque * min(1.0, ${A}.y * 2.0)`)}
  normalW = normalize(normalW + vec3(iG.x, 0.0, iG.y) * 0.9);
}` : ''}`),
      // Le métal s'efface sous la neige ; la rugosité après celle des autres greffes (ancrée plus bas que `rugosite`).
      [`!reflectivityBlock\\(\\s*${refl.replace('.', '\\.')}`]: tr(`reflectivityBlock(vec4(${refl}.x * (1.0 - iNeige), ${refl}.yzw)`),
      '!surfaceAlbedo=reflectivityOut\\.surfaceAlbedo;': `$0
roughness = mix(roughness, 0.1 + 0.25 * roughness, iM * iSol);${flaques ? '\nroughness = mix(roughness, 0.02, iFlaque);' : ''}
roughness = mix(roughness, 0.8, iNeige);
microSurface = 1.0 - roughness;`,
      ...(flaques && {
        // Le reflet du ciel couvert : un miroir dans les flaques, un lustre sur le film d'eau, selon Fresnel.
        CUSTOM_FRAGMENT_BEFORE_FOG: tr(`
${V('iFr', 'float', '0.02 + 0.98 * pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), 5.0)')}
finalColor = vec4(mix(finalColor.rgb, ${C} * 3.0, iFr * (0.9 * iFlaque + 0.06 * iFilm)), finalColor.a);`),
      }),
    },
  }
}

/**
 * Le dehors sous le temps qu'il fait : mouillé (plus sombre, plus lisse), puis
 * couvert de neige par plaques sur les faces tournées vers le ciel.
 * `pelouse` : la saison de l'herbe (jaunie fin d'été, terne l'hiver).
 * `flaques` (allées, parvis) : sous l'averse, des flaques éparses, miroir du ciel.
 */
export function intemperer(m: Material, o: { pelouse?: boolean; flaques?: boolean } = {}): void {
  greffer(m, {
    nom: o.pelouse ? 'IntemperiesPelouse' : o.flaques ? 'IntemperiesFlaques' : 'Intemperies',
    priorite: 300,
    uniforms: [
      { name: 'intA', size: 4, type: 'vec4' },
      { name: 'intB', size: 4, type: 'vec4' },
      { name: 'intC', size: 3, type: 'vec3' },
    ],
    lier: (ubo) => {
      const p = vivant.getState().saison.pelouse
      ubo.updateFloat4('intA', METEO.temps, METEO.pluie, METEO.mouille, METEO.enneige)
      ubo.updateFloat4('intB', p.jaune, p.terne, 0, 0)
      ubo.updateFloat3('intC', METEO.brumeCouleur.r, METEO.brumeCouleur.g, METEO.brumeCouleur.b)
    },
    code: (wgsl) => codeIntemperies(wgsl, o),
  })
}

/** Le code de `rider` (exporté pour les tests). */
export function codeRonds(wgsl: boolean): { fragment: Record<string, string> } {
  const { V, u, fin, tr } = dialecte(wgsl)
  const R = u('rideA')
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: commun(wgsl, 'ride'),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
if (${R}.y > 0.01) {
  ${V('rG', 'vec2', `rideRonds(${fin('vPositionW')}.xz, ${R}.x, ${R}.y)`)}
  normalW = normalize(normalW + vec3(rG.x, 0.0, rG.y) * 0.9 * min(1.0, ${R}.y * 2.0));
}`),
    },
  }
}

/** Les ronds de pluie sur l'eau (étang, ruisseau) : rien par temps sec. */
export function rider(m: Material): void {
  greffer(m, {
    nom: 'IntemperiesRonds',
    priorite: 300,
    uniforms: [{ name: 'rideA', size: 2, type: 'vec2' }],
    lier: (ubo) => ubo.updateFloat2('rideA', METEO.temps, METEO.pluie),
    code: codeRonds,
  })
}

/** Le code de `ruisseler` (exporté pour les tests). */
export function codeFilets(wgsl: boolean): { fragment: Record<string, string> } {
  const { V, u, fin, tr } = dialecte(wgsl)
  const [T, Pl] = [`${u('filA')}.x`, `${u('filA')}.y`]
  const P = fin('vPositionW')
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: commun(wgsl, 'fil'),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
${V('iFilet', 'float', '0.0')}
if (${Pl} > 0.01) {
  ${V('nW', 'vec3', 'normalW')}
  ${V('amont', 'vec3', 'vec3(0.0, 1.0, 0.0) - nW * nW.y')}
  ${V('lg', 'float', 'length(amont)')}
  if (lg > 0.05) {
    amont = amont / lg;
    ${V('cote', 'vec3', 'normalize(cross(nW, amont))')}
    ${V('fU', 'float', `dot(${P}, cote) * 4.0`)}
    ${V('fV', 'float', `dot(${P}, amont)`)}
    ${V('h', 'float', 'filHash(vec2(floor(fU), 3.7))')}
    ${V('fu', 'float', 'fract(fU) - 0.5 + 0.18 * sin(fV * 4.0 + h * 30.0)')}
    ${V('ligne', 'float', `smoothstep(0.14, 0.04, abs(fu)) * step(0.45 - 0.4 * ${Pl}, h)`)}
    ${V('coule', 'float', `pow(fract(fV * (0.5 + h) + ${T} * (0.5 + 0.7 * h) + h * 13.0), 6.0)`)}
    ${V('g', 'vec2', 'vec2(fU * 1.3, fV * 9.0)')}
    ${V('goutte', 'float', `smoothstep(0.35, 0.15, length(fract(g) - 0.5)) * step(0.82 - 0.2 * ${Pl}, filHash(floor(g)))`)}
    iFilet = clamp(ligne * (0.35 + 0.65 * coule) + goutte * 0.7, 0.0, 1.0) * min(1.0, ${Pl} * 1.8);
    normalW = normalize(normalW + cote * fu * 0.6 * ligne);
  } else {
    ${V('g', 'vec2', `${P}.xz * 4.0`)}
    ${V('c', 'vec2', 'floor(g)')}
    ${V('h', 'float', 'filHash(c + 5.3)')}
    ${V('t', 'float', `fract(${T} * (0.3 + 0.4 * h) + h * 17.0)`)}
    ${V('o', 'vec2', '0.25 + 0.5 * vec2(h, filHash(c + 7.1))')}
    ${V('r', 'float', '(0.06 + 0.09 * h * h) * (0.8 + 0.4 * t)')}
    iFilet = smoothstep(r, r * 0.4, length(fract(g) - o)) * (1.0 - t * t) * step(0.9 - 0.6 * ${Pl}, filHash(c + 3.3)) * 0.6 * min(1.0, ${Pl} * 1.8);
  }
  // Vue du dessous, contre le ciel clair, l'eau se lit plus sombre que le verre.
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.16, 0.19, 0.22), iFilet * 0.8);
  alpha = min(1.0, alpha + iFilet * 0.45);
}`),
      // L'accolade fermante seule : voir greffe.ts.
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `finalEmissive *= (1.0 - 0.8 * iFilet) * (1.0 - 0.3 * ${Pl});\n`,
    },
  }
}

/** Les filets de pluie sur un verre (verrière, lanterneau) : rigoles sur la pente, gouttes à plat. */
export function ruisseler(m: Material): void {
  greffer(m, {
    nom: 'IntemperiesFilets',
    priorite: 300,
    uniforms: [{ name: 'filA', size: 2, type: 'vec2' }],
    lier: (ubo) => ubo.updateFloat2('filA', METEO.temps, METEO.pluie),
    code: codeFilets,
  })
}
