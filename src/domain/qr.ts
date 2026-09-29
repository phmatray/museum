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

import { lienVers } from './lien.ts'
import type { Artwork } from './types.ts'

/**
 * Où mène le QR code, décidé ICI et nulle part ailleurs :
 * - `depot` : la page GitHub, toujours valide, ce qu'un développeur veut ;
 * - `site` : le site du projet s'il en a un, sinon le dépôt ;
 * - `musee` : la page de partage du projet sur le musée publié (`p/<repo>/`,
 *   `domain/lien.ts`), qui porte son aperçu et ouvre le musée devant la toile.
 * Le dépôt par défaut : sur un téléphone, une page GitHub s'ouvre tout de
 * suite, là où le musée en 3D demande un bon réseau et une bonne machine.
 * `cles` (toutes les clés exposées) ne sert qu'à `musee`, pour les homonymes.
 */
export const CIBLE_QR: 'depot' | 'site' | 'musee' = 'depot'
/** Le musée publié, même depuis une copie locale : c'est lui que le téléphone doit ouvrir. */
const MUSEE_EN_LIGNE = 'https://phmatray.github.io/museum/'

export function adresseQr(a: Pick<Artwork, 'key' | 'url' | 'site'>, cles: readonly string[] = [a.key], cible: typeof CIBLE_QR = CIBLE_QR): string {
  if (cible === 'site') return a.site || a.url
  if (cible === 'musee') return lienVers(a.key, cles, MUSEE_EN_LIGNE, true)
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
  /** Coin bas-gauche du code `i` (marges comprises), en UV. Le code `i` est celui de `adresses[i]`. */
  uv: [number, number][]
  /** Côté du code `i` en texels, marges comprises (≤ `case`). */
  tailles: number[]
}

/** Blanc pur, noir pur : le contraste maximal, celui qu'un téléphone lit le mieux sur un écran. */
const CLAIR = [255, 255, 255]
const SOMBRE = [0, 0, 0]

/**
 * Tous les codes dans un seul atlas, pour un seul lot d'instances. Chaque code
 * garde SA version, la plus petite qui tient : sur une plaque de taille fixe,
 * moins de modules, ce sont des modules plus gros à l'écran. Des cases de même
 * taille (celle du plus grand code), chaque code calé dans le coin haut-gauche
 * de la sienne ; un module = un texel, net au filtre « nearest ».
 */
export function atlasQr(adresses: string[]): AtlasQr {
  const matrices = adresses.map((a) => matriceQr(a))
  const taille = Math.max(21, ...matrices.map((m) => m.length)) + 2 * QR_MARGE
  const colonnes = Math.max(1, Math.ceil(Math.sqrt(adresses.length)))
  const cote = taille * colonnes
  const pixels = new Uint8Array(cote * cote * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...CLAIR, 255], i)
  const uv: [number, number][] = []
  const tailles: number[] = []
  matrices.forEach((m, i) => {
    const n = m.length
    const [cx, cy] = [i % colonnes, Math.floor(i / colonnes)]
    // La case `cy` compte depuis le haut ; les rangées de texels, depuis le bas.
    const haut = cote - cy * taille
    tailles.push(n + 2 * QR_MARGE)
    uv.push([(cx * taille) / cote, (haut - n - 2 * QR_MARGE) / cote])
    for (let l = 0; l < n; l++)
      for (let c = 0; c < n; c++) {
        if (!m[l][c]) continue
        const x = cx * taille + QR_MARGE + c
        const y = haut - 1 - QR_MARGE - l
        pixels.set(SOMBRE, (y * cote + x) * 4)
      }
  })
  return { case: taille, colonnes, cote, pixels, uv, tailles }
}
