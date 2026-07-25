/**
 * LOT 3 — Tests de la découpe de l'atlas (spec §9.1).
 *
 * Rien ici ne touche à WebGL : `sliceAtlas` est de l'arithmétique sur un tampon
 * d'octets, et c'est précisément pour qu'elle soit vérifiable sans canvas
 * qu'elle est séparée du chargement.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. LE RETOURNEMENT VERTICAL. `DataArrayTexture` n'applique pas
 *     `UNPACK_FLIP_Y_WEBGL` ; sans retournement à la construction, TOUTES les
 *     toiles du musée sont accrochées à l'envers. Le spike du lot 0 a produit
 *     exactement ce défaut avant correction, et rien dans le rendu ne le
 *     signale — il faut le regarder pour le voir. D'où un test sur des données
 *     synthétiques dont la première ligne diffère de la dernière.
 *  2. L'ORDRE DES COUCHES. La couche `L` doit être la tuile que `atlas.json`
 *     désigne. Une convention ligne/colonne inversée donnerait cent œuvres
 *     correctes mais toutes attribuées au mauvais dépôt.
 *  3. LE REFUS D'UN ATLAS DÉCALÉ. Un atlas régénéré avec une autre taille de
 *     tuile doit lever, pas décaler silencieusement chaque image d'un demi-cadre.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AtlasIndex } from '../../domain/types'
import {
  atlasLayerCount,
  nearTextureUrl,
  resolveAtlasNumber,
  sliceAtlas,
} from '../arrayTexture'

// ── Corpus ───────────────────────────────────────────────────────────────

// `import.meta.url` n'est pas un chemin de fichier sous jsdom : on part de la
// racine du projet, qui est le répertoire de travail de vitest.
const CHEMIN_REEL = resolve(process.cwd(), 'public/media/atlas.json')
const indexReel = JSON.parse(readFileSync(CHEMIN_REEL, 'utf8')) as AtlasIndex

/**
 * Un index synthétique de même FORME que le vrai — 16 colonnes, tuiles deux
 * fois plus larges que hautes — mais assez petit pour que le test manipule
 * quelques kilo-octets au lieu de trente méga-octets. Toute la logique testée
 * est de l'indexation : elle ne dépend pas de la taille des tuiles.
 */
function indexJouet(overrides: Partial<AtlasIndex> = {}): AtlasIndex {
  return {
    schemaVersion: 1,
    tileWidth: 4,
    tileHeight: 2,
    cols: 16,
    rows: 16,
    atlases: ['media/atlas-0.webp'],
    entries: {},
    ...overrides,
  }
}

/**
 * Un atlas dont chaque pixel encode SA PROVENANCE : le rouge porte le numéro de
 * la tuile, le vert la ligne DANS la tuile, comptée depuis le haut. Deux
 * questions — « quelle tuile ? » et « quelle ligne ? » — répondues par la
 * lecture d'un seul pixel.
 */
function atlasTemoin(index: AtlasIndex): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const width = index.cols * index.tileWidth
  const height = index.rows * index.tileHeight
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tuile = Math.floor(y / index.tileHeight) * index.cols + Math.floor(x / index.tileWidth)
      const ligne = y % index.tileHeight
      const p = (y * width + x) * 4
      data[p] = tuile % 256
      data[p + 1] = ligne
      data[p + 2] = x % index.tileWidth
      data[p + 3] = 255
    }
  }

  return { data, width, height }
}

/** Le pixel `(x, y)` de la couche `layer` du tampon découpé. */
function pixel(
  out: Uint8Array,
  index: AtlasIndex,
  layer: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const p = (layer * index.tileWidth * index.tileHeight + y * index.tileWidth + x) * 4
  return [out[p], out[p + 1], out[p + 2], out[p + 3]]
}

// ── Retournement vertical ────────────────────────────────────────────────

describe('sliceAtlas — retournement vertical', () => {
  it('met la DERNIÈRE ligne source en première ligne de couche', () => {
    const index = indexJouet()
    const source = atlasTemoin(index)
    const out = sliceAtlas(source, index, 4)

    // Le témoin distingue les lignes : la première ligne d'une tuile porte 0,
    // la dernière porte tileHeight − 1. Sans retournement, ces deux assertions
    // seraient exactement inversées.
    expect(pixel(out, index, 0, 0, 0)[1]).toBe(index.tileHeight - 1)
    expect(pixel(out, index, 0, 0, index.tileHeight - 1)[1]).toBe(0)
  })

  it('retourne CHAQUE couche, pas seulement la première', () => {
    const index = indexJouet({ tileHeight: 8 })
    const source = atlasTemoin(index)
    const out = sliceAtlas(source, index, 40)

    for (const layer of [0, 1, 15, 16, 39]) {
      for (let y = 0; y < index.tileHeight; y++) {
        expect(pixel(out, index, layer, 0, y)[1]).toBe(index.tileHeight - 1 - y)
      }
    }
  })

  it('détecterait un tampon non retourné : première et dernière ligne diffèrent', () => {
    // Garde-fou du test lui-même. Si le témoin devenait uniforme sur la
    // verticale, les deux assertions ci-dessus passeraient sans rien prouver.
    const index = indexJouet()
    const source = atlasTemoin(index)
    const premiere = source.data[1]
    const derniere = source.data[((index.tileHeight - 1) * source.width) * 4 + 1]
    expect(premiere).not.toBe(derniere)
  })

  it('ne mélange pas les colonnes en retournant les lignes', () => {
    const index = indexJouet()
    const out = sliceAtlas(atlasTemoin(index), index, 8)
    for (let x = 0; x < index.tileWidth; x++) {
      expect(pixel(out, index, 3, x, 0)[2]).toBe(x)
    }
  })
})

