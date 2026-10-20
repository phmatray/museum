/**
 * La salle d'honneur à la manière de la Casa Batlló (SalleHonneurLayer de three,
 * `assets/architecture/salle-honneur.glb`, Draco) : voûte de plâtre, lampe-soleil,
 * stuc, lambris de chêne, pilastres en os, parquet en point de Hongrie.
 *
 * Modélisée dans le repère du plan : posée telle quelle. Lumière cuite par la
 * dernière couche UV (`eclairerModele`, le parquet dans sa propre région), puis
 * un maillage par matière. Le parquet prend la matière du musée (WoodFloor007),
 * la teinte de chaque lame dans ses sommets. La lampe brille plus fort la nuit
 * et une lumière part d'elle, sans ombre, qui éclaire tout à sa portée (16 m :
 * baie Batlló, toiles, projecteurs, parois), comme le pointLight de three.
 * ponytail : les 5 cives gardent leurs matières (émission déjà 0,5 × base, même
 * image que l'unification de three) : 4 appels de plus, à unifier en couleurs de
 * sommets si le budget serre.
 */
import { Light } from '@babylonjs/core/Lights/light'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { chargerGlb, eclairerModele, fusionnerParMatiere } from './glb.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { chargerCartes, matierePBR } from './matieres.ts'

/** La lampe, au centre de la voûte (`SOMMET` du script Blender). */
const LAMPE = new Vector3(24, 9.95, 6)
/**
 * three : decay 1,3 ; Babylon (FALLOFF_GLTF) : 1/d², même fenêtre
 * saturate(1 − (d/16)⁴)². L'intensité est multipliée par d^0,7 à cette distance
 * pour que les deux s'accordent là.
 * ponytail : plus clair que three sous 6 m, plus sombre au-delà (×0,7 à 10 m) ;
 * un plugin d'atténuation si l'écart se voit.
 */
const REFERENCE = 6

/** Les intensités selon le jour (SalleHonneurLayer.tsx), émissions par nom de matière. */
export function reglagesHonneur(jour: number): { lampe: number; emissions: Record<string, number> } {
  const nuit = 1 - jour
  return {
    lampe: (6 + 10 * nuit) * REFERENCE ** (2 - 1.3),
    emissions: {
      Honneur_Soleil: 1.4 + 2.6 * nuit,
      Honneur_Ambre: 0.8 + 1.6 * nuit,
      Honneur_Laiton: 0.25 + 0.45 * nuit,
      Honneur_Cive: 0.35 + 0.5 * nuit,
    },
  }
}

export async function monterSalleHonneur(
  scene: Scene,
  jour: number,
  atlas: Promise<RawTexture>,
  generateur: ShadowGenerator | null,
): Promise<void> {
  const r = reglagesHonneur(jour)
  // La lampe tout de suite, avant le GLB : elle entre dans la première compilation de toutes les matières.
  const lampe = new PointLight('lampe-honneur', LAMPE, scene)
  lampe.diffuse = lampe.specular = lin('#ffd6a0')
  lampe.intensity = r.lampe
  lampe.falloffType = Light.FALLOFF_GLTF
  lampe.range = 16

  const c = await chargerGlb(scene, 'assets/architecture/salle-honneur.glb')
  c.addAllToScene()

  // Le parquet du musée, UV en mètres / 3 posées lame par lame (répétition 1).
  // Albédo visé ≈ (0,27, 0,16, 0,085) : avec la carte et les teintes des lames, (1,2, 1,5, 2,25) linéaire ;
  // sans carte, l'albédo lui-même. Le gain de matierePBR est écrasé (cette promesse passe après la sienne).
  const parquet = matierePBR('honneur-parquet', 'parquet', scene, { motif: null })
  parquet.albedoColor = new Color3(0.28, 0.18, 0.115)
  void chargerCartes(scene, 'parquet').then(() => (parquet.albedoColor = new Color3(1.2, 1.5, 2.25)), () => {})
  for (const m of c.meshes) {
    if (m.name !== 'Parquet') continue
    m.material?.dispose()
    m.material = parquet
  }

  eclairerModele(c.meshes, 'salle-honneur', await atlas.catch(() => null))
  const maillages = fusionnerParMatiere(c.meshes)

  const opaques = new Set<PBRMaterial>()
  for (const m of maillages) {
    m.receiveShadows = true
    const mat = m.material
    if (!(mat instanceof PBRMaterial)) continue
    const e = Object.entries(r.emissions).find(([nom]) => mat.name.startsWith(nom))
    if (e) mat.emissiveIntensity = e[1]
    if (mat.name === 'Honneur_Ambre') continue
    opaques.add(mat)
    generateur?.addShadowCaster(m)
  }
  brancherLueurs(opaques)
  generateur?.getShadowMap()?.resetRefreshCounter()
}
