/**
 * Le lit du ruisseau (RuisseauLayer.tsx de three) : les galets de rivière, les
 * vieilles souches moussues et la branche morte (`ruisseau.glb`), posés par
 * `plan/ruisseau.ts`.
 *
 * Un lot de thin instances par modèle de galet (sept, une matière), un pour
 * les souches, une instance pour la branche : neuf appels de dessin. Le galet
 * est mouillé sous le fil de l'eau (greffe `GaletMouille`, teinte, cote de
 * l'eau, mousse et basalte par instance dans `aGalet`) ; la souche prend sa
 * mousse et trempe le pied (`SoucheMoussue`).
 * Galets, souches et branche se mouillent et s'enneigent (`intemperer`).
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { JARDIN } from '../plan/jardin.ts'
import { GALETS_DU_RUISSEAU, SOUCHES } from '../plan/ruisseau.ts'
import { chargerGlb } from './glb.ts'
import { dialecte, greffer } from './greffe.ts'
import { intemperer } from './intemperies.ts'
import { cacherAuLoin, instancier, matrices } from './lots.ts'

const LUM = 'vec3(0.3, 0.59, 0.11)'

/** `aGalet` des galets du modèle k (0..6), dans l'ordre de leurs matrices : teinte, cote de l'eau, mousse, basalte. */
export function attributsDesGalets(k: number): Float32Array {
  const sujets = GALETS_DU_RUISSEAU.filter((g) => g.modele === k)
  const a = new Float32Array(4 * sujets.length)
  sujets.forEach((s, i) => a.set([s.teinte, s.etang ? JARDIN.etang.niveau : JARDIN.ruisseau.niveau, (s.teinte * 7.31) % 1 < 0.35 ? 1 : 0, s.modele === 4 ? 1 : 0], 4 * i))
  return a
}

/** La branche, modelée le long de +x sur 3 m, couchée de `de` à `a` (une matrice, stockage Babylon). */
export function matriceDeLaBranche(): Float32Array {
  const { de, a } = JARDIN.souches.branche
  const d = Vector3.FromArray(a).subtract(Vector3.FromArray(de))
  const l = d.length()
  const q = new Quaternion()
  Quaternion.FromUnitVectorsToRef(new Vector3(1, 0, 0), d.normalize(), q)
  const buf = new Float32Array(16)
  Matrix.Compose(new Vector3(l / 3, l / 3, l / 3), q, Vector3.FromArray(de)).copyToArray(buf)
  return buf
}

/**
 * Le galet mouillé sous la cote de `aGalet.y`, imbibé sur trois centimètres
 * au-dessus (un liseré qui ondule), sec et mat plus haut, moussu sur le dessus
 * pour un sur trois des galets hors de l'eau ; rugosité remplacée.
 */
