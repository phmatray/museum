import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { asseoir, avancer, mixeur, pente, suivre, type Nom } from '../bavette'

const DUREES = { Assis: 7.5, Descente: 3, Dort: 15, Enroule: 6.75, Marche: 1.1667, Repos: 5, Reveil: 5, Sasseoir: 1.5, Saut: 1.75 } as Record<Nom, number>
const tourner = (m: ReturnType<typeof mixeur>, s: number) => { for (let i = 0; i < s * 60; i++) avancer(m, 1 / 60) }

describe('le mixeur de Bavette', () => {
  it('s’assoit par Sasseoir puis tient Assis ; se relève à l’envers avant de marcher', () => {
    const m = mixeur(DUREES)
    suivre(m, 'Assis')
    expect([m.courant, m.ensuite, m.pistes.get('Sasseoir')!.vitesse]).toEqual(['Sasseoir', 'Assis', 1])
    tourner(m, 0.4)
    expect(m.pistes.has('Repos')).toBe(false) // effacé en 0,3 s
    tourner(m, 1.2)
    expect(m.courant).toBe('Assis')
    suivre(m, 'Marche')
    expect([m.courant, m.ensuite, m.pistes.get('Sasseoir')!.t]).toEqual(['Sasseoir', 'Marche', 1.5])
    tourner(m, 1.9)
    expect(m.courant).toBe('Marche')
    expect(m.pistes.get('Marche')!.poids).toBe(1)
  })

  it('assis à moitié alors qu’il faut repartir : il finit de s’asseoir, puis se relève', () => {
    const m = mixeur(DUREES)
    suivre(m, 'Assis')
    tourner(m, 0.5)
    suivre(m, 'Marche')
    expect([m.courant, m.ensuite]).toEqual(['Sasseoir', 'Marche'])
    tourner(m, 1.1)
    expect([m.courant, m.ensuite, m.pistes.get('Sasseoir')!.vitesse]).toEqual(['Sasseoir', 'Marche', -1])
    tourner(m, 1.6)
    expect(m.courant).toBe('Marche')
  })

  it('un fondu croisé garde la somme des poids à 1, les boucles tournent', () => {
    const m = mixeur(DUREES)
    suivre(m, 'Marche')
    tourner(m, 0.2)
    const [a, b] = [m.pistes.get('Marche')!, m.pistes.get('Repos')!]
    expect(a.poids + b.poids).toBeCloseTo(1, 5)
    tourner(m, 2)
    expect(m.pistes.size).toBe(1)
    expect(a.t).toBeLessThan(DUREES.Marche)
  })

  it('asseoir(-1) part de la fin', () => {
    const m = mixeur(DUREES)
    asseoir(m, -1, 'Repos')
    expect(m.pistes.get('Sasseoir')!.t).toBe(1.5)
  })
})

describe('pente', () => {
  it('lève le museau en montant une volée, le baisse en descendant, rien à plat', () => {
    const f = MUSEE.flights[0]
    const yaw = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 }[f.direction]
    const w = { level: 0, surface: `volee:${f.id}`, x: 0, y: 0, z: 0, yaw }
    expect(pente(w)).toBeGreaterThan(0.3)
    expect(pente({ ...w, yaw: yaw + Math.PI })).toBeCloseTo(-pente(w), 6)
    expect(pente({ ...w, surface: '0:hall' })).toBe(0)
  })
})
