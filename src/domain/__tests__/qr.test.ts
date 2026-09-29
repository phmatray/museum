/**
 * Les QR codes des cartels se scannent vraiment : un petit décodeur écrit ici,
 * indépendant de l'encodeur (norme ISO 18004, versions 1 à 6, niveau M, mode
 * octet, sans correction d'erreurs), relit l'atlas texel par texel et doit
 * retrouver l'adresse de chaque toile, dans l'ordre des cartels.
 */
import { describe, expect, it } from 'vitest'

import accrochage from '../../../public/data/accrochage.json'
import catalogue from '../../../public/data/catalogue.json'
import type { Artwork } from '../types.ts'
import { adresseQr, atlasQr, matriceQr, QR_MARGE, type AtlasQr } from '../qr.ts'
import { CARTEL_HAUTEUR, CARTEL_LARGEUR, CARTEL_QR, CARTEL_TEXTE, cartelPlacements } from '../../plan/cartels.ts'
import type { Accrochage } from '../../plan/hang.ts'

/** Niveau M : blocs × octets de données par bloc, versions 1 à 6. */
const BLOCS_M: Record<number, [number, number]> = { 1: [1, 16], 2: [1, 28], 3: [1, 44], 4: [2, 32], 5: [2, 43], 6: [4, 27] }
const ALIGNEMENT: Record<number, number> = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 }
const MASQUES: ((l: number, c: number) => boolean)[] = [
  (l, c) => (l + c) % 2 === 0,
  (l) => l % 2 === 0,
  (_, c) => c % 3 === 0,
  (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
  (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
  (l, c) => (((l * c) % 3) + ((l + c) % 2)) % 2 === 0,
]

/** Reste de la division polynomiale BCH(15,5) des informations de format. */
function bch(donnees: number): number {
  let r = donnees << 10
  for (let i = 14; i >= 10; i--) if (r & (1 << i)) r ^= 0x537 << (i - 10)
  return r
}

/** Le niveau de correction et le masque, lus dans la colonne 8 (copie verticale). */
function format(m: boolean[][]): { niveau: number; masque: number } {
  const n = m.length
  let mot = 0
  for (let i = 0; i < 15; i++) {
    const l = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i
    if (m[l][8]) mot |= 1 << i
  }
  mot ^= 0x5412
  const donnees = mot >> 10
  expect(bch(donnees), 'code BCH du format').toBe(mot & 0x3ff)
  return { niveau: donnees >> 3, masque: donnees & 7 }
}

function fonctionnel(l: number, c: number, n: number, version: number): boolean {
  if ((l < 9 && c < 9) || (l < 9 && c >= n - 8) || (l >= n - 8 && c < 9)) return true
  if (l === 6 || c === 6) return true
  const a = ALIGNEMENT[version]
  return a !== undefined && Math.abs(l - a) <= 2 && Math.abs(c - a) <= 2
}

/** Décode une matrice QR : vérifie le niveau M et rend le texte en mode octet. */
function decoder(m: boolean[][]): string {
  const n = m.length
  const version = (n - 17) / 4
  const { niveau, masque } = format(m)
  expect(niveau, 'niveau de correction M (00)').toBe(0)
  // Le zigzag : deux colonnes à la fois, de droite à gauche, en montant puis en descendant.
  const bits: number[] = []
  let monte = true
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--
    for (let k = 0; k < n; k++) {
      const l = monte ? n - 1 - k : k
      for (const cc of [c, c - 1]) {
        if (fonctionnel(l, cc, n, version)) continue
        bits.push(Number(m[l][cc] !== MASQUES[masque](l, cc)))
      }
    }
    monte = !monte
  }
  const octets = Array.from({ length: bits.length >> 3 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0))
  // Les données sont entrelacées bloc par bloc : on les remet à la suite.
  const [blocs, parBloc] = BLOCS_M[version]
  const donnees: number[] = []
  for (let b = 0; b < blocs; b++) for (let i = 0; i < parBloc; i++) donnees.push(octets[i * blocs + b])
  const flux = donnees.flatMap((o) => Array.from({ length: 8 }, (_, i) => (o >> (7 - i)) & 1))
  const lire = (debut: number, lg: number) => flux.slice(debut, debut + lg).reduce((a, b) => (a << 1) | b, 0)
  expect(lire(0, 4), 'mode octet').toBe(0b0100)
  const longueur = lire(4, 8)
  return new TextDecoder().decode(new Uint8Array(Array.from({ length: longueur }, (_, i) => lire(12 + 8 * i, 8))))
}

/** La case `i` de l'atlas, relue en matrice (rangées de texels comptées depuis le bas). */
function caseDe(atlas: AtlasQr, i: number): boolean[][] {
  const n = atlas.case - 2 * QR_MARGE
  const [x0, y0] = atlas.uv[i].map((u) => Math.round(u * atlas.cote))
  const sombre = (x: number, y: number) => atlas.pixels[(y * atlas.cote + x) * 4] < 128
  // La marge est blanche partout.
  for (let k = 0; k < atlas.case; k++)
    for (const [x, y] of [[k, 0], [k, atlas.case - 1], [0, k], [atlas.case - 1, k]]) expect(sombre(x0 + x, y0 + y)).toBe(false)
  return Array.from({ length: n }, (_, l) =>
    Array.from({ length: n }, (_, c) => sombre(x0 + QR_MARGE + c, y0 + atlas.case - 1 - QR_MARGE - l)))
}

const OEUVRES = new Map((catalogue.artworks as Artwork[]).map((a) => [a.key, a]))

describe('matriceQr', () => {
  it('se décode en l’adresse encodée, au niveau M', () => {
    for (const url of ['https://github.com/phmatray/museum', 'https://github.com/Atypical-Consulting/dotnet-clean-architecture'])
      expect(decoder(matriceQr(url))).toBe(url)
  })
})

describe('adresseQr', () => {
  const a = { key: 'phmatray/museum', url: 'https://github.com/phmatray/museum', site: 'https://phmatray.github.io/museum/' }
  it('mène au dépôt par défaut, au site ou au musée sur demande', () => {
    const cles = [a.key]
    expect(adresseQr(a)).toBe(a.url)
    expect(adresseQr(a, cles, 'site')).toBe(a.site)
    expect(adresseQr({ ...a, site: null }, cles, 'site')).toBe(a.url)
    expect(adresseQr(a, cles, 'musee')).toBe('https://phmatray.github.io/museum/p/museum/')
    // Deux dépôts du même nom : pas de page de partage, le musée directement.
    expect(adresseQr(a, [...cles, 'autre/museum'], 'musee')).toBe('https://phmatray.github.io/museum/?p=phmatray/museum')
  })
})

describe('atlasQr', () => {
  it('range dans la case i le code de la toile du cartel i', () => {
    const cartels = cartelPlacements(accrochage as Accrochage).filter((p) => OEUVRES.has(p.key))
    expect(cartels.length).toBeGreaterThan(100)
    const adresses = cartels.map((p) => adresseQr(OEUVRES.get(p.key)!))
    const atlas = atlasQr(adresses)
    expect(atlas.uv).toHaveLength(cartels.length)
    expect(atlas.colonnes ** 2).toBeGreaterThanOrEqual(cartels.length)
    cartels.forEach((p, i) => expect(decoder(caseDe(atlas, i)), p.key).toBe(OEUVRES.get(p.key)!.url))
  })
})

describe('le QR code sur la plaque', () => {
  it('tient dans la plaque, sans toucher le texte', () => {
    const d = CARTEL_QR.cote / 2
    expect(CARTEL_QR.x + d).toBeLessThan(CARTEL_LARGEUR / 2)
    expect(CARTEL_QR.x - d).toBeGreaterThan(-CARTEL_LARGEUR / 2)
    expect(Math.abs(CARTEL_QR.y) + d).toBeLessThan(CARTEL_HAUTEUR / 2)
    expect(CARTEL_TEXTE.x + CARTEL_TEXTE.largeur).toBeLessThan(CARTEL_QR.x - d)
    // Le texte garde la largeur d'avant le QR code (26 cm), à un centimètre près.
    expect(CARTEL_TEXTE.largeur).toBeGreaterThan(0.25)
  })
})
