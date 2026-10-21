/**
 * Les atlas MSDF des textes 3D (`src/babylon/msdf.ts`, addon MSDF Text de
 * Babylon) : pour chaque police, `public/msdf/<nom>.png` (les champs de
 * distance multicanaux) et `<nom>.json` (BMFont, le format que lit `FontAsset`).
 *
 *   node tools/generer-msdf.ts
 *
 * Déterministe et sans binaire natif (msdfgen compilé en WebAssembly) : les
 * fichiers sont commités, ce script ne tourne que si l'on change de police ou
 * de jeu de caractères. Les polices sont celles de l'interface (@fontsource,
 * sous-ensemble latin). Un caractère absent de la première police est pris dans
 * la suivante (la flèche ↓ de Marcellus vient de Source Sans 3) ; l'étoile ★
 * des cartels, absente des deux, est tracée ici (champ de distance d'un
 * polygone, le même dans les trois canaux).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

// L'ESM de msdfgen-wasm importe sans extension (Node le refuse) : son CJS.
const require = createRequire(import.meta.url)
const { Msdfgen, Bitmap } = require('msdfgen-wasm') as typeof import('../node_modules/msdfgen-wasm/dist/types/index.d.ts')
type Bitmap = import('../node_modules/msdfgen-wasm/dist/types/index.d.ts').Bitmap
const { MaxRectsPacker } = require('maxrects-packer') as typeof import('maxrects-packer')

const FS = 'node_modules/@fontsource'
const POLICES: Record<string, string[]> = {
  marcellus: [`${FS}/marcellus/files/marcellus-latin-400-normal.woff`, `${FS}/source-sans-3/files/source-sans-3-latin-400-normal.woff`],
  'source-sans-3': [`${FS}/source-sans-3/files/source-sans-3-latin-400-normal.woff`],
}
/** Pixels par em et étendue du champ (px) : 48 px suffisent, le champ garde les angles nets à toute taille. */
const TAILLE = 48
const ETENDUE = 6
const ETOILE = 0x2605
/** ASCII, Latin-1, Œ œ, tirets, guillemets et apostrophes typographiques, points de suspension, €, flèches, ★. */
const CARACTERES = [
  ...plage(0x21, 0x7e), ...plage(0xa1, 0xff), 0x152, 0x153,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, 0x2026, 0x2039, 0x203a, 0x20ac,
  0x2191, 0x2193, ETOILE,
]
/** Les blancs (espace, insécable, fine insécable du « ★ 1 234 » en fr-FR) : une avance, aucun quad (page −1). */
const BLANCS = [0x20, 0xa0, 0x202f, 0x2009]

function plage(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

interface Glyphe { id: number; bitmap: Bitmap | null; xoffset: number; yoffset: number; xadvance: number }

/** L'étoile à cinq branches (rayons 0,36 et 0,15 em, posée sur la ligne de base à 0,33 em) : distance signée au polygone. */
function etoile(ascendant: number): Glyphe {
  const [R, r, cy] = [0.36, 0.145, 0.33]
  const pts = plage(0, 9).map((k) => {
    const a = Math.PI / 2 + (k * Math.PI) / 5
    const d = k % 2 ? r : R
    return [0.4 + d * Math.cos(a), cy + d * Math.sin(a)]
  })
  const cote = Math.round(2 * R * TAILLE + ETENDUE)
  const b = new Bitmap(cote, cote)
  const px = new Uint8ClampedArray(b.buffer)
  const [x0, yHaut] = [0.4 - cote / 2 / TAILLE, cy + cote / 2 / TAILLE]
  for (let j = 0; j < cote; j++) {
    for (let i = 0; i < cote; i++) {
      const [x, y] = [x0 + (i + 0.5) / TAILLE, yHaut - (j + 0.5) / TAILLE]
      let [d, dedans] = [Infinity, false]
      pts.forEach(([ax, ay], k) => {
        const [bx, by] = pts[(k + 1) % pts.length]
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)))
        if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) dedans = !dedans
      })
      // Même codage que msdfgen : 0,5 sur le contour, ±étendue/2 px vers 1 ou 0.
      const v = Math.round(255 * Math.max(0, Math.min(1, 0.5 + ((dedans ? d : -d) * TAILLE) / ETENDUE)))
      px.set([v, v, v, 255], 4 * (j * cote + i))
    }
  }
  return { id: ETOILE, bitmap: b, xoffset: Math.round(x0 * TAILLE), yoffset: Math.round((ascendant - yHaut) * TAILLE), xadvance: Math.round(0.8 * TAILLE) }
}

