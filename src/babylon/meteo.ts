/**
 * Le temps qu'il fait, vu (MeteoLayer.tsx) : la pluie ou la neige qui tombe
 * autour du visiteur (ou, du dedans, là où il la voit : par la porte, sous la
 * verrière), la brume au ras de l'étang, et sur toutes les matières PBR la
 * brume de la scène et le flash de l'orage (greffe 'Brume').
 *
 * Les valeurs lissées (pluie, vent, brume, éclair…) sont celles de METEO
 * (intemperies.ts) ; la neige qui tombe suit la météo CIBLE, comme three.
 * Sorties LINÉAIRES HDR : le rendu des tons est dans la passe d'écran.
 *
 * Écarts : la brume de scène ne touche que les PBRMaterial (les quelques
 * StandardMaterial du musée restent nets) ; pas de `scene.fogMode`.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { RegisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
// Les déclarations d'instances des chutes, dans les deux langues.
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration'
import '@babylonjs/core/ShadersWGSL/ShadersInclude/instancesDeclaration'

import { JARDIN, distanceEtang } from '../plan/jardin.ts'
import { centreDesChutes } from '../plan/toits.ts'
import { vivant, VIVANTES } from './etat.ts'
import { dialecte, greffer } from './greffe.ts'
import { AIR, bruit, METEO, toits } from './intemperies.ts'
import { lin } from './lueurs.ts'

/** Sous les toits, l'air ne porte qu'un quart de la brume du dehors. */
const BRUME_DEDANS = 0.25
const FLASH = lin('#dfe6ff').scale(2.2 / Math.PI)

export const CHUTES = {
  pluie: { n: 16000, boite: [26, 16, 26], taille: 0.012, opacite: 0.26, graine: 7 },
  neige: { n: 9000, boite: [26, 16, 26], taille: 0.045, opacite: 0.9, graine: 11 },
} as const

/** Le même semis à chaque chargement (Park-Miller, comme three). */
export function semis(n: number, graine: number): Float32Array {
  let e = graine
  return Float32Array.from({ length: n }, () => ((e = (e * 16807) % 2147483647) - 1) / 2147483646)
}

type T = 'float' | 'vec2' | 'vec3' | 'vec4'
const UNIFORMES_CHUTE: [string, T][] = [
  ['temps', 'float'], ['vent', 'float'], ['taille', 'float'], ['opacite', 'float'], ['jour', 'float'], ['eclair', 'float'],
  ['boite', 'vec3'], ['cam', 'vec3'], ['centre', 'vec3'], ['droite', 'vec3'], ['haut', 'vec3'],
]
const UNIFORMES_ETANG: [string, T][] = [['temps', 'float'], ['brume', 'float'], ['couleur', 'vec3']]

