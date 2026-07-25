// @vitest-environment node — le domaine ne touche jamais au DOM.
import { describe, it, expect } from 'vitest'
import { clusterArtworks, tokenizeName, vectorize, NOM_DIVERS } from '../clustering'
import brut from '../../../public/data/catalogue.json'
import type { Artwork, Catalogue } from '../types'

// ── Corpus réel ──────────────────────────────────────────────────────────
// 115 dépôts effectivement récupérés sur GitHub. Tout ce qui compte ici — le
// déséquilibre des topics, les descriptions bilingues, les dépôts sans aucun
// topic — n'existe que sur du vrai corpus.

const catalogue = brut as unknown as Catalogue
const REELS = catalogue.artworks
const OPTS = { minSize: 4, maxSize: 14 }

// ── Fabrique d'œuvres synthétiques ───────────────────────────────────────

let compteur = 0

function oeuvre(partiel: Partial<Artwork> = {}): Artwork {
  const nom = partiel.name ?? `repo-${String(compteur++).padStart(3, '0')}`
  return {
    key: `owner/${nom}`,
    owner: 'owner',
    name: nom,
    title: nom,
    description: '',
    url: `https://github.com/owner/${nom}`,
    homepage: null,
    topics: [],
    language: null,
    languages: {},
    stars: 0,
    forks: 0,
    openIssues: 0,
    isFork: false,
    isArchived: false,
    isTemplate: false,
    createdAt: '2024-01-01T00:00:00Z',
    pushedAt: '2024-01-01T00:00:00Z',
    license: null,
    readmeExcerpt: '',
    ...partiel,
  }
}

/** Toutes les clés retournées, tous clusters confondus. */
function toutesLesCles(clusters: { keys: string[] }[]): string[] {
  return clusters.flatMap((c) => c.keys).sort()
}

// ── Tokenisation ─────────────────────────────────────────────────────────

describe('tokenizeName', () => {
  it('découpe camelCase, kebab, snake et points', () => {
    expect(tokenizeName('MudBlazor.Extensions')).toEqual(['mud', 'blazor', 'extensions'])
    expect(tokenizeName('aspnet-htmx-mvc')).toEqual(['aspnet', 'htmx', 'mvc'])
    expect(tokenizeName('blazor_state_machine')).toEqual(['blazor', 'state', 'machine'])
    expect(tokenizeName('HTMLParser')).toEqual(['html', 'parser'])
  })

  it('écarte les tokens trop courts et les stop-words', () => {
    // `for` est un stop-word anglais, `of` fait deux caractères.
    expect(tokenizeName('tools-for-of-blazor')).toEqual(['tools', 'blazor'])
  })
})

// ── Vectorisation et IDF ─────────────────────────────────────────────────

describe('vectorisation sur le corpus réel', () => {
  const v = vectorize(REELS)

  it('mesure bien le déséquilibre du corpus', () => {
    expect(v.n).toBe(115)
    // Le problème que l'IDF doit régler, chiffré : `dotnet` est partout.
    expect(v.df.get('dotnet')! / v.n).toBeGreaterThan(0.5)
    expect(v.df.get('mudblazor')! / v.n).toBeLessThan(0.1)
  })

  it("écrase le poids d'un terme omniprésent face à un terme rare", () => {
    const idfDotnet = v.idf.get('dotnet')!
    const idfCsharp = v.idf.get('csharp')!
    const idfMudblazor = v.idf.get('mudblazor')!

    // Décroissance stricte de l'IDF avec la fréquence documentaire.
    expect(idfDotnet).toBeLessThan(idfCsharp)
    expect(idfCsharp).toBeLessThan(idfMudblazor)
    // Et l'écart n'est pas cosmétique : un ordre de grandeur.
    expect(idfMudblazor / idfDotnet).toBeGreaterThan(5)
  })

  it('ordonne l’IDF exactement à l’inverse du DF, sur tout le corpus', () => {
    const termes = [...v.df.keys()].sort()
    for (const a of termes) {
      for (const b of termes) {
        if (v.df.get(a)! < v.df.get(b)!) {
          expect(v.idf.get(a)!).toBeGreaterThanOrEqual(v.idf.get(b)!)
        }
      }
    }
  })

  it('laisse le terme rare dominer le vecteur du dépôt qui le porte', () => {
    // `phmatray/Phosphor` porte `dotnet` ET `mudblazor` en topic, à des tf très
    // proches : c'est l'IDF qui creuse l'écart final, pas le sac de termes.
    const i = v.keys.indexOf('phmatray/Phosphor')
    expect(i).toBeGreaterThanOrEqual(0)
    const rapportTf = v.tf[i].get('mudblazor')! / v.tf[i].get('dotnet')!
    expect(rapportTf).toBeLessThan(2)
    const vecteur = v.vectors[i]
    const rapportPoids = vecteur.get('mudblazor')! / vecteur.get('dotnet')!
    expect(rapportPoids).toBeGreaterThan(5 * rapportTf)
  })

  it('produit des vecteurs de norme 1', () => {
    for (const vecteur of v.vectors) {
      let carre = 0
      for (const p of vecteur.values()) carre += p * p
      expect(Math.sqrt(carre)).toBeCloseTo(1, 10)
    }
  })
})

