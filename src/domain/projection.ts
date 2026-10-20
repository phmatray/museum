/**
 * La projection d'un élément HTML sur un quadrilatère de l'écran : la séance du
 * cinéma pose le lecteur YouTube (un iframe, qui ne peut pas être une texture :
 * CORS) exactement sur les quatre coins projetés de la toile 3D, comme projeté
 * dessus. Pur : une homographie 2D, écrite en `matrix3d` CSS.
 *
 * Coins dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche (pixels).
 */
export type Point = readonly [number, number]

/** Résout A·x = b (n × n) par Gauss avec pivot partiel ; null si singulier. */
function resoudre(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((l, i) => [...l, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let l = c + 1; l < n; l++) if (Math.abs(m[l][c]) > Math.abs(m[p][c])) p = l
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    for (let l = 0; l < n; l++) {
      if (l === c) continue
      const f = m[l][c] / m[c][c]
      for (let k = c; k <= n; k++) m[l][k] -= f * m[c][k]
    }
  }
  return m.map((l, i) => l[n] / l[i])
}

/** L'homographie (h0…h7, h8 = 1) qui envoie (0,0), (w,0), (w,h), (0,h) sur les quatre coins. */
export function homographie(w: number, h: number, coins: readonly [Point, Point, Point, Point]): number[] | null {
  const src: Point[] = [[0, 0], [w, 0], [w, h], [0, h]]
  const a: number[][] = []
  const b: number[] = []
  src.forEach(([x, y], i) => {
    const [u, v] = coins[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  })
  const s = resoudre(a, b)
  return s && [...s, 1]
}

/** La même, en `matrix3d(...)` CSS (ordre colonne, origine de transformation en 0 0). */
export function matrice3d(w: number, h: number, coins: readonly [Point, Point, Point, Point]): string | null {
  const H = homographie(w, h, coins)
  if (!H) return null
  const [a, b, c, d, e, f, g, i] = H
  // x' = (a x + b y + c) / (g x + i y + 1) ; y' = (d x + e y + f) / (…) : en 4 × 4, z inerte.
  return `matrix3d(${[a, d, 0, g, b, e, 0, i, 0, 0, 1, 0, c, f, 0, 1].map((v) => +v.toFixed(9)).join(',')})`
}

/** Applique l'homographie à un point (pour les tests et le repli). */
export function appliquer(H: readonly number[], [x, y]: Point): Point {
  const z = H[6] * x + H[7] * y + H[8]
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z]
}
