/**
 * La géométrie statique fusionnée : un maillage par matière et par zone, à la
 * même place, sans toucher à ce qu'on garde ; les verres plans en une passe.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { fusionnerParMatiere, unePasse, unifierParCouleur } from '../fusion'

const boite = (m: THREE.Material, x: number, nom = '') => {
  // Sans groupes, comme une primitive glTF (BoxGeometry en a un par face).
  const g = new THREE.BoxGeometry(1, 1, 1)
  g.clearGroups()
  const o = new THREE.Mesh(g, m)
  o.position.set(x, 1, 20) // dans le hall
  o.name = nom
  return o
}
const maillages = (r: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  r.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh))
  return out
}

describe('fusionnerParMatiere', () => {
  it('réunit ce qui partage une matière, à la même place, et garde le reste', () => {
    const [a, b] = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]
    const racine = new THREE.Group()
    const parent = new THREE.Group()
    parent.position.set(0, 0.5, 0)
    parent.add(boite(a, 20), boite(a, 22))
    racine.add(parent, boite(a, 24), boite(b, 26), boite(a, 28, 'Aiguille'))
    expect(fusionnerParMatiere(racine, (o) => o.name === 'Aiguille')).toBe(2)
    const m = maillages(racine)
    expect(m).toHaveLength(3)
    const fusion = m.find((x) => x.material === a && x.name !== 'Aiguille')!
    fusion.geometry.computeBoundingBox()
    const bb = fusion.geometry.boundingBox!
    // Les trois boîtes, transformations du parent comprises.
    expect(bb.min.x).toBeCloseTo(19.5)
    expect(bb.max.x).toBeCloseTo(24.5)
    expect(bb.min.y).toBeCloseTo(0.5)
    expect(bb.max.y).toBeCloseTo(2)
    expect(m.some((x) => x.name === 'Aiguille')).toBe(true)
  })

  it('ne fusionne pas par-dessus deux zones du tri des salles', () => {
    const a = new THREE.MeshStandardMaterial()
    const racine = new THREE.Group()
    const dehors = boite(a, 24)
    dehors.position.set(24, 1, 60) // au parc
    racine.add(boite(a, 20), dehors)
    expect(fusionnerParMatiere(racine)).toBe(0)
    expect(maillages(racine)).toHaveLength(2)
  })
})

describe('unifierParCouleur', () => {
  it('fait d’une famille de teintes une matière aux couleurs de sommets, lueur comprise', () => {
    const teinte = (nom: string, c: [number, number, number]) =>
      new THREE.MeshStandardMaterial({ name: nom, color: new THREE.Color(...c), emissive: new THREE.Color(...c.map((x) => x * 0.7) as [number, number, number]) })
    const [bleu, vert] = [teinte('Cive_Bleu', [0.1, 0.2, 0.8]), teinte('Cive_Vert', [0.2, 0.6, 0.2])]
    const racine = new THREE.Group()
    const [a, b] = [boite(bleu, 20), boite(vert, 22)]
    racine.add(a, b, boite(new THREE.MeshStandardMaterial({ name: 'Chene' }), 24))
    expect(unifierParCouleur(racine, 'Cive')).toBe(2)
    const unie = a.material as THREE.MeshStandardMaterial
    expect(b.material).toBe(unie)
    expect(unie.name).toBe('Cive_Bleu')
    expect(unie.vertexColors).toBe(true)
    expect(unie.emissive.r).toBeCloseTo(0.7)
    expect(a.geometry.getAttribute('color').getZ(0)).toBeCloseTo(0.8)
    expect(b.geometry.getAttribute('color').getY(0)).toBeCloseTo(0.6)
    // Puis la fusion les réunit : deux maillages, le chêne et les cives.
    expect(fusionnerParMatiere(racine)).toBe(1)
    expect(maillages(racine)).toHaveLength(2)
  })
})

describe('unePasse', () => {
  const verre = () => new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide })

  it('passe une vitre plane en une passe, pas une vitre épaisse', () => {
    const [plan, epais] = [verre(), verre()]
    const racine = new THREE.Group()
    racine.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 1), plan), new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.01), epais))
    expect(unePasse(racine)).toBe(1)
    expect(plan.forceSinglePass).toBe(true)
    expect(epais.forceSinglePass).toBe(false)
  })

  it('laisse en deux passes une matière qu’un volume partage avec une vitre plane', () => {
    const m = verre()
    const racine = new THREE.Group()
    racine.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 1), m), new THREE.Mesh(new THREE.SphereGeometry(1), m))
    expect(unePasse(racine)).toBe(0)
    expect(m.forceSinglePass).toBe(false)
  })
})
