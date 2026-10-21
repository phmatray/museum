/**
 * Le LIERRE du mur d'enceinte (`plan/lierre.ts` l'a fait pousser, `scene/lierre.tsx`
 * de three) : une carte par feuille, par rameau ou par bout de tige, fusionnées
 * en un maillage par tronçon de 32 m de chaque côté du parc (le frustum et le
 * cône de vue en écartent la plupart). Les cartes peintes sur un canevas 2 × 2 (feuille adulte,
 * jeune feuille, rameau, tige), le quart de chaque carte cuit dans ses UV : le
 * test d'alpha de la carte d'ombre découpe donc la vraie silhouette sans rien greffer.
 *
 * La greffe `Lierre` reprend celles de three : la pointe qui tremble au vent,
 * le test d'alpha tenu au loin (les mips moyennent l'alpha), la nuance de
 * chaque feuille, le bronze d'automne d'une sur cinq, l'hiver pourpré, la neige
 * sur les feuilles tournées vers le ciel, la pluie qui fonce et fait luire.
 * Saison (`lierreSaison`, état vivant) et météo lissée (`lierreMeteo`, METEO :
 * vent, mouillé, neige) passent par l'UBO (`lier`) : rien ne recompile.
 * ponytail : la carte d'ombre ne tient ni le vent ni l'alpha au loin (three, si) ; à greffer
 * dans un ShadowDepthWrapper si les ombres du lierre fondent au loin.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { lierreDuMur, type Feuille } from '../plan/lierre.ts'
import { matiere } from './boites.ts'
import { MUR } from './enceinte.ts'
import { vivant } from './etat.ts'
import { dialecte, greffer } from './greffe.ts'
import { METEO } from './intemperies.ts'
import { brancherLueurs, lin } from './lueurs.ts'

const CELLULE = 256

/** Une feuille de lierre, pétiole en (0, 0), pointe vers +y ; `lobes` 5 ou 3, `r` sa longueur. */
function contourDeFeuille(ctx: CanvasRenderingContext2D, lobes: 3 | 5, r: number, alea: () => number) {
  const pointes: [number, number][] = lobes === 5
    ? [[-2.05, 0.46], [-1.15, 0.72], [0, 1], [1.15, 0.72], [2.05, 0.46]]
    : [[-1.25, 0.66], [0, 1], [1.25, 0.66]]
  const centre = { x: 0, y: r * 0.36 }
  const point = (a: number, l: number) => ({ x: centre.x + Math.sin(a) * l * r * 0.64, y: centre.y + Math.cos(a) * l * r * 0.64 })
  const j = () => 1 + (alea() - 0.5) * 0.12
  ctx.beginPath()
  ctx.moveTo(0, r * 0.06)
  const debut = point(-2.75, 0.3)
  ctx.quadraticCurveTo(-r * 0.12, r * 0.02, debut.x, debut.y)
  pointes.forEach(([a, l], k) => {
    const p = point(a * j(), l * j())
    const avant = k === 0 ? -2.75 : (pointes[k - 1][0] + a) / 2
    const s = point(avant, (lobes === 5 ? 0.42 : 0.5) * j())
    const c1 = point((avant + a) / 2 - 0.12, (s.y + p.y) / (2 * r * 0.64) + 0.25)
    ctx.quadraticCurveTo(s.x, s.y, (s.x + p.x) / 2 + (c1.x - (s.x + p.x) / 2) * 0.2, (s.y + p.y) / 2)
    ctx.quadraticCurveTo(p.x * 0.97, p.y * 0.97, p.x, p.y)
  })
  const fin = point(2.75, 0.3)
  const s = point((pointes[pointes.length - 1][0] + 2.75) / 2, 0.42)
  ctx.quadraticCurveTo(s.x, s.y, fin.x, fin.y)
  ctx.quadraticCurveTo(r * 0.12, r * 0.02, 0, r * 0.06)
  ctx.closePath()
  return { pointes: pointes.map(([a, l]) => point(a, l * 0.92)), centre }
}

