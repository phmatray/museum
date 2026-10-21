import { describe, expect, it } from 'vitest'

import { CARNET_VIDE, SUCCES, jourDe, saisonDe, noter, relire, tamponner, type Fait } from '../succes'

const CTX = { salles: 14, oeuvres: 3 }
const suite = (...faits: Fait[]) => faits.reduce(noter, CARNET_VIDE)

describe('carnet de tampons', () => {
  it('chaque tampon a un identifiant unique, un titre et un indice', () => {
    expect(new Set(SUCCES.map((s) => s.id)).size).toBe(SUCCES.length)
    for (const s of SUCCES) expect(s.titre && s.texte && s.indice).toBeTruthy()
  })

  it('un fait déjà noté ne change rien (même objet)', () => {
    const c = suite({ type: 'salle', id: 'hall' })
    expect(noter(c, { type: 'salle', id: 'hall' })).toBe(c)
  })

  it('composter frappe le premier tampon, une seule fois, à la date donnée', () => {
    const { carnet, nouveaux } = tamponner(suite({ type: 'geste', id: 'composte' }), CTX, '2026-10-20')
    expect(nouveaux.map((s) => s.id)).toEqual(['composte'])
    expect(carnet.tampons.composte).toBe('2026-10-20')
    expect(tamponner(carnet, CTX, '2026-10-21').nouveaux).toEqual([])
  })

  it('les paliers : cinq salles, toutes les salles, toutes les œuvres du contexte', () => {
    const salles = Array.from({ length: 14 }, (_, i) => ({ type: 'salle', id: `s${i}` }) as const)
    expect(tamponner(suite(...salles.slice(0, 4)), CTX, 'j').nouveaux).toEqual([])
    expect(tamponner(suite(...salles.slice(0, 5)), CTX, 'j').nouveaux.map((s) => s.id)).toEqual(['flaneur'])
    expect(tamponner(suite(...salles), CTX, 'j').nouveaux.map((s) => s.id)).toEqual(['flaneur', 'arpenteur'])
    const oeuvres = suite(...['a', 'b', 'c'].map((cle) => ({ type: 'oeuvre', cle }) as const))
    expect(tamponner(oeuvres, CTX, 'j').nouveaux.map((s) => s.id)).toEqual(['exhaustif'])
  })

  it('sans contexte (catalogue absent), « tout voir » ne se mérite pas par défaut', () => {
    expect(tamponner(CARNET_VIDE, { salles: 0, oeuvres: 0 }, 'j').nouveaux).toEqual([])
  })

  it('jours et saisons : trois jours font un habitué, quatre saisons le tour de l’année', () => {
    const c = suite(
      { type: 'jour', date: '2026-01-02', saison: 'hiver' },
      { type: 'jour', date: '2026-04-02', saison: 'printemps' },
      { type: 'jour', date: '2026-07-02', saison: 'ete' },
      { type: 'jour', date: '2026-10-02', saison: 'automne' },
    )
    expect(tamponner(c, CTX, 'j').nouveaux.map((s) => s.id)).toEqual(['fidele', 'saisons'])
  })

  it('un carnet stocké abîmé repart vide sans planter', () => {
    expect(relire(null)).toEqual(CARNET_VIDE)
    expect(relire('n’importe quoi')).toEqual(CARNET_VIDE)
    const r = relire({ salles: ['hall', 3], tampons: { composte: '2026-10-20', faux: 1 } })
    expect(r.salles).toEqual(['hall'])
    expect(r.tampons).toEqual({ composte: '2026-10-20' })
  })

  it('jourDe : la date locale, zéros compris', () => {
    expect(jourDe(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })

  it('saisonDe : décembre est l’hiver, mars le printemps, août l’été, novembre l’automne', () => {
    expect([11, 2, 7, 10].map((m) => saisonDe(new Date(2026, m, 15)))).toEqual(['hiver', 'printemps', 'ete', 'automne'])
  })
})