const sansAttributs = (s: string) => s.replace(/^(attribute.*|#include<instancesDeclaration>)$/gm, '')

/** Déclarations et `main` d'un ShaderMaterial, dans la langue du moteur. */
function programme(wgsl: boolean, uniformes: [string, T][], tete: string, corpsV: string, corpsF: string): { vertex: string; fragment: string } {
  const { T: ty } = dialecte(wgsl)
  const u = uniformes.map(([n, t]) => (wgsl ? `uniform ${n}: ${ty(t)};` : `uniform ${t} ${n};`)).join('\n')
  const vp = wgsl ? 'uniform viewProjection: mat4x4f;' : 'uniform mat4 viewProjection;'
  return wgsl
    ? {
        vertex: `${vp}\n${u}\n${tete}\n@vertex\nfn main(input: VertexInputs) -> FragmentInputs {\n${corpsV}\n}`,
        fragment: `${u}\n${sansAttributs(tete)}\n@fragment\nfn main(input: FragmentInputs) -> FragmentOutputs {\n${corpsF}\n}`,
      }
    : {
        vertex: `precision highp float;\n${vp}\n${u}\n${tete}\nvoid main() {\n${corpsV}\n}`,
        fragment: `precision highp float;\n${u}\n${sansAttributs(tete)}\nvoid main() {\n${corpsF}\n}`,
      }
}

/** Les sources d'une chute (exportées pour les tests). */
export function sourcesChute(neige: boolean, wgsl: boolean): { vertex: string; fragment: string } {
  const { V, u, vin, vout, fin, tr, attribut, varying } = dialecte(wgsl)
  const [t, vent, taille, boite, cam, centre] = ['temps', 'vent', 'taille', 'boite', 'cam', 'centre'].map(u)
  const pos = vin('position')
  const tete = `${attribut('position', 'vec3')}\n${attribut('aGoutte', 'vec4')}\n#include<instancesDeclaration>\n${varying('vAlpha', 'float')}\n${varying('vUv', 'vec2')}\n${toits(wgsl, 'toit')}`
  const corpsV = tr(`
${V('g', 'vec4', vin('aGoutte'))}
${neige
    ? `${V('vit', 'vec3', `vec3(0.3 * ${vent}, -1.0, 0.1 * ${vent})`)}
${V('p', 'vec3', `g.xyz * ${boite} + vit * ${t} * (0.7 + 0.6 * g.w)`)}
p.x += sin(${t} * 0.9 + g.w * 40.0) * 0.3;
p.z += cos(${t} * 0.7 + g.w * 23.0) * 0.3;`
    : `${V('vit', 'vec3', `vec3(0.35 * ${vent}, -9.0, 0.12 * ${vent})`)}
${V('p', 'vec3', `g.xyz * ${boite} + vit * ${t} * (0.85 + 0.3 * g.w)`)}`}
// Replié autour du centre : chaque goutte garde sa place, le nuage suit le visiteur.
${V('coin', 'vec3', `${centre} - 0.5 * ${boite}`)}
${V('q', 'vec3', 'p - coin')}
p = coin + q - ${boite} * floor(q / ${boite});
// Pas sous les toits : ni dans les salles ni sous la verrière de la nef.
${V('dedans', 'float', 'step(p.y, toit(p.xz))')}
${V('d', 'float', `length(p.xz - ${centre}.xz) / (0.5 * ${boite}.x)`)}
${V('a', 'float', `(1.0 - smoothstep(0.6, 1.0, d)) * smoothstep(0.8, 3.0, distance(p, ${cam})) * (1.0 - dedans)`)}
${neige
    ? V('w', 'vec3', `p + (${u('droite')} * ${pos}.x + ${u('haut')} * (${pos}.y - 0.5)) * ${taille}`)
    : `// Un trait le long de sa chute, de face pour la caméra : le flou de bougé d'une goutte.
${V('dir', 'vec3', 'normalize(vit)')}
${V('cote', 'vec3', `normalize(cross(dir, p - ${cam}))`)}
${V('w', 'vec3', `p + cote * ${pos}.x * ${taille} + dir * ${pos}.y * 0.5`)}`}
${vout('vAlpha')} = a;
${vout('vUv')} = vec2(${pos}.x + 0.5, ${pos}.y);
${wgsl
    ? `vertexOutputs.position = select(${u('viewProjection')} * vec4(w, 1.0), vec4(2.0, 2.0, 2.0, 1.0), a <= 0.0);`
    : 'gl_Position = a <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : viewProjection * vec4(w, 1.0);'}`)
  const uv = fin('vUv')
  const corpsF = tr(`
${neige
    ? `${V('a', 'float', `smoothstep(0.5, 0.15, length(${uv} - vec2(0.5)))`)}
${V('c', 'vec3', 'vec3(0.95, 0.96, 1.0)')}`
    : `${V('a', 'float', `(1.0 - abs(${uv}.x - 0.5) * 2.0) * smoothstep(0.0, 0.4, ${uv}.y) * smoothstep(1.0, 0.6, ${uv}.y)`)}
${V('c', 'vec3', 'vec3(0.72, 0.77, 0.84)')}`}
${wgsl ? 'fragmentOutputs.color' : 'gl_FragColor'} = vec4(c * (0.15 + 0.85 * ${u('jour')} + ${u('eclair')}), a * ${fin('vAlpha')} * ${u('opacite')});`)
  return programme(wgsl, UNIFORMES_CHUTE, tete, corpsV, corpsF)
}

/** Les sources de la brume de l'étang (exportées pour les tests). */
export function sourcesEtang(wgsl: boolean): { vertex: string; fragment: string } {
  const { V, u, vin, vout, fin, tr, attribut, varying } = dialecte(wgsl)
  const tete = `${tr(`${attribut('position', 'vec3')}\n${attribut('aBord', 'float')}\n${varying('vBord', 'float')}\n${varying('vXZ', 'vec2')}`)}
${bruit(wgsl, 'e')}`
  const corpsV = tr(`${vout('vBord')} = ${vin('aBord')};
${vout('vXZ')} = ${vin('position')}.xz;
${wgsl ? 'vertexOutputs.position' : 'gl_Position'} = ${u('viewProjection')} * vec4(${vin('position')}, 1.0);`)
  const t = u('temps')
  const corpsF = tr(`${V('q', 'vec2', `${fin('vXZ')} * 0.25 + vec2(${t} * 0.03, ${t} * 0.012)`)}
${V('n', 'float', `eBruit(q) * 0.6 + eBruit(q * 2.3 - ${t} * 0.02) * 0.4`)}
${wgsl ? 'fragmentOutputs.color' : 'gl_FragColor'} = vec4(${u('couleur')} * 1.05, ${fin('vBord')} * ${u('brume')} * smoothstep(0.25, 0.8, n) * 0.4);`)
  return programme(wgsl, UNIFORMES_ETANG, tete, corpsV, corpsF)
}

/** Un ShaderMaterial transparent des deux langues (sources posées une fois dans le magasin). */
function matiere(scene: Scene, nom: string, s: (wgsl: boolean) => { vertex: string; fragment: string }, attributs: string[], uniformes: [string, T][]): ShaderMaterial {
  const wgsl = scene.getEngine().isWebGPU
  const magasin = wgsl ? ShaderStore.ShadersStoreWGSL : ShaderStore.ShadersStore
  const { vertex, fragment } = s(wgsl)
  magasin[`${nom}VertexShader`] = vertex
  magasin[`${nom}FragmentShader`] = fragment
  const m = new ShaderMaterial(nom, scene, nom, {
    attributes: attributs,
    uniforms: ['viewProjection', ...uniformes.map(([n]) => n)],
    needAlphaBlending: true,
    shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  })
  m.backFaceCulling = false
  m.disableDepthWrite = true
  // Les uniformes changent à chaque image : jamais figée (main.ts).
  VIVANTES.add(nom)
  return m
}

/**
 * La pluie (des traits) ou la neige (des flocons) : des milliers de quads en UN
 * appel (thin instances), repliés dans une boîte qui suit la caméra. Le nombre
 * dessiné suit l'intensité ; rien sous les toits (le shader efface les gouttes du dedans).
 */
function chute(scene: Scene, camera: Camera, neige: boolean): Mesh {
  const R = CHUTES[neige ? 'neige' : 'pluie']
  const nom = neige ? 'neige' : 'pluie'
  const mesh = new Mesh(nom, scene)
  const v = new VertexData()
  v.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]
  v.indices = [0, 1, 2, 0, 2, 3]
  v.applyToMesh(mesh)
  const m = matiere(scene, `chute-${nom}`, (w) => sourcesChute(neige, w), ['position', 'aGoutte'], UNIFORMES_CHUTE)
  m.setFloat('taille', R.taille)
  m.setFloat('opacite', R.opacite)
  m.setVector3('boite', Vector3.FromArray(R.boite))
  mesh.material = m
  mesh.doNotSyncBoundingInfo = true
  // Des matrices d'identité : la seule façon de dessiner N instances (thinInstanceCount ≤ matrices).
  const id = Matrix.Identity().asArray()
  mesh.thinInstanceSetBuffer('matrix', Float32Array.from({ length: R.n * 16 }, (_, i) => id[i % 16]), 16)
  mesh.thinInstanceSetBuffer('aGoutte', semis(R.n * 4, R.graine), 4)
  mesh.alwaysSelectAsActiveMesh = true
  mesh.isPickable = false
  // Après le verre de la nef et la brume de l'étang.
  mesh.alphaIndex = 2
  mesh.metadata = { zone: 'ciel' }
  mesh.setEnabled(false)

  const centre = new Vector3()
  const [cam, droite, haut, regard] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  let premier = true
  scene.onBeforeRenderObservable.add(() => {
    const { meteo, ciel } = vivant.getState()
    const n = Math.round(R.n * Math.min(1, neige ? meteo.neige : METEO.pluie))
    mesh.setEnabled(n > 0)
    if (n <= 0) return
    mesh.thinInstanceCount = n
    const vue = camera.getViewMatrix().m
    cam.copyFrom(camera.globalPosition)
    droite.set(vue[0], vue[4], vue[8])
    haut.set(vue[1], vue[5], vue[9])
    regard.set(-vue[2], -vue[6], -vue[10])
    const c = centreDesChutes(cam, regard, 0.45 * R.boite[0], 0.5 * R.boite[1])
    // Glissé en un quart de seconde : passer la porte ne fait pas sauter l'averse.
    if (premier) centre.set(c.x, c.y, c.z)
    else Vector3.LerpToRef(centre, regard.set(c.x, c.y, c.z), Math.min(1, scene.getEngine().getDeltaTime() / 250), centre)
    premier = false
    m.setFloat('temps', METEO.temps)
    m.setFloat('vent', METEO.vent)
    m.setFloat('jour', ciel.jour)
    m.setFloat('eclair', METEO.eclair)
    m.setVector3('cam', cam)
    m.setVector3('centre', centre)
    m.setVector3('droite', droite)
    m.setVector3('haut', haut)
  })
  return mesh
}

/** Un voile au ras de l'étang, qui dérive : fondu vers la berge, visible par temps de brouillard. */
function brumeDeLEtang(scene: Scene): Mesh {
  const xs = JARDIN.etang.contour.map(([x]) => x)
  const zs = JARDIN.etang.contour.map(([, z]) => z)
  const [x0, x1, z0, z1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...zs) - 2, Math.max(...zs) + 2]
  const g = CreateGround('brume-etang', { width: x1 - x0, height: z1 - z0, subdivisionsX: Math.ceil(x1 - x0), subdivisionsY: Math.ceil(z1 - z0) }, scene)
  g.bakeTransformIntoVertices(Matrix.Translation((x0 + x1) / 2, JARDIN.etang.niveau + 0.35, (z0 + z1) / 2))
  const p = g.getVerticesData('position')!
  g.setVerticesData('aBord', Float32Array.from({ length: p.length / 3 }, (_, i) => Math.min(1, Math.max(0, (1.5 - distanceEtang(p[3 * i], p[3 * i + 2])) / 3))), false, 1)
  const m = matiere(scene, 'brume-etang', sourcesEtang, ['position', 'aBord'], UNIFORMES_ETANG)
  g.material = m
  g.isPickable = false
  g.alphaIndex = 1
  g.metadata = { zone: 'ciel' }
  g.setEnabled(false)
  scene.onBeforeRenderObservable.add(() => {
    g.setEnabled(METEO.brume > 0.02)
    if (!g.isEnabled()) return
    m.setFloat('temps', METEO.temps)
    m.setFloat('brume', METEO.brume)
    m.setColor3('couleur', METEO.brumeCouleur)
  })
  return g
}

