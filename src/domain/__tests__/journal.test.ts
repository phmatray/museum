/**
 * Le journal de chantier lu comme des données, sur le VRAI `docs/journal/index.html` :
 * autant d'étapes que de sections, dans l'ordre du chantier. Le build le
 * relit à chaque fois (`node tools/chantier.ts`) : le chantier.json publié suit
 * le journal publié.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { lireJournal, texte } from '../journal.ts'

// La racine du dépôt : vitest y tourne (jsdom n'a pas d'URL `file:` pour `import.meta.url`).
const HTML = readFileSync(resolve('docs/journal/index.html'), 'utf8')
const journal = lireJournal(HTML)

describe('lireJournal', () => {
  it('lit une étape par section, de la première à la dernière', () => {
    expect(journal.etapes).toHaveLength((HTML.match(/<section class="etape\b/g) ?? []).length)
    expect(journal.etapes[0]).toMatchObject({ n: 0, ancre: 't-0', titre: 'Avant' })
    const numeros = journal.etapes.map((e) => e.n).filter((n): n is number => n !== null)
    expect(Math.max(...numeros)).toBe(journal.etapes.findLast((e) => e.n !== null)!.n)
  })

  it('garde l’ancre, la catégorie, le statut, la PR et la première image de chaque étape', () => {
    const ancres = new Set(journal.etapes.map((e) => e.ancre))
    expect(ancres.size).toBe(journal.etapes.length)
    for (const e of journal.etapes) {
      expect(HTML).toContain(`id="${e.ancre}"`)
      expect(Object.keys(journal.categories)).toContain(e.categorie)
      if (e.pr !== null) expect(e.statut).toContain(`PR #${e.pr}`)
      if (e.image) {
        expect(existsSync(resolve('docs/journal', e.image.src)), e.image.src).toBe(true)
        expect(e.image.largeur).toBeGreaterThan(0)
      }
    }
    expect(journal.categories.jardin).toBe('Jardin & dehors')
    // Une étape hors série garde son titre entier.
    expect(journal.etapes.find((e) => e.ancre === 't-11')).toMatchObject({ n: null, titre: 'Correctif : l’entrée dégagée', pr: 77 })
  })

  it('décode les entités et resserre les espaces', () => {
    expect(texte('Pistes &amp; idées <span>\n  en  cours</span> &#8217;&#x2019;')).toBe('Pistes & idées en cours ’’')
  })
})