/** Une feuille peinte : le limbe sombre et luisant, ses nervures pâles, son pétiole. */
function peindreFeuille(ctx: CanvasRenderingContext2D, lobes: 3 | 5, r: number, teinte: [string, string], alea: () => number) {
  ctx.save()
  const { pointes, centre } = contourDeFeuille(ctx, lobes, r, alea)
  const g = ctx.createRadialGradient(centre.x, centre.y * 0.8, r * 0.05, centre.x, centre.y, r * 0.75)
  g.addColorStop(0, teinte[1])
  g.addColorStop(1, teinte[0])
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = alea() < 0.5 ? 'rgba(10, 25, 5, 0.16)' : 'rgba(170, 200, 120, 0.1)'
    ctx.fillRect((alea() - 0.5) * r * 1.4, alea() * r * 1.1, 2, 2)
  }
  const reflet = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, r)
  reflet.addColorStop(0, 'rgba(255,255,240,0)')
  reflet.addColorStop(0.45, 'rgba(255,255,240,0.1)')
  reflet.addColorStop(0.7, 'rgba(255,255,240,0)')
  ctx.fillStyle = reflet
  ctx.fillRect(-r, 0, 2 * r, 1.2 * r)
  ctx.strokeStyle = 'rgba(190, 210, 160, 0.55)'
  ctx.lineCap = 'round'
  for (const p of pointes) {
    ctx.lineWidth = Math.max(1, r * 0.022)
    ctx.beginPath()
    ctx.moveTo(0, r * 0.08)
    ctx.quadraticCurveTo(p.x * 0.4, p.y * 0.55, p.x, p.y)
    ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = '#4d3f28'
  ctx.lineWidth = Math.max(1.5, r * 0.035)
  ctx.beginPath()
  ctx.moveTo(0, r * 0.08)
  ctx.lineTo(0, -r * 0.25)
  ctx.stroke()
}

/** Les quatre cartes, 2 × 2, peintes comme dans three (même graine). Faux sans canevas 2D (jsdom). */
function peindreAtlas(ctx: CanvasRenderingContext2D): void {
  let s = 97
  const alea = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const cellule = (k: number, dessin: () => void) => {
    ctx.save()
    ctx.translate((k % 2) * CELLULE, Math.floor(k / 2) * CELLULE)
    ctx.beginPath()
    ctx.rect(4, 4, CELLULE - 8, CELLULE - 8)
    ctx.clip()
    dessin()
    ctx.restore()
  }
  ctx.clearRect(0, 0, 2 * CELLULE, 2 * CELLULE)
  // La carte pend de son pétiole : le haut du canevas est le haut de la carte.
  cellule(0, () => {
    ctx.translate(CELLULE / 2, 30)
    peindreFeuille(ctx, 5, 205, ['#1b3314', '#2f5222'], alea)
  })
  cellule(1, () => {
    ctx.translate(CELLULE / 2, 30)
    peindreFeuille(ctx, 3, 200, ['#2d5219', '#4f7d2c'], alea)
  })
  cellule(2, () => {
    ctx.strokeStyle = '#4a3b27'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(CELLULE / 2, 6)
    ctx.bezierCurveTo(CELLULE * 0.45, 80, CELLULE * 0.58, 160, CELLULE * 0.5, 240)
    ctx.stroke()
    const feuilles: [number, number, number, number, 3 | 5][] = [
      [0.5, 0.1, 0.25, 95, 5], [0.42, 0.3, -0.9, 80, 5], [0.58, 0.42, 0.95, 85, 5], [0.45, 0.62, -0.7, 68, 3], [0.56, 0.75, 0.6, 60, 3], [0.5, 0.86, 0.1, 50, 3],
    ]
    for (const [x, y, a, r, l] of feuilles) {
      ctx.save()
      ctx.translate(x * CELLULE, y * CELLULE)
      ctx.rotate(a)
      peindreFeuille(ctx, l, r, l === 5 ? ['#1d3615', '#335a25'] : ['#28491a', '#44702a'], alea)
      ctx.restore()
    }
  })
  cellule(3, () => {
    const g = ctx.createLinearGradient(CELLULE * 0.25, 0, CELLULE * 0.75, 0)
    g.addColorStop(0, '#554a3e')
    g.addColorStop(0.5, '#8c7c68')
    g.addColorStop(1, '#554a3e')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(CELLULE * 0.3, 0)
    for (let y = 0; y <= CELLULE; y += 16) ctx.lineTo(CELLULE * (0.28 + 0.04 * alea()), y)
    for (let y = CELLULE; y >= 0; y -= 16) ctx.lineTo(CELLULE * (0.68 + 0.04 * alea()), y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(120, 100, 75, 0.9)'
    ctx.lineWidth = 3
    for (let i = 0; i < 40; i++) {
      const y = alea() * CELLULE
      const cote = alea() < 0.5 ? -1 : 1
      const x = CELLULE * (0.5 + cote * 0.2)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + cote * (8 + alea() * 16), y + (alea() - 0.3) * 14)
      ctx.stroke()
    }
  })
}

/** Les sommets de la carte pendue (x, y locaux) et ses UV dans la cellule (v = 1 au pétiole). */
const COINS = [[-0.5, 0], [0.5, 0], [-0.5, -1], [0.5, -1]] as const