// ── Déterminisme ─────────────────────────────────────────────────────────

describe('déterminisme', () => {
  it('rend deux fois exactement le même résultat', () => {
    const a = clusterArtworks(REELS, OPTS)
    const b = clusterArtworks(REELS, OPTS)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it("ne dépend pas de l'ordre du catalogue", () => {
    const attendu = JSON.stringify(clusterArtworks(REELS, OPTS))
    // Permutation déterministe (pas de Math.random) : inversion puis rotation.
    const permute = [...REELS].reverse()
    permute.push(...permute.splice(0, 37))
    expect(JSON.stringify(clusterArtworks(permute, OPTS))).toBe(attendu)
  })

  it('produit des identifiants et des noms uniques', () => {
    const clusters = clusterArtworks(REELS, OPTS)
    expect(new Set(clusters.map((c) => c.id)).size).toBe(clusters.length)
    expect(new Set(clusters.map((c) => c.name)).size).toBe(clusters.length)
  })
})

// ── Bornes et conservation ───────────────────────────────────────────────

describe('bornes de taille sur le corpus réel', () => {
  const clusters = clusterArtworks(REELS, OPTS)

  it('n’oublie ni ne duplique aucun dépôt', () => {
    expect(toutesLesCles(clusters)).toEqual(REELS.map((a) => a.key).sort())
  })

  it('respecte min et max, sauf pour la salle de repli', () => {
    for (const c of clusters) {
      if (c.name === NOM_DIVERS) continue
      expect(c.keys.length).toBeGreaterThanOrEqual(OPTS.minSize)
      expect(c.keys.length).toBeLessThanOrEqual(OPTS.maxSize)
    }
  })

  it('tient les bornes pour plusieurs jeux de contraintes', () => {
    for (const opts of [
      { minSize: 2, maxSize: 6 },
      { minSize: 3, maxSize: 10 },
      { minSize: 5, maxSize: 20 },
      { minSize: 1, maxSize: 115 },
    ]) {
      const obtenus = clusterArtworks(REELS, opts)
      expect(toutesLesCles(obtenus)).toEqual(REELS.map((a) => a.key).sort())
      for (const c of obtenus) {
        if (c.name === NOM_DIVERS) continue
        expect(c.keys.length).toBeGreaterThanOrEqual(opts.minSize)
        expect(c.keys.length).toBeLessThanOrEqual(opts.maxSize)
      }
    }
  })

  it('trie les clés de chaque cluster', () => {
    for (const c of clusters) expect(c.keys).toEqual([...c.keys].sort())
  })
})

// ── Pertinence thématique ────────────────────────────────────────────────

describe('pertinence', () => {
  it('ne nomme aucune salle avec le terme omniprésent du corpus', () => {
    // C'est la traduction visible de l'IDF : aucune « salle Dotnet ».
    const clusters = clusterArtworks(REELS, OPTS)
    for (const c of clusters) {
      expect(c.name).not.toMatch(/Dotnet/)
    }
  })

  it('réunit les familles de dépôts évidentes', () => {
    const clusters = clusterArtworks(REELS, OPTS)
    const salleDe = (cle: string): number => clusters.findIndex((c) => c.keys.includes(cle))
    for (const famille of [
      ['phmatray/lenia', 'phmatray/lenia-godot'],
      ['phmatray/Antlr4Library', 'phmatray/Antlr4Roslyn'],
      ['phmatray/blazor-state-experiments', 'Atypical-Consulting/blazor-state'],
      ['phmatray/BelgiumVatChecker', 'phmatray/VatBe'],
    ]) {
      const salles = famille.map(salleDe)
      expect(salles.every((s) => s >= 0)).toBe(true)
      expect(new Set(salles).size).toBe(1)
    }
  })
})

// ── Cas limites ──────────────────────────────────────────────────────────

describe('cas limites', () => {
  it('0 œuvre → aucun cluster', () => {
    expect(clusterArtworks([], OPTS)).toEqual([])
  })

  it('1 œuvre → un cluster unique qui la contient', () => {
    const a = oeuvre({ name: 'solo', topics: ['blazor'] })
    const clusters = clusterArtworks([a], OPTS)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].keys).toEqual([a.key])
    expect(clusters[0].name).not.toBe(NOM_DIVERS)
  })

  it('moins de minSize œuvres au total → un seul cluster, pas « Divers »', () => {
    const oeuvres = [
      oeuvre({ name: 'alpha', topics: ['rust'] }),
      oeuvre({ name: 'beta', topics: ['python'] }),
    ]
    const clusters = clusterArtworks(oeuvres, { minSize: 10, maxSize: 20 })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].keys).toHaveLength(2)
    expect(clusters[0].name).not.toBe(NOM_DIVERS)
  })

  it('toutes les œuvres identiques → aucun plantage, tout est réparti', () => {
    const oeuvres = Array.from({ length: 12 }, (_, i) => ({
      ...oeuvre({ name: 'jumeau', topics: ['blazor', 'dotnet'], description: 'un composant' }),
      key: `owner/jumeau-${i}`,
    }))
    const clusters = clusterArtworks(oeuvres, { minSize: 3, maxSize: 5 })
    expect(toutesLesCles(clusters)).toEqual(oeuvres.map((a) => a.key).sort())
    // Aucun terme ne distingue quoi que ce soit : tous les IDF sont nuls.
    expect(clusters.every((c) => c.topics.length === 0)).toBe(true)
    expect(JSON.stringify(clusterArtworks(oeuvres, { minSize: 3, maxSize: 5 }))).toBe(
      JSON.stringify(clusters),
    )
  })

  it('aucun topic, aucune description, aucun langage → clusters nommés par défaut', () => {
    const oeuvres = Array.from({ length: 9 }, () => oeuvre())
    const clusters = clusterArtworks(oeuvres, { minSize: 3, maxSize: 4 })
    expect(toutesLesCles(clusters)).toEqual(oeuvres.map((a) => a.key).sort())
    expect(new Set(clusters.map((c) => c.name)).size).toBe(clusters.length)
  })

  it('aucun topic nulle part → le nom du dépôt porte seul le regroupement', () => {
    const oeuvres = [
      oeuvre({ name: 'blazor-charts' }),
      oeuvre({ name: 'blazor-tables' }),
      oeuvre({ name: 'rust-parser' }),
      oeuvre({ name: 'rust-lexer' }),
    ]
    const clusters = clusterArtworks(oeuvres, { minSize: 2, maxSize: 2 })
    expect(clusters).toHaveLength(2)
    const salleDe = (nom: string): number =>
      clusters.findIndex((c) => c.keys.includes(`owner/${nom}`))
    expect(salleDe('blazor-charts')).toBe(salleDe('blazor-tables'))
    expect(salleDe('rust-parser')).toBe(salleDe('rust-lexer'))
    expect(salleDe('blazor-charts')).not.toBe(salleDe('rust-parser'))
  })

  it('un seul cluster possible → il est émis tel quel', () => {
    const oeuvres = Array.from({ length: 5 }, (_, i) =>
      oeuvre({ name: `jeu-${i}`, topics: ['game'] }),
    )
    const clusters = clusterArtworks(oeuvres, { minSize: 4, maxSize: 14 })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].keys).toHaveLength(5)
  })

  it('maxSize < minSize → maxSize est relevé à minSize, rien n’est perdu', () => {
    const oeuvres = Array.from({ length: 12 }, (_, i) =>
      oeuvre({ name: `mixte-${i}`, topics: [i % 3 === 0 ? 'web' : i % 3 === 1 ? 'cli' : 'game'] }),
    )
    // maxSize=2 est incohérent avec minSize=6 : relevé à 6, la seule taille
    // acceptable est exactement 6.
    const clusters = clusterArtworks(oeuvres, { minSize: 6, maxSize: 2 })
    expect(toutesLesCles(clusters)).toEqual(oeuvres.map((a) => a.key).sort())
    for (const c of clusters) {
      if (c.name === NOM_DIVERS) continue
      expect(c.keys.length).toBe(6)
    }
  })

  it('contrainte insoluble → tout part en « Divers » plutôt qu’en salles bancales', () => {
    // Deux familles de 5, minSize et maxSize tous deux à 6 : ni l'une ni
    // l'autre n'atteint le seuil, et leur fusion le dépasserait.
    const oeuvres = [
      ...Array.from({ length: 5 }, (_, i) => oeuvre({ name: `web-x-${i}`, topics: ['web'] })),
      ...Array.from({ length: 5 }, (_, i) => oeuvre({ name: `cli-x-${i}`, topics: ['cli'] })),
    ]
    const clusters = clusterArtworks(oeuvres, { minSize: 6, maxSize: 6 })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].name).toBe(NOM_DIVERS)
    expect(clusters[0].keys).toHaveLength(10)
  })

  it('deux fois la même clé → l’œuvre n’est accrochée qu’une fois', () => {
    const a = oeuvre({ name: 'double', topics: ['blazor'] })
    const clusters = clusterArtworks([a, { ...a }], OPTS)
    expect(toutesLesCles(clusters)).toEqual([a.key])
  })

  it('résidu non fusionnable → salle « Divers »', () => {
    // Deux familles saturées à maxSize, plus un intrus qui ne rentre nulle part.
    const oeuvres = [
      ...Array.from({ length: 3 }, (_, i) => oeuvre({ name: `web-${i}`, topics: ['web'] })),
      ...Array.from({ length: 3 }, (_, i) => oeuvre({ name: `cli-${i}`, topics: ['cli'] })),
      oeuvre({ name: 'orphelin', topics: ['orphelin'] }),
    ]
    const clusters = clusterArtworks(oeuvres, { minSize: 3, maxSize: 3 })
    expect(toutesLesCles(clusters)).toEqual(oeuvres.map((a) => a.key).sort())
    const divers = clusters.find((c) => c.name === NOM_DIVERS)
    expect(divers).toBeDefined()
    expect(divers!.keys).toEqual(['owner/orphelin'])
  })
})

// ── Inspection ───────────────────────────────────────────────────────────

describe('inspection du corpus réel', () => {
  it('imprime les salles obtenues', () => {
    const clusters = clusterArtworks(REELS, OPTS)
    const lignes = [
      `${REELS.length} dépôts → ${clusters.length} salles (min ${OPTS.minSize}, max ${OPTS.maxSize})`,
      '',
    ]
    for (const c of clusters) {
      lignes.push(`── ${c.name}  [${c.keys.length}]  #${c.id}`)
      lignes.push(`   topics : ${c.topics.join(', ') || '(aucun)'}`)
      for (const k of c.keys) lignes.push(`   · ${k}`)
      lignes.push('')
    }
    console.log(lignes.join('\n'))
    expect(clusters.length).toBeGreaterThan(1)
  })
})