// ── Ordre des couches ────────────────────────────────────────────────────

describe('sliceAtlas — ordre des couches', () => {
  it('la couche L est la tuile (L % cols, ⌊L / cols⌋)', () => {
    const index = indexJouet()
    const out = sliceAtlas(atlasTemoin(index), index, 100)
    for (const layer of [0, 1, 15, 16, 17, 99]) {
      expect(pixel(out, index, layer, 0, 0)[0]).toBe(layer % 256)
    }
  })

  it("produit exactement `layerCount` couches et rien de plus", () => {
    const index = indexJouet()
    const out = sliceAtlas(atlasTemoin(index), index, 7)
    expect(out.length).toBe(7 * index.tileWidth * index.tileHeight * 4)
  })

  it('donne à chaque dépôt de atlas.json la tuile que son index annonce', () => {
    // Le vrai index, la vraie grille, mais un atlas témoin : c'est bien le
    // raccordement `entries[clé].layer → tuile` qui est vérifié.
    const index: AtlasIndex = { ...indexReel, tileWidth: 4, tileHeight: 2 }
    const layerCount = atlasLayerCount(index, 0)
    const out = sliceAtlas(atlasTemoin(index), index, layerCount)

    for (const [key, entree] of Object.entries(indexReel.entries)) {
      if (entree.atlas !== 0) continue
      const attendu = entree.layer % 256
      expect(pixel(out, index, entree.layer, 0, 0)[0], key).toBe(attendu)
    }
  })
})

// ── Le vrai index ────────────────────────────────────────────────────────

describe('atlas.json réel', () => {
  it('décrit une grille cohérente avec les tuiles annoncées', () => {
    expect(indexReel.cols).toBeGreaterThan(0)
    expect(indexReel.rows).toBeGreaterThan(0)
    expect(indexReel.tileWidth).toBeGreaterThan(0)
    expect(indexReel.tileHeight).toBeGreaterThan(0)
    expect(indexReel.atlases.length).toBeGreaterThan(0)
  })

  it("n'attribue jamais deux dépôts à la même couche du même atlas", () => {
    const vues = new Set<string>()
    for (const [key, entree] of Object.entries(indexReel.entries)) {
      const place = `${entree.atlas}:${entree.layer}`
      expect(vues.has(place), `${key} partage la couche ${place}`).toBe(false)
      vues.add(place)
    }
  })

  it('tient chaque couche dans la grille de son atlas', () => {
    const capacite = indexReel.cols * indexReel.rows
    for (const [key, entree] of Object.entries(indexReel.entries)) {
      expect(entree.layer, key).toBeGreaterThanOrEqual(0)
      expect(entree.layer, key).toBeLessThan(capacite)
      expect(entree.atlas, key).toBeLessThan(indexReel.atlases.length)
    }
  })

  it("n'alloue que les couches réellement utilisées", () => {
    // Le point du §9 : allouer les 256 emplacements coûterait 32 Mo de VRAM
    // dont la moitié en noir. Le compte doit suivre le corpus, pas la grille.
    const total = Object.values(indexReel.entries).filter((e) => e.atlas === 0).length
    expect(atlasLayerCount(indexReel, 0)).toBe(total)
    expect(atlasLayerCount(indexReel, 0)).toBeLessThanOrEqual(indexReel.cols * indexReel.rows)
  })

  it('renvoie zéro couche pour un atlas que personne ne référence', () => {
    expect(atlasLayerCount(indexReel, 99)).toBe(0)
  })
})

// ── Refus ────────────────────────────────────────────────────────────────

describe('sliceAtlas — refus', () => {
  it("refuse un atlas dont les dimensions ne sont pas celles de l'index", () => {
    const index = indexJouet()
    const source = atlasTemoin(index)
    expect(() => sliceAtlas({ ...source, width: source.width + 4 }, index, 1)).toThrow(RangeError)
    expect(() => sliceAtlas({ ...source, height: source.height - 2 }, index, 1)).toThrow(RangeError)
  })

  it('refuse plus de couches que la grille ne contient de tuiles', () => {
    const index = indexJouet()
    expect(() => sliceAtlas(atlasTemoin(index), index, index.cols * index.rows + 1)).toThrow(
      RangeError,
    )
  })

  it('refuse un tampon trop court pour les dimensions annoncées', () => {
    const index = indexJouet()
    const source = atlasTemoin(index)
    expect(() =>
      sliceAtlas({ ...source, data: source.data.slice(0, 16) }, index, 1),
    ).toThrow(RangeError)
  })
})

// ── Raccordements ────────────────────────────────────────────────────────

describe('resolveAtlasNumber', () => {
  it("retrouve le numéro d'un atlas depuis une URL préfixée par la base du site", () => {
    expect(resolveAtlasNumber('/musee/media/atlas-0.webp', indexReel)).toBe(0)
  })

  it('retombe sur 0 pour une URL inconnue plutôt que de lever', () => {
    expect(resolveAtlasNumber('/ailleurs/atlas-7.webp', indexReel)).toBe(0)
  })

  it('distingue plusieurs atlas', () => {
    const index = indexJouet({ atlases: ['media/atlas-0.webp', 'media/atlas-1.webp'] })
    expect(resolveAtlasNumber('/base/media/atlas-1.webp', index)).toBe(1)
  })
})

describe('nearTextureUrl', () => {
  it("remplace la barre oblique de la clé, sans quoi le fichier n'existe pas", () => {
    expect(nearTextureUrl('phmatray/RecordEquality', '/')).toBe(
      '/media/near/phmatray__RecordEquality.webp',
    )
  })

  it('respecte la base du site', () => {
    expect(nearTextureUrl('a/b', '/musee/')).toBe('/musee/media/near/a__b.webp')
  })
})
