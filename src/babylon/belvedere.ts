/**
 * Le pavillon du BELVÉDÈRE, la palissade du roji, sa porte et la lanterne de la
 * terrasse (`assets/architecture/belvedere.glb`, BelvedereLayer.tsx de three),
 * modelés dans le repère du plan : posés tels quels. Draco, sans texture ni
 * couche « Lumiere » ; les couleurs de sommets (COLOR_0) teintent chaque latte.
 * Les pas japonais de la rive sud en un lot d'instances. La terrasse de pierre
 * est du jardin : en vague 1, le pavillon flotte.
 *
 * Les lanternes s'allument au crépuscule : de l'autre bout de l'étang, la nuit,
 * c'est elles qu'on voit. Pas de vraie lumière : seule la surface brille.
 * ponytail : ni météo (intemperer), ni zone PARC du tri par salle, ni ambiance
 * « dehors la nuit » : viendront avec la météo, la visibilité et le jardin.
 */
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import type { Scene } from '@babylonjs/core/scene'

import { PAS_DE_LA_RIVE } from '../plan/belvedere.ts'
import { hauteurDuParc } from '../plan/relief.ts'
import { chargerGlb } from './glb.ts'
import { smoothstep } from './lueurs.ts'
import { matierePBR } from './matieres.ts'

/** L'éclat des lanternes la nuit (ECLAT de three), éteintes en plein jour. */
export function eclatDesLanternes(jour: number): number {
  return 3.2 * (1 - smoothstep(jour, 0.15, 0.6))
}

/** Les matrices des pas (thin instances) : posés à +2 cm du relief, tournés de leur lacet, ovalisés. */
export function matricesDesPas(): Float32Array {
  const out = new Float32Array(PAS_DE_LA_RIVE.length * 16)
  PAS_DE_LA_RIVE.forEach((s, i) =>
    Matrix.Compose(
      new Vector3(s.rayon * (0.9 + 0.2 * Math.sin(s.lacet * 3)), 1, s.rayon),
      Quaternion.RotationAxis(Vector3.Up(), s.lacet),
      new Vector3(s.x, hauteurDuParc(s.x, s.z) + 0.02, s.z),
    ).copyToArray(out, i * 16),
  )
  return out
}

/** La dalle : un cylindre à neuf pans au contour cassé, affleurant de 5 cm. */
function dalle(scene: Scene): Mesh {
  const v = CreateCylinderVertexData({ diameterTop: 2, diameterBottom: 2.12, height: 0.1, tessellation: 9, subdivisions: 1 })
  const p = v.positions as number[]
  for (let i = 0; i < p.length; i += 3) {
    const a = Math.atan2(p[i + 2], p[i])
    const k = 0.82 + 0.18 * Math.abs(Math.sin(a * 2.3 + 1.1) * Math.cos(a * 3.7))
    p[i] *= k
    p[i + 2] *= k
  }
  v.normals = []
  VertexData.ComputeNormals(p, v.indices!, v.normals)
  const m = new Mesh('belvedere:pas', scene)
  v.applyToMesh(m)
  return m
}

export async function monterBelvedere(scene: Scene, jour: number, generateur: ShadowGenerator | null): Promise<void> {
  const pas = dalle(scene)
  // La roche du jardin (Rock044), teintée, motif métrique de 1,6 m sur les UV du cylindre, comme three.
  pas.material = matierePBR('pas', 'roche', scene, { teinte: '#b9bbb6' })
  pas.thinInstanceSetBuffer('matrix', matricesDesPas(), 16)
  pas.receiveShadows = true
  generateur?.addShadowCaster(pas)
  const c = await chargerGlb(scene, 'assets/architecture/belvedere.glb')
  c.addAllToScene()
  const lueur = c.materials.find((m) => m.name === 'Belvedere_Lueur')
  if (lueur instanceof PBRMaterial) {
    lueur.emissiveColor = new Color3(1, 0.62, 0.3)
    lueur.emissiveIntensity = eclatDesLanternes(jour)
  }
  for (const m of c.meshes.filter((m) => m.getTotalVertices() > 0)) {
    m.receiveShadows = true
    generateur?.addShadowCaster(m)
  }
  generateur?.getShadowMap()?.resetRefreshCounter()
}
