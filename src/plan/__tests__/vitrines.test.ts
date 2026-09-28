import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Catalogue } from '../../domain/types'
import { chapeau, choisirVitrines, readmeEnBlocs } from '../vitrines'

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