export function codeDuGalet(wgsl: boolean) {
  const { V, G, attribut, varying, vin, vout, fin, tr, rugosite } = dialecte(wgsl)
  const [g, P] = [fin('vGalet'), fin('vPositionW')]
  return {
    vertex: { CUSTOM_VERTEX_DEFINITIONS: `${attribut('aGalet', 'vec4')}\n${varying('vGalet', 'vec4')}`, CUSTOM_VERTEX_MAIN_END: `${vout('vGalet')} = ${vin('aGalet')};` },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varying('vGalet', 'vec4')}\n${G('gMouille', 'float')}\n${G('gMousse', 'float')}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
  ${V('gSous', 'float', `${g}.y - ${P}.y + 0.008 * sin(${P}.x * 37.0 + 3.0 * sin(${P}.z * 23.0))`)}
  gMouille = smoothstep(-0.035, 0.0, gSous);
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.055, 0.052, 0.048) * (0.8 + 0.4 * surfaceAlbedo.g), ${g}.w * smoothstep(0.18, 0.4, dot(surfaceAlbedo, ${LUM})));
  surfaceAlbedo *= ${g}.x;
  ${V('gLum', 'float', `dot(surfaceAlbedo, ${LUM})`)}
  ${V('gSec', 'vec3', 'mix(surfaceAlbedo, vec3(gLum), 0.2)')}
  ${V('gHumide', 'vec3', 'pow(surfaceAlbedo, vec3(1.3)) * 0.7')}
  surfaceAlbedo = mix(gSec, gHumide, gMouille);
  gMousse = ${g}.z * smoothstep(0.5, 0.85, normalize(${fin('vNormalW')}).y) * (1.0 - smoothstep(-0.07, -0.03, gSous));
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.15, 0.23, 0.07) * (0.7 + 1.2 * gLum), gMousse);
}`),
      [rugosite]: '$0\nroughness = mix(mix(0.75, 0.2, gMouille), 0.95, gMousse);\nmicroSurface = 1.0 - roughness;',
    },
  }
}

/**
 * La mousse de la souche : verts pâles saturés, coussin sur ce qui regarde le
 * ciel, pied qui trempe foncé. ponytail : appliquée APRÈS la couleur par sommet
 * (three : avant), la mousse n'en est plus assombrie ; écart accepté.
 */
export function codeDeLaSouche(wgsl: boolean) {
  const { V, fin, tr } = dialecte(wgsl)
  const P = fin('vPositionW')
  const n = JARDIN.ruisseau.niveau
  return {
    fragment: {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
  ${V('c', 'vec3', 'surfaceAlbedo')}
  ${V('vert', 'float', 'clamp((c.g - max(c.r, c.b)) * 6.0, 0.0, 1.0)')}
  surfaceAlbedo = mix(c, c * vec3(0.72, 1.0, 0.45), vert * 0.7);
  ${V('lum', 'float', `dot(c, ${LUM})`)}
  ${V('coussin', 'float', `smoothstep(0.45, 0.85, normalize(${fin('vNormalW')}).y + 0.35 * sin(${P}.x * 23.0 + 2.0 * sin(${P}.z * 17.0)))`)}
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.13, 0.22, 0.05) * (0.7 + 1.3 * lum), coussin * 0.85);
  surfaceAlbedo *= mix(0.55, 1.0, smoothstep(${(n - 0.01).toFixed(3)}, ${(n + 0.08).toFixed(3)}, ${P}.y));
}`),
    },
  }
}

/** Monte galets, souches et branche ; rend les porteurs d'ombre : souches et branche (un galet de 15 cm à demi noyé n'en pose pas de visible). */
export async function monterRuisseau(scene: Scene): Promise<Mesh[]> {
  const c = await chargerGlb(scene, 'assets/jardin/ruisseau.glb')
  const galet = c.materials.find((m) => m.name === 'Ruisseau_Galet')
  const souche = c.materials.find((m) => m.name === 'Ruisseau_Souche')
  if (galet) greffer(galet, { nom: 'GaletMouille', attributs: ['aGalet'], code: codeDuGalet })
  if (souche) greffer(souche, { nom: 'SoucheMoussue', code: codeDeLaSouche })
  for (const m of c.materials) if (/^Ruisseau_(Galet|Souche|Branche)$/.test(m.name)) intemperer(m)
  const buffers = matrices([
    ...GALETS_DU_RUISSEAU.map((s) => ({ piece: `src_galet_${s.modele + 1}`, x: s.x, y: s.y, z: s.z, lacet: s.lacet, echelle: s.echelle })),
    ...SOUCHES.map((s) => ({ piece: 'src_souche', ...s })),
  ])
  buffers.set('src_branche', matriceDeLaBranche())
  const porteurs = instancier(c, buffers)
  for (const m of porteurs) {
    // Une primitive par nœud : le maillage porte le nom du nœud.
    const k = /^src_galet_(\d)$/.exec(m.name)?.[1]
    if (!k) continue
    const a = attributsDesGalets(+k - 1)
    m.thinInstanceSetBuffer('aGalet', a, 4)
    // Un galet de 15 cm au-delà de 25 m : quelques pixels (lots.ts).
    cacherAuLoin(scene, m, { matrix: [buffers.get(m.name)!, 16], aGalet: [a, 4] }, 25)
  }
  return porteurs.filter((m) => !m.name.startsWith('src_galet'))
}
