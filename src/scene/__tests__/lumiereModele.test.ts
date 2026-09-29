import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import LUMIERE_JSON from '../../plan/lumiere.json' with { type: 'json' }
import { eclairerModele } from '../lumiere'

const { largeur, hauteur, modeles } = LUMIERE_JSON as { largeur: number; hauteur: number; modeles: Record<string, number[]> }

function maillage(nom: string, uvs: number[], uv1?: number[]): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uvs.length * 1.5), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
  if (uv1) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(uv1), 2))
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial())
  m.name = nom
  return m
}

describe('eclairerModele', () => {
  it('étire la dernière couche UV sur la région du modèle, v retourné (glTF compte depuis le haut)', () => {
    const r = modeles.escalier
    const m = maillage('Escalier_Volees', [9, 9, 9, 9], [0, 1, 1, 0])
    eclairerModele(m, 'escalier')
    const a = m.geometry.getAttribute('aLumiereUV')
    expect(a.getX(0) * largeur).toBeCloseTo(r[0], 3)
    expect(a.getY(0) * hauteur).toBeCloseTo(r[1], 3)
    expect(a.getX(1) * largeur).toBeCloseTo(r[2], 3)
    expect(a.getY(1) * hauteur).toBeCloseTo(r[3], 3)
    expect((m.material as THREE.Material).defines?.LUMIERE_MODELE).toBe('')
  })

  it('une pièce qui a sa région la prend ; sans UV ou sans région, rien ne change', () => {
    const parquet = maillage('Parquet', [0, 1])
    const soleil = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial())
    const inconnu = maillage('X', [0, 1])
    eclairerModele(parquet, 'salle-honneur')
    eclairerModele(soleil, 'salle-honneur')
    eclairerModele(inconnu, 'inconnu')
    expect(parquet.geometry.getAttribute('aLumiereUV').getX(0) * largeur).toBeCloseTo(modeles['salle-honneur/Parquet'][0], 3)
    expect(soleil.geometry.getAttribute('aLumiereUV')).toBeUndefined()
    expect(inconnu.geometry.getAttribute('aLumiereUV')).toBeUndefined()
  })
})
