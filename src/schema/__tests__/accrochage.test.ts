import { describe, it, expect } from 'vitest'
// Les vraies données, importées telles qu'elles sont commitées : ce test
// échoue le jour où `npm run accrocher` produit un fichier que le schéma refuse.
import accrochageReel from '../../../public/data/accrochage.json'
import { SchemaError, accrochageSchema, parseAccrochage } from '../index'

function placementValide(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'phmatray/museum',
    x: 6.175,
    y: 1.55,
    z: 0.15,
    normal: [0, 1],
    width: 1,
    ...surcharge,
  }
}

function roomValide(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-o1',
    level: 0,
    name: 'Typescript / Tauri',
    placements: [placementValide()],
    ...surcharge,
  }
}

function accrochageValide(rooms: unknown[] = [roomValide()]): Record<string, unknown> {
  return {
    generatedAt: '2026-07-25T22:06:37.149Z',
    rooms,
  }
}

describe('données réelles', () => {
  it('accepte public/data/accrochage.json tel qu’il est généré', () => {
    const accrochage = parseAccrochage(accrochageReel)

    expect(accrochage.rooms).toHaveLength(accrochageReel.rooms.length)
    expect(accrochage.rooms.length).toBeGreaterThan(0)
  })
})

describe('accrochageSchema', () => {
  it('accepte un accrochage bien formé', () => {
    expect(accrochageSchema.safeParse(accrochageValide()).success).toBe(true)
  })

  it('accepte une salle sans placement — 0 toile reste valide', () => {
    expect(accrochageSchema.safeParse(accrochageValide([roomValide({ placements: [] })])).success).toBe(true)
  })

  it('refuse une salle dont les placements n’ont pas la forme attendue', () => {
    expect(accrochageSchema.safeParse({ rooms: [{ id: 'x' }] }).success).toBe(false)
  })
})

describe('parseAccrochage', () => {
  it('lève une SchemaError lisible quand un champ requis manque', () => {
    expect(() => parseAccrochage({ rooms: [{ id: 'x' }] })).toThrow(SchemaError)
    try {
      parseAccrochage({ rooms: [{ id: 'x' }] })
      expect.unreachable()
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(SchemaError)
      expect((erreur as SchemaError).message).toContain('generatedAt')
    }
  })
})