const msdf = await Msdfgen.create(new Uint8Array(readFileSync('node_modules/msdfgen-wasm/wasm/msdfgen.wasm')).buffer)
mkdirSync('public/msdf', { recursive: true })
for (const [nom, fichiers] of Object.entries(POLICES)) {
  const glyphes = new Map<number, Glyphe>()
  let kernings: { first: number; second: number; amount: number }[] = []
  let metriques = { ascenderY: 0, lineHeight: 0, spaceAdvance: 0 }
  fichiers.forEach((f, rang) => {
    msdf.loadFont(new Uint8Array(readFileSync(f)))
    if (rang === 0) metriques = msdf.metrics
    msdf.loadGlyphs(CARACTERES.filter((c) => !glyphes.has(c)))
    for (const g of msdf.glyphs) {
      const d = msdf.computeGlpyhMsdfData(g, { size: TAILLE, range: ETENDUE })
      glyphes.set(g.unicode, {
        id: g.unicode,
        bitmap: d.width && d.height ? msdf.generateBitmap(g, d) : null,
        // Le coin haut-gauche de l'image, en px depuis le point d'origine et le haut de la ligne (l'ascendante de la police principale).
        xoffset: -d.xTranslate * TAILLE,
        yoffset: metriques.ascenderY * TAILLE - d.height + d.yTranslate * TAILLE,
        xadvance: g.advance * TAILLE,
      })
      // Le crénage, de la police principale seulement.
      if (rang === 0) kernings.push(...g.kerning.map(([b, k]) => ({ first: g.unicode, second: b.unicode, amount: k * TAILLE })))
    }
  })
  if (!glyphes.has(ETOILE)) glyphes.set(ETOILE, etoile(metriques.ascenderY))
  const manquants = CARACTERES.filter((c) => !glyphes.has(c))
  if (manquants.length) console.warn(`${nom} : sans ${manquants.map((c) => String.fromCodePoint(c)).join(' ')}`)
  kernings = kernings.filter((k) => glyphes.has(k.second) && k.amount !== 0)

  // Rangement (maxrects, ordre des codes : déterministe), sans rotation (l'addon ne les lit pas).
  const avecImage = [...glyphes.values()].filter((g) => g.bitmap).sort((a, b) => a.id - b.id)
  const rangeur = new MaxRectsPacker<{ width: number; height: number; x: number; y: number; data: Glyphe }>(2048, 2048, 2, { smart: true, pot: true, square: false, allowRotation: false })
  rangeur.addArray(avecImage.map((g) => ({ width: g.bitmap!.width, height: g.bitmap!.height, x: 0, y: 0, data: g })))
  if (rangeur.bins.length !== 1) throw new Error(`${nom} : plus d'une page`)
  const bac = rangeur.bins[0]
  const atlas = new Bitmap(bac.width, bac.height)
  const place = new Map<number, { x: number; y: number }>()
  for (const r of bac.rects) {
    atlas.blit(r.data.bitmap!, r.x, r.y, false)
    place.set(r.data.id, { x: r.x, y: r.y })
  }
  writeFileSync(`public/msdf/${nom}.png`, msdf.createPng(atlas, 9))

  const r2 = (x: number) => Math.round(x * 100) / 100
  const chars = [
    ...[...glyphes.values()].map((g) => ({
      id: g.id, char: String.fromCodePoint(g.id),
      x: place.get(g.id)?.x ?? 0, y: place.get(g.id)?.y ?? 0, width: g.bitmap?.width ?? 0, height: g.bitmap?.height ?? 0,
      xoffset: r2(g.xoffset), yoffset: r2(g.yoffset), xadvance: r2(g.xadvance), page: g.bitmap ? 0 : -1, chnl: 15, index: 0,
    })),
    ...BLANCS.map((id) => ({
      id, char: String.fromCodePoint(id), x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0,
      xadvance: r2(metriques.spaceAdvance * TAILLE * (id === 0x202f || id === 0x2009 ? 0.6 : 1)), page: -1, chnl: 15, index: 0,
    })),
  ].sort((a, b) => a.id - b.id)
  const police = {
    pages: [`${nom}.png`],
    info: { face: nom, size: TAILLE, bold: 0, italic: 0, charset: [], unicode: 1, stretchH: 100, smooth: 1, aa: 1, padding: [0, 0, 0, 0], spacing: [2, 2] },
    common: { lineHeight: r2(metriques.lineHeight * TAILLE), base: r2(metriques.ascenderY * TAILLE), scaleW: bac.width, scaleH: bac.height, pages: 1, packed: 0, alphaChnl: 0, redChnl: 0, greenChnl: 0, blueChnl: 0 },
    distanceField: { fieldType: 'msdf', distanceRange: ETENDUE },
    chars,
    kernings: kernings.map((k) => ({ ...k, amount: r2(k.amount) })),
  }
  writeFileSync(`public/msdf/${nom}.json`, `${JSON.stringify(police)}\n`)
  console.log(`${nom} : ${chars.length} caractères, ${police.kernings.length} paires, atlas ${bac.width} × ${bac.height}`)
}
