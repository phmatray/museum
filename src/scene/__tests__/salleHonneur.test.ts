/**
 * La salle d'honneur à la Batlló (`build-salle-honneur.py`) et les vitrines
 * Cernuschi (`build-vitrines.py`) sont modelées aux cotes du plan : une voûte
 * qui crèverait le toit, un encadrement qui mordrait sur une porte, un cadre
 * qui couvrirait l'image ou une borne plus large que son obstacle se verraient
 * — ou se traverseraient.
 */
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { VOUTE } from '../../plan/plafonds'
import { BORNE, PANNEAU, SALLE, TOILE } from '../../plan/vitrines'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

const sommets = (o: THREE.Object3D) => {
  const out: THREE.Vector3[] = []
  o.updateMatrixWorld(true)
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return
    const p = m.geometry.attributes.position
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld))
  })
  return out
}

describe('salle-honneur.glb', () => {
  const murs = SALLE.sol + MUSEE.storey - MUSEE.slab

  it('tient dans la salle, du plancher au-dessous du parapet du toit', async () => {
    const { scene } = await chargerGLTF('public/assets/architecture/salle-honneur.glb')
    const b = new THREE.Box3().setFromObject(scene)
    expect(b.min.x).toBeGreaterThan(SALLE.x0)
    expect(b.max.x).toBeLessThan(SALLE.x1)
    expect(b.min.z).toBeGreaterThan(SALLE.z0)
    expect(b.max.z).toBeLessThan(SALLE.z1)
    expect(b.min.y).toBeGreaterThanOrEqual(SALLE.sol - 1e-3)
    expect(b.min.y).toBeLessThan(SALLE.sol + 0.01)
    expect(b.max.y).toBeLessThan(murs + 1.2)
    for (const nom of ['Voute', 'Soleil', 'Peau', 'Lambris', 'Os', 'Portes', 'Parquet']) expect(scene.getObjectByName(nom), nom).toBeDefined()
    const parquet = scene.getObjectByName('Parquet') as THREE.Mesh
    expect(parquet.geometry.attributes.uv).toBeDefined()
    expect(parquet.geometry.attributes.color).toBeDefined()
  })

  it('porte les rails sur une corniche plate, là où `projecteurs.ts` les pend', async () => {
    const { scene } = await chargerGLTF('public/assets/architecture/salle-honneur.glb')
    const corniche = murs + VOUTE.gorge
    const i = 0.15
    for (const v of sommets(scene.getObjectByName('Voute')!)) {
      const d = Math.min(v.x - SALLE.x0 - i, SALLE.x1 - i - v.x, v.z - SALLE.z0 - i, SALLE.z1 - i - v.z)
      if (d > 1.2 && d < 1.9) expect(v.y).toBeCloseTo(corniche, 2)
    }
  })

  it('laisse libres les deux portes : aucun chêne sous le linteau dans la baie', async () => {
    const { scene } = await chargerGLTF('public/assets/architecture/salle-honneur.glb')
    const portes = MUSEE.levels.find((l) => l.elevation === SALLE.sol)!.openings.filter((o) => o.kind === 'door' && (o.a === 'honneur' || o.b === 'honneur'))
    expect(portes).toHaveLength(2)
    for (const v of sommets(scene.getObjectByName('Portes')!)) {
      // Les angles hauts de la baie sont arrondis, comme chez Gaudí : on juge sous eux.
      if (v.y > SALLE.sol + 2.2) continue
      for (const o of portes) if (Math.abs(v.x - o.x) < 0.5) expect(Math.abs(v.z - o.z)).toBeGreaterThan(o.width / 2 - 0.015)
    }
  })
})

describe('vitrines.glb', () => {
  it('panneau, cadre et borne aux cotes de `plan/vitrines.ts`', async () => {
    const { scene } = await chargerGLTF('public/assets/architecture/vitrines.glb')
    const boite = (nom: string) => new THREE.Box3().setFromObject(scene.getObjectByName(nom)!)

    const p = boite('Panneau')
    expect(p.max.x - p.min.x).toBeCloseTo(PANNEAU.largeur, 1)
    expect(p.max.y - p.min.y).toBeCloseTo(PANNEAU.hauteur, 1)
    expect(p.min.z).toBeCloseTo(0, 3)
    expect(p.max.z).toBeCloseTo(PANNEAU.epaisseur, 3)

    // Le cadre ne mord pas sur l'image, et tient sur le panneau.
    const c = boite('Cadre')
    expect(c.min.z).toBeGreaterThanOrEqual(-1e-3)
    expect(c.max.x - c.min.x).toBeLessThan(TOILE.largeur + 2 * TOILE.profil + 0.3)
    for (const v of sommets(scene.getObjectByName('Cadre')!)) {
      expect(Math.abs(v.x) >= TOILE.largeur / 2 - 1e-3 || Math.abs(v.y) >= TOILE.hauteur / 2 - 1e-3).toBe(true)
    }

    // La borne tient dans son obstacle, à hauteur de pupitre.
    const b = boite('Borne')
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(BORNE.largeur)
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(BORNE.profondeur)
    expect(b.max.y).toBeGreaterThan(1.1)
    expect(b.max.y).toBeLessThan(1.3)
  })
})
