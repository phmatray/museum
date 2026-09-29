/**
 * Les QR codes des cartels : un téléphone qui scanne le cartel d'une toile
 * (musée montré sur grand écran, en conférence, sur un stand) ouvre le projet.
 *
 * L'encodeur est `qrcode-generator` (MIT, sans dépendance) : un encodeur QR
 * correct — Reed-Solomon, masques, informations de format — n'est pas une
 * affaire de trois lignes. Tout ici est pur, testé par un vrai décodage
 * (`__tests__/qr.test.ts`) : le dessin ne fait que poser l'atlas.
 */
import qrcode from 'qrcode-generator'

import type { Artwork } from './types.ts'

/**
 * Où mène le QR code, décidé ICI et nulle part ailleurs :
 * - `depot` : la page GitHub, toujours valide, ce qu'un développeur veut ;
 * - `site` : le site du projet s'il en a un, sinon le dépôt ;
 * - `musee` : le musée publié, devant cette toile (`?p=`, le lien de partage).
 */
export const CIBLE_QR: 'depot' | 'site' | 'musee' = 'depot'
const MUSEE_EN_LIGNE = 'https://phmatray.github.io/museum/'

export function adresseQr(a: Pick<Artwork, 'key' | 'url' | 'site'>, cible: typeof CIBLE_QR = CIBLE_QR): string {
  if (cible === 'site') return a.site || a.url
  if (cible === 'musee') return `${MUSEE_EN_LIGNE}?p=${encodeURIComponent(a.key)}`
  return a.url
}

/** La marge blanche exigée par la norme autour du code : quatre modules. */
export const QR_MARGE = 4

/**
 * La matrice d'un texte, niveau de correction M (15 % de modules perdus sans
 * dommage — un reflet, une arête de cadre). `version` 0 : la plus petite qui tient.
 * Vrai = module sombre ; `m[ligne][colonne]`, ligne 0 en haut.
 */
export function matriceQr(texte: string, version = 0): boolean[][] {
  const qr = qrcode(version as Parameters<typeof qrcode>[0], 'M')
  qr.addData(texte, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => qr.isDark(l, c)))
}

export interface AtlasQr {
  /** Côté d'une case en texels : les modules du code, marges comprises, un texel chacun. */
  case: number
  /** Cases par côté de l'atlas (carré). */
  colonnes: number
  /** Côté de l'atlas en texels. */
  cote: number
  /** RGBA, rangée 0 EN BAS (convention des `DataTexture` de three). */
  pixels: Uint8Array
  /** Coin bas-gauche de la case `i`, en UV. La case `i` est le code de `adresses[i]`. */
  uv: [number, number][]
}

/** Clair et sombre des codes : un blanc cassé qui rejoint la plaque, un noir d'encre. */
const CLAIR = [244, 241, 234]
const SOMBRE = [22, 20, 18]

/**
 * Tous les codes dans un seul atlas, pour un seul lot d'instances. Une même
 * version pour tous (celle de l'adresse la plus longue) : des cases de même
 * taille, un module = un texel, net au filtre « nearest ».
 */
export function atlasQr(adresses: string[]): AtlasQr {
  const version = Math.max(1, ...adresses.map((a) => (matriceQr(a).length - 17) / 4))
  const matrices = adresses.map((a) => matriceQr(a, version))
  const n = 17 + 4 * version
  const taille = n + 2 * QR_MARGE
  const colonnes = Math.max(1, Math.ceil(Math.sqrt(adresses.length)))
  const cote = taille * colonnes
  const pixels = new Uint8Array(cote * cote * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...CLAIR, 255], i)
  const uv: [number, number][] = []
  matrices.forEach((m, i) => {
    const [cx, cy] = [i % colonnes, Math.floor(i / colonnes)]
    // La case `cy` compte depuis le haut ; les rangées de texels, depuis le bas.
    const bas = cote - (cy + 1) * taille
    uv.push([(cx * taille) / cote, bas / cote])
    for (let l = 0; l < n; l++)
      for (let c = 0; c < n; c++) {
        if (!m[l][c]) continue
        const x = cx * taille + QR_MARGE + c
        const y = bas + taille - 1 - QR_MARGE - l
        pixels.set(SOMBRE, (y * cote + x) * 4)
      }
  })
  return { case: taille, colonnes, cote, pixels, uv }
}
