import { describe, expect, it } from 'vitest'

import { cadrer, capturesFichier, estBadge, imagesDuReadme, resoudreImage, siteDuDepot } from '../captures'

describe('siteDuDepot', () => {
  it('préfère le homepage quand c’est une vraie URL', () => {
    expect(siteDuDepot('https://nuke.build', 'https://x.github.io/nuke/')).toBe('https://nuke.build/')
  })
  it('retombe sur GitHub Pages quand le homepage n’est pas un site', () => {
    expect(siteDuDepot('HomePage', 'https://phmatray.github.io/pokedex/')).toBe('https://phmatray.github.io/pokedex/')
    expect(siteDuDepot('https://github.com/phmatray/x', null)).toBeNull()
    expect(siteDuDepot('https://www.linkedin.com/pulse/abc', null)).toBeNull()
  })
  it('rien sans homepage ni Pages', () => {
    expect(siteDuDepot(null, undefined)).toBeNull()
    expect(siteDuDepot('', null)).toBeNull()
  })
})

describe('resoudreImage', () => {
  it('résout un chemin relatif contre la branche par défaut', () => {
    expect(resoudreImage('docs/shot.png', 'o', 'r')).toBe('https://raw.githubusercontent.com/o/r/HEAD/docs/shot.png')
    expect(resoudreImage('./screenshots/a.gif', 'o', 'r')).toBe('https://raw.githubusercontent.com/o/r/HEAD/screenshots/a.gif')
    expect(resoudreImage('/assets/a.png', 'o', 'r')).toBe('https://raw.githubusercontent.com/o/r/HEAD/assets/a.png')
  })
  it('convertit un lien blob GitHub en brut', () => {
    expect(resoudreImage('https://github.com/o/r/blob/main/img/a.png', 'x', 'y')).toBe(
      'https://raw.githubusercontent.com/o/r/main/img/a.png',
    )
  })
  it('garde une URL absolue et écarte ancres et data:', () => {
    expect(resoudreImage('https://example.com/a.png', 'o', 'r')).toBe('https://example.com/a.png')
    expect(resoudreImage('#top', 'o', 'r')).toBeNull()
    expect(resoudreImage('data:image/png;base64,AAA', 'o', 'r')).toBeNull()
  })
})

describe('estBadge', () => {
  it.each([
    'https://img.shields.io/badge/x-y-green',
    'https://github.com/o/r/actions/workflows/ci.yml/badge.svg',
    'https://codecov.io/gh/o/r/branch/main/graph/badge.svg',
    'https://travis-ci.org/o/r.svg',
    'https://raw.githubusercontent.com/o/r/HEAD/license.svg',
  ])('%s est un badge', (url) => expect(estBadge(url)).toBe(true))
  it('une capture n’en est pas un', () => {
    expect(estBadge('https://raw.githubusercontent.com/o/r/HEAD/docs/screenshot.png')).toBe(false)
  })
})

describe('imagesDuReadme', () => {
  const md = [
    '# Projet',
    '[![Build](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://github.com/o/r/actions)',
    '![NuGet](https://img.shields.io/nuget/v/X.svg)',
    '<img src="logo.png" width="64" alt="logo">',
    '```md',
    '![dans du code](ignored.png)',
    '```',
    '<p align="center"><img src="docs/hero.png" width="800"></p>',
    '![Démo](screenshots/demo.gif "titre")',
    '![Démo bis](screenshots/demo.gif)',
  ].join('\n')

  it('garde les vraies images, captures d’abord, sans badge ni picto ni doublon', () => {
    expect(imagesDuReadme(md, 'o', 'r')).toEqual([
      'https://raw.githubusercontent.com/o/r/HEAD/screenshots/demo.gif',
      'https://raw.githubusercontent.com/o/r/HEAD/docs/hero.png',
    ])
  })
  it('fait passer la capture devant la bannière qui ouvre le README', () => {
    const readme = '![lenia banner](.github/banner.png)\n\ntexte\n\n![Lenia Demo](docs/lenia.png)\n![vue](docs/vue.png)'
    expect(imagesDuReadme(readme, 'o', 'r')).toEqual([
      'https://raw.githubusercontent.com/o/r/HEAD/docs/lenia.png',
      'https://raw.githubusercontent.com/o/r/HEAD/docs/vue.png',
      'https://raw.githubusercontent.com/o/r/HEAD/.github/banner.png',
    ])
  })
  it('un README sans image n’en donne aucune', () => {
    expect(imagesDuReadme('# Rien\n\ndu texte', 'o', 'r')).toEqual([])
  })
})

describe('cadrer', () => {
  it('une page web 1280×800 est recadrée en 2:1, ancrée en haut', () => {
    expect(cadrer(1280, 800, 2, 'haut')).toEqual({ mode: 'recadrer', left: 0, top: 0, width: 1280, height: 640 })
  })
  it('centrée pour une image de README', () => {
    expect(cadrer(1280, 800, 2, 'centre')).toEqual({ mode: 'recadrer', left: 0, top: 80, width: 1280, height: 640 })
  })
  it('une image plus large que 2:1 est rognée sur les côtés', () => {
    expect(cadrer(1000, 400, 2, 'haut')).toEqual({ mode: 'recadrer', left: 100, top: 0, width: 800, height: 400 })
  })
  it('un logo carré ou une capture de téléphone est encadré, pas amputé', () => {
    expect(cadrer(512, 512, 2, 'centre')).toEqual({ mode: 'encadrer' })
    expect(cadrer(400, 900, 2, 'haut')).toEqual({ mode: 'encadrer' })
  })
})

describe('capturesFichier', () => {
  it('aplatit la clé', () => expect(capturesFichier('phmatray/CCross.ThrowIf')).toBe('captures/phmatray__CCross.ThrowIf.webp'))
})
