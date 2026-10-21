import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Artwork } from '../../domain/types'
import { cartelTexte } from '../../plan/cartels'
import type { Accrochage } from '../../plan/hang'
import { corpsQuiTient, droiteDe, largeurEm, repere, type Metriques } from '../msdf'

const lire = <T>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T
const police = (nom: string) => lire<Metriques>(`public/msdf/${nom}.json`)
const marcellus = police('marcellus')
const sans = police('source-sans-3')
const absents = (m: Metriques, texte: string) => {
  const ids = new Set(m.chars.map((c) => c.id))
  return [...new Set([...texte].filter((c) => c !== '\n' && !ids.has(c.codePointAt(0)!)))]
}

describe('atlas MSDF commités', () => {
  it('ont tous les caractères des noms de salle et des enseignes (Marcellus)', () => {
    const salles = lire<Accrochage>('public/data/accrochage.json').rooms.map((r) => r.name).join('')
    expect(absents(marcellus, `${salles}CINÉMA ↓ CONFISERIE SALLE 1 CABINE Réservé · 10 tampons À L’AFFICHE « Œuvre » d'été…`)).toEqual([])
  })

  it('ont tous les caractères des cartels du catalogue commité (Source Sans 3), étoile et fine insécable comprises', () => {
    const { artworks } = lire<{ artworks: Artwork[] }>('public/data/catalogue.json')
    const textes = artworks.map((a) => cartelTexte(a)).join('')
    expect(absents(sans, `${textes}★ 1 234 SORTIE`)).toEqual([])
  })

  it('mesurent en em : une espace de Marcellus vaut 0,3 em, un texte la somme de ses avances', () => {
    expect(largeurEm(marcellus, ' ')).toBeCloseTo(0.3, 2)
    expect(largeurEm(sans, 'AB')).toBeCloseTo(largeurEm(sans, 'A') + largeurEm(sans, 'B'))
    expect(corpsQuiTient(sans, 'SORTIE', 1, 0.1)).toBeCloseTo(0.1 / largeurEm(sans, 'SORTIE'))
  })
})

describe('repere', () => {
  it('met la droite et le haut à l’échelle du corps, la normale droite × haut, le centre en translation', () => {
    // Mur de normale +x : droite = (0, 0, −1).
    const m = repere([2, 3, 4], droiteDe(1, 0), [0, 1, 0], 0.5).m
    ;[0, 0, -0.5, 0, 0, 0.5, 0, 0, 1, 0, 0, 0, 2, 3, 4, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v))
  })
})