/**
 * Les cartes fusionnées : un sommet vaut `position + X·lx + Y·ly` (Y = haut × longueur,
 * X = haut ∧ normale normé × largeur, la matrice de three), normale `normale`.
 * `feuille` = (sorte, jour, aléa) par sommet ; `vent` = X × 0,5 × (−ly) : l'écart de la
 * pointe en travers de la carte, nul au pétiole (et signe qu'on est à la pointe).
 */
export function geometrieDuLierre(feuilles: readonly Feuille[]) {
  const n = feuilles.length
  const positions = new Float32Array(n * 12)
  const normals = new Float32Array(n * 12)
  const uvs = new Float32Array(n * 8)
  const feuille = new Float32Array(n * 12)
  const vent = new Float32Array(n * 12)
  const indices = new Uint32Array(n * 6)
  feuilles.forEach((f, i) => {
    const [h, z, p] = [f.haut, f.normale, f.position]
    const x = [h[1] * z[2] - h[2] * z[1], h[2] * z[0] - h[0] * z[2], h[0] * z[1] - h[1] * z[0]]
    const lx = f.largeur / (Math.hypot(x[0], x[1], x[2]) || 1)
    const alea = Math.abs(Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453) % 1
    const [cu, cv] = [f.sorte % 2, 1 - Math.floor(f.sorte / 2)]
    COINS.forEach(([u, v], k) => {
      const j = 4 * i + k
      for (let c = 0; c < 3; c++) {
        positions[3 * j + c] = p[c] + x[c] * lx * u + h[c] * f.longueur * v
        normals[3 * j + c] = z[c]
        vent[3 * j + c] = x[c] * lx * 0.5 * -v
      }
      uvs.set([(cu + u + 0.5) * 0.5, (cv + v + 1) * 0.5], 2 * j)
      feuille.set([f.sorte, f.jour, alea], 3 * j)
    })
    // Les faces de PlaneGeometry (0, 2, 1), (2, 3, 1), retournées pour la main droite.
    indices.set([0, 1, 2, 2, 1, 3].map((k) => 4 * i + k), 6 * i)
  })
  return { positions, normals, uvs, indices, feuille, vent }
}

const f4 = (x: number) => x.toFixed(4)

/**
 * Les greffes de three (lierre.tsx). `lierreSaison` = (feuillage, chute),
 * `lierreMeteo` = (vent, mouillé, neige au sol, temps).
 */
export function codeDuLierre(wgsl: boolean) {
  const { V, G, fn, tr, attribut, varying, vin, vout, fin, u, rugosite } = dialecte(wgsl)
  const [S, M] = [u('lierreSaison'), u('lierreMeteo')]
  const [F, P, c] = [fin('vFeuille'), fin('vPositionW'), 'surfaceAlbedo']
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: [attribut('aFeuille', 'vec3'), attribut('aVent', 'vec3'), varying('vFeuille', 'vec3')].join('\n'),
      // La pointe tremble au vent ; le pétiole reste accroché, les tiges ne bougent pas.
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('lA', 'float', `${vin('aFeuille')}.z`)}
${V('lPhase', 'float', `${M}.w * (2.1 + lA) + lA * 40.0`)}
${V('lAmp', 'float', `(0.012 + 0.018 * ${M}.x) * step(${vin('aFeuille')}.x, 2.5)`)}
${V('lV', 'vec3', vin('aVent'))}
positionUpdated += (normalUpdated * sin(lPhase) * step(1e-10, dot(lV, lV)) + lV * cos(lPhase * 1.3)) * lAmp;
}`),
      CUSTOM_VERTEX_MAIN_END: `${vout('vFeuille')} = ${vin('aFeuille')};`,
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: tr(`${varying('vFeuille', 'vec3')}
${G('lLoin', 'float')}
${fn('lHash', [['p', 'vec2']], 'float', 'return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);')}
${fn('lBruit', [['p', 'vec2']], 'float', `
  ${V('i', 'vec2', 'floor(p)')}
  ${V('fr', 'vec2', 'fract(p)')}
  ${V('w', 'vec2', 'fr * fr * (3.0 - 2.0 * fr)')}
  return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), w.x), mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), w.x), w.y);`)}`),
      // Le test d'alpha tenu au loin, calculé en tête (dérivées en flot uniforme), appliqué avant le test.
      CUSTOM_FRAGMENT_MAIN_BEGIN: tr(`{
${V('lT', 'vec2', `${fin('vMainUV1')} * ${f4(2 * CELLULE)}`)}
lLoin = 1.0 + max(0.0, 0.5 * log2(max(dot(dFdx(lT), dFdx(lT)), dot(dFdy(lT), dFdy(lT))))) * 0.3;
}`),
      '!if \\(alpha<ALPHATESTVALUE\\)': 'alpha *= lLoin;\n$0',
      // La pluie fait luire : rugosité de 0,62 à 0,25.
      [rugosite]: `$0\nroughness = mix(roughness, 0.25, ${M}.y);\nmicroSurface = 1.0 - roughness;`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
${V('lF', 'vec3', F)}
if (lF.x < 2.5) {
  // Au fond de la plaque, dans l'ombre des autres ; chacune sa nuance.
  ${c} *= 0.45 + 0.6 * lF.y;
  ${c} *= mix(vec3(1.08, 1.04, 0.86), vec3(0.88, 1.0, 1.06), fract(lF.z * 7.3)) * (0.85 + 0.3 * fract(lF.z * 3.1));
  ${V('lL', 'float', `dot(${c}, vec3(0.3, 0.59, 0.11))`)}
  ${V('lBronze', 'float', `step(lF.z, 0.2) * clamp(max(${S}.x, ${S}.y * 0.7), 0.0, 1.0)`)}
  ${c} = mix(${c}, vec3(lL) * vec3(2.2, 1.0, 0.55), lBronze * 0.75);
  ${c} = mix(${c}, ${c} * vec3(0.85, 0.75, 0.82), ${S}.y * 0.45);
  ${V('lNeige', 'float', `${M}.z * smoothstep(0.45, 0.9, normalize(${fin('vNormalW')}).y) * smoothstep(0.35, 0.75, lBruit(${P}.xz * 9.0 + ${P}.y * 7.0))`)}
  ${c} = mix(${c}, vec3(0.86, 0.88, 0.93), lNeige * 0.65);
} else {
  ${c} *= 0.85 + 0.3 * lF.y;
}
${c} *= 1.0 - 0.3 * ${M}.y;
}`),
    },
  }
}