/** La pluie, la neige et la brume de l'étang (jamais porteurs d'ombre, jamais masquées). */
export function monterMeteo(scene: Scene, camera: Camera): Mesh[] {
  return [chute(scene, camera, false), chute(scene, camera, true), brumeDeLEtang(scene)]
}

/** Le code de la greffe 'Brume' (exporté pour les tests). */
export function codeBrume(wgsl: boolean): { fragment: Record<string, string> } {
  const { V, u, fin, tr, fn } = dialecte(wgsl)
  const [A, E, H] = [u('brumeA'), u('eclairA'), u('brumeH')]
  const [AA, AB, AC, AD] = [u('airA'), u('airB'), u('airC'), u('airD')]
  const P = fin('vPositionW')
  const O = wgsl ? 'scene.vEyePosition.xyz' : 'vEyePosition.xyz'
  // scene/atmosphere.ts : la couleur de l'air dans la direction d, et la part d'air entre l'œil o et le point p.
  const air = tr(`${fn('airCouleur', [['d', 'vec3']], 'vec3', `
  ${V('face', 'float', `max(dot(d, ${AC}.xyz), 0.0)`)}
  return ${AA}.rgb + ${AD}.rgb * ${AC}.w * (0.25 * face * face + pow(face, 12.0));`)}
${fn('airVoile', [['o', 'vec3'], ['p', 'vec3']], 'float', `
  ${V('v', 'vec3', 'p - o')}
  ${V('l', 'float', 'length(v)')}
  ${V('b', 'float', `max(${AB}.y, 1e-3)`)}
  ${V('e0', 'float', 'exp(-b * max(o.y, -2.0))')}
  ${V('moyenne', 'float', 'e0')}
  if (abs(v.y) > 0.05) { moyenne = (e0 - exp(-b * max(o.y + v.y, -2.0))) / (b * v.y); }
  return 1.0 - exp(-l * (${AA}.w + ${AB}.x * moyenne));`)}`)
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${toits(wgsl, 'brumeToit')}\n${air}`,
      CUSTOM_FRAGMENT_BEFORE_FOG: tr(`{
// L'air du dehors (perspective aérienne, brume au sol), avant la brume du temps ; une source le perce.
if (${AA}.w + ${AB}.x > 0.0) {
${V('aV', 'vec3', `${P} - ${O}`)}
${V('aS', 'float', '1.0 - smoothstep(0.25, 1.5, max(finalColor.r, max(finalColor.g, finalColor.b)))')}
finalColor = vec4(mix(finalColor.rgb, airCouleur(normalize(aV)), step(brumeToit(${P}.xz), ${P}.y) * aS * airVoile(${O}, ${P})), finalColor.a);
}
${V('bF', 'float', '1.0')}
#ifdef LIGHTMAP
bF = lightmapColor.g / max(1e-4, ${wgsl ? `select(select(${H}.x, ${H}.z, normalW.y < -0.5), ${H}.y, normalW.y > 0.5)` : `normalW.y > 0.5 ? ${H}.y : normalW.y < -0.5 ? ${H}.z : ${H}.x`});
#endif
// L'éclair : une ambiante bleutée (albedo / π × couleur × force), sous le facteur de la lumière cuite.
${V('bC', 'vec3', `finalColor.rgb + surfaceAlbedo.rgb * ${E}.rgb * bF`)}
// La brume exp2 tient au LIEU du fragment : sous les toits, un quart de la profondeur.
${V('bP', 'float', `abs((${wgsl ? 'scene.view' : 'view'} * vec4(${P}, 1.0)).z) * mix(${BRUME_DEDANS.toFixed(2)}, 1.0, step(brumeToit(${P}.xz), ${P}.y)) * ${A}.w`)}
finalColor = vec4(mix(bC, ${A}.rgb, 1.0 - exp(-bP * bP)), finalColor.a);
}
`),
    },
  }
}

/** L'état de la brume et de l'éclair, recalculé une fois par image. */
const ETAT = { image: -1, hemi: [1, 1, 1] }
function lierBrume(ubo: UniformBuffer, scene: Scene): void {
  if (ETAT.image !== scene.getFrameId()) {
    ETAT.image = scene.getFrameId()
    // L'hémisphérique que la lightmap remplace, sur une face de côté, de dessus, de dessous (comme lueurs.ts).
    const h = scene.lights.find((l) => l.getClassName() === 'HemisphericLight') as HemisphericLight | undefined
    if (h) ETAT.hemi = [0.5, 1, 0].map((w) => Color3.Lerp(h.groundColor, h.diffuse, w).g * h.intensity)
  }
  const b = METEO.brumeCouleur
  ubo.updateFloat4('brumeA', b.r, b.g, b.b, METEO.densite)
  ubo.updateFloat4('eclairA', FLASH.r * METEO.eclair, FLASH.g * METEO.eclair, FLASH.b * METEO.eclair, 0)
  ubo.updateFloat3('brumeH', ETAT.hemi[0], ETAT.hemi[1], ETAT.hemi[2])
  const { air: a, soleil: d } = AIR
  ubo.updateFloat4('airA', a.couleur[0], a.couleur[1], a.couleur[2], a.densite)
  ubo.updateFloat4('airB', a.sol, a.decroissance, 0, 0)
  ubo.updateFloat4('airC', d[0], d[1], d[2], a.diffusion)
  ubo.updateFloat4('airD', a.lueur[0], a.lueur[1], a.lueur[2], 0)
}

/**
 * La brume de la scène et le flash d'orage sur toute PBRMaterial créée ensuite
 * (à appeler avant la première matière), précédées de l'air du dehors
 * (scene/atmosphere.ts : perspective aérienne et brume au sol, `AIR`). Priorité 400 : après les
 * intempéries. Posée une fois pour toutes, même par beau temps (densité nulle) :
 * aucune recompilation quand le temps change.
 */
export function enregistrerBrume(): void {
  RegisterMaterialPlugin('Brume', (m) =>
    m.getClassName() === 'PBRMaterial'
      ? greffer(m, {
          nom: 'Brume',
          priorite: 400,
          uniforms: [
            { name: 'brumeA', size: 4, type: 'vec4' },
            { name: 'eclairA', size: 4, type: 'vec4' },
            { name: 'brumeH', size: 3, type: 'vec3' },
            { name: 'airA', size: 4, type: 'vec4' },
            { name: 'airB', size: 4, type: 'vec4' },
            { name: 'airC', size: 4, type: 'vec4' },
            { name: 'airD', size: 4, type: 'vec4' },
          ],
          lier: (ubo) => lierBrume(ubo, m.getScene()),
          code: codeBrume,
        })
      : null,
  )
}
