import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Catalogue } from '../../domain/types'
import { MUSEE } from '../musee'
import { borneRegardee, chapeau, choisirVitrines, enColonnes, OBSTACLES_BORNES, PANNEAU, readmeEnBlocs, SALLE, SALLE_VITRINES, VITRINES } from '../vitrines'

const catalogue = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8')) as Catalogue

describe('choisirVitrines', () => {
  it('prend les trois dépôts les plus étoilés DES propriétaires, jamais ceux d’un tiers', () => {
    const v = choisirVitrines(catalogue.artworks, catalogue.owners)
    expect(v).toHaveLength(3)
    for (const a of v) expect(catalogue.owners).toContain(a.owner)
    const miens = catalogue.artworks.filter((a) => catalogue.owners.includes(a.owner) && !a.isFork)
    const seuil = Math.min(...v.map((a) => a.stars))
    expect(miens.filter((a) => a.stars > seuil).every((a) => v.includes(a))).toBe(true)
  })
})

describe('readmeEnBlocs', () => {
  const md = [
    '# FormCraft 🎨',
    '[![NuGet](https://img.shields.io/nuget/v/x.svg)](https://nuget.org)',
    '## Table of Contents',
    '- [Why](#why)',
    '- [Install](#install)',
    '## Why FormCraft?',
    'Build **type-safe** forms with a [fluent API](https://x.y) and `Blazor`.',
    'Second line of the same paragraph.',
    '',
    '```csharp',
    'var f = new Form();',
    '```',
    '- Validation built in',
    '| a | b |',
    '> A quote.',
  ].join('\n')

  it('garde titres, paragraphes et puces, sans badges, code, tableaux ni sommaire', () => {
    expect(readmeEnBlocs(md)).toEqual([
      { type: 'titre', niveau: 1, texte: 'FormCraft' },
      { type: 'titre', niveau: 2, texte: 'Why FormCraft?' },
      { type: 'para', texte: 'Build type-safe forms with a fluent API and Blazor. Second line of the same paragraph.' },
      { type: 'puce', texte: 'Validation built in' },
      { type: 'para', texte: 'A quote.' },
    ])
  })

  it('borne la longueur, et le chapeau ne garde que les premiers paragraphes', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraphe ${i} ${'mot '.repeat(40)}`).join('\n\n')
    const blocs = readmeEnBlocs(long, 1000)
    expect(blocs.reduce((n, b) => n + b.texte.length, 0)).toBeLessThan(1300)
    expect(chapeau(blocs, 400).split('\n\n').length).toBeLessThanOrEqual(2)
  })
})

describe('readmeEnBlocs, suite', () => {
  it('recolle à sa puce la ligne indentée qui la continue', () => {
    expect(readmeEnBlocs('- **Typed** end to end. Fields are a\n  compile error, not a blank field.\n\nNext.')).toEqual([
      { type: 'puce', texte: 'Typed end to end. Fields are a compile error, not a blank field.' },
      { type: 'para', texte: 'Next.' },
    ])
  })

  it('le chapeau saute les rangées de liens et les annonces de code', () => {
    const blocs = readmeEnBlocs('Forms in a few lines of C#, rendered for you by FormCraft.\n\n[Live demo](x) · [Docs](y)\n\nExpected output:\n\nThe same form by hand runs to three times the lines.')
    expect(chapeau(blocs)).toBe('Forms in a few lines of C#, rendered for you by FormCraft.\n\nThe same form by hand runs to three times the lines.')
  })
})

describe('le mur des vitrines', () => {
  const niveau = MUSEE.levels.find((l) => l.rooms.some((r) => r.id === SALLE_VITRINES))!
  const salle = niveau.rooms.find((r) => r.id === SALLE_VITRINES)!

  it('reprend les cotes de la salle d’honneur du plan', () => {
    expect(SALLE).toEqual({ x0: salle.x, x1: salle.x + salle.width, z0: salle.z, z1: salle.z + salle.depth, sol: niveau.elevation })
  })

  it('aligne trois panneaux sur le mur nord, sans chevauchement, loin des angles', () => {
    expect(VITRINES.map((v) => v.rang)).toEqual([0, 1, 2])
    const bords = VITRINES.map((v) => [v.x - PANNEAU.largeur / 2, v.x + PANNEAU.largeur / 2])
    expect(bords[0][0]).toBeGreaterThan(salle.x + 1)
    expect(bords[2][1]).toBeLessThan(salle.x + salle.width - 1)
    for (let i = 1; i < bords.length; i++) expect(bords[i][0] - bords[i - 1][1]).toBeGreaterThanOrEqual(0.3 - 1e-9)
    // Sous le haut des murs : la gorge de la voûte naît au-dessus.
    expect(SALLE.sol + PANNEAU.hauteur).toBeLessThan(niveau.elevation + MUSEE.storey - MUSEE.slab)
  })

  it('pose les bornes en obstacles de l’étage, loin du passage entre les deux portes', () => {
    for (const o of OBSTACLES_BORNES) {
      expect(niveau.obstacles).toContainEqual(o)
      expect(o.z + o.depth).toBeLessThan(5 - 0.3)
      expect(o.x).toBeGreaterThan(salle.x + 0.6)
      expect(o.x + o.width).toBeLessThan(salle.x + salle.width - 0.6)
    }
  })
})

describe('borneRegardee', () => {
  const b = VITRINES[1].borne
  const devant = { x: b.x, y: 4.8, z: b.z + 1.5, yaw: 0 }

  it('reconnaît la borne qu’on regarde, de face et à portée', () => {
    expect(borneRegardee(devant)).toBe(1)
    expect(borneRegardee({ ...devant, x: b.x + 0.6 })).toBe(1)
  })

  it('ignore une borne trop loin, de dos, hors du regard ou à un autre étage', () => {
    expect(borneRegardee({ ...devant, z: b.z + 3 })).toBeNull()
    expect(borneRegardee({ ...devant, z: b.z - 1, yaw: Math.PI })).toBeNull()
    expect(borneRegardee({ ...devant, yaw: Math.PI / 2 })).toBeNull()
    expect(borneRegardee({ ...devant, y: 0 })).toBeNull()
  })
})

describe('enColonnes', () => {
  it('garde un texte court dans la première colonne', () => {
    expect(enColonnes('Un texte court.', 30, 10)).toEqual(['Un texte court.', ''])
  })

  it('remplit deux colonnes, garde les paragraphes et coupe au dernier mot', () => {
    const texte = Array.from({ length: 12 }, (_, i) => `Paragraphe ${i} ${'mot '.repeat(30)}fin.`).join('\n\n')
    const [a, b] = enColonnes(texte, 30, 12)
    expect(a.startsWith('Paragraphe 0')).toBe(true)
    expect(a).toContain('\n\n')
    expect(b.startsWith('\n')).toBe(false)
    expect(b.endsWith('…')).toBe(true)
    // 24 lignes de 30 signes au plus, espaces compris.
    expect(a.length + b.length).toBeLessThan(24 * 31)
  })
})