/** La matière unique des quatre côtés. */
function matiereDuLierre(scene: Scene): PBRMaterial {
  const m = matiere('lierre', scene, '#ffffff', 0.62)
  m.backFaceCulling = false
  m.twoSidedLighting = true
  brancherLueurs([m])
  const atlas = new DynamicTexture('lierre:atlas', { width: 2 * CELLULE, height: 2 * CELLULE }, scene, true)
  const ctx = atlas.getContext() as CanvasRenderingContext2D | null
  if (!ctx?.createRadialGradient) {
    // Sans canevas 2D (jsdom) : l'aplat de three.
    atlas.dispose()
    m.albedoColor = lin('#27461c')
  } else {
    peindreAtlas(ctx)
    atlas.update()
    atlas.hasAlpha = true
    atlas.anisotropicFilteringLevel = 8
    m.albedoTexture = atlas
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST
    m.alphaCutOff = 0.5
  }
  greffer(m, {
    nom: 'Lierre',
    attributs: ['aFeuille', 'aVent'],
    uniforms: [{ name: 'lierreSaison', size: 2, type: 'vec2' }, { name: 'lierreMeteo', size: 4, type: 'vec4' }],
    lier: (ubo) => {
      const s = vivant.getState().saison
      ubo.updateFloat2('lierreSaison', s.feuillage, s.chute)
      ubo.updateFloat4('lierreMeteo', METEO.vent, METEO.mouille, METEO.enneige, performance.now() / 1000)
    },
    code: codeDuLierre,
  })
  return m
}

/** La longueur d'un tronçon de mur : un maillage chacun, que le frustum de Babylon écarte hors du champ. */
const TRONCON = 32

/** Monte le lierre : un maillage par côté du parc et par tronçon de 32 m, tous porteurs d'ombre. */
export function monterLierre(scene: Scene): Mesh[] {
  const mat = matiereDuLierre(scene)
  const par = new Map<string, Feuille[]>()
  for (const f of lierreDuMur(MUR.plaques)) {
    const [x, , z] = f.position
    const k = `${f.cote}-${Math.floor((f.cote < 2 ? x : z) / TRONCON)}`
    if (!par.has(k)) par.set(k, [])
    par.get(k)!.push(f)
  }
  return [...par].map(([cote, liste]) => {
    const g = geometrieDuLierre(liste)
    const m = new Mesh(`lierre:${cote}`, scene)
    Object.assign(new VertexData(), { positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices }).applyToMesh(m)
    m.setVerticesData('aFeuille', g.feuille, false, 3)
    m.setVerticesData('aVent', g.vent, false, 3)
    m.material = mat
    m.isPickable = false
    m.receiveShadows = true
    return m
  })
}
