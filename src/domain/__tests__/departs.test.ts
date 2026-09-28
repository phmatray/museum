import { describe, expect, it } from 'vitest'

import { depuis, dureeVolets, lignesDeDeparts, ligneEnPalettes, palettes, voletsA } from '../departs'
import type { Artwork } from '../types'

const maintenant = new Date('2026-09-28T18:00:00Z')

describe('depuis', () => {
  it('dit le temps écoulé en sept palettes au plus', () => {
    const il_y_a = (min: number) => depuis(new Date(maintenant.getTime() - min * 60000), maintenant)
    expect(il_y_a(5)).toBe('5 MIN')
    expect(il_y_a(150)).toBe('2 H')
    expect(il_y_a(26 * 60)).toBe('HIER')
    expect(il_y_a(3 * 24 * 60)).toBe('3 J')
    expect(depuis(new Date(2026, 7, 12), maintenant)).toBe('12/08')
    for (const m of [0, 5, 150, 26 * 60, 3 * 24 * 60, 60 * 24 * 60]) expect(il_y_a(m).length).toBeLessThanOrEqual(7)
  })
})

describe('palettes', () => {
  it('met en majuscules sans accents et blanchit ce que le tambour ne porte pas', () => {
    expect(palettes('Musique & audio', 17)).toBe('MUSIQUE   AUDIO  ')
    expect(palettes('clean_architecture', 5)).toBe('CLEAN')
  })
})

describe('lignesDeDeparts', () => {
  const oeuvre = (key: string, pushedAt: string, language: string | null): Artwork =>
    ({ key, name: key.split('/')[1], pushedAt, language }) as Artwork
  it('range les dépôts exposés du plus récent au plus ancien, avec leur salle', () => {
    const lignes = lignesDeDeparts(
      [oeuvre('a/ancien', '2026-09-01T00:00:00Z', 'C#'), oeuvre('a/recent', '2026-09-28T17:00:00Z', null), oeuvre('a/reserve', '2026-09-28T17:59:00Z', 'Go')],
      new Map([['a/ancien', 'Blazor'], ['a/recent', 'Jeux']]),
      maintenant,
      5,
    )
    // `a/reserve` n'est accroché nulle part : pas de train pour une salle qui n'existe pas.
    expect(lignes.map((l) => l.destination)).toEqual(['recent', 'ancien'])
    expect(lignes[0]).toEqual({ depuis: '1 H', destination: 'recent', langage: '', salle: 'Jeux' })
    expect(ligneEnPalettes(lignes[0])).toHaveLength(7 + 24 + 11 + 20 + 3)
  })
})

describe('voletsA', () => {
  it('fait défiler chaque palette dans l’ordre du tambour jusqu’à sa cible, en vague', () => {
    expect(voletsA('AAA', 'ACB', 0)).toBe('AAA')
    // Au premier cran, seule la première colonne est partie : A → B, pas encore C.
    expect(voletsA('AAA', 'ACB', 55)).toBe('AAA')
    expect(voletsA('A  ', 'B  ', 55)).toBe('B  ')
    expect(voletsA('AAA', 'ACB', dureeVolets(3))).toBe('ACB')
  })
})
