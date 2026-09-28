/** Les inscriptions gravées (plaques, cadrans) : un canevas dessiné en mètres. */
import * as THREE from 'three'

/** Un canevas de `l` × `h` mètres, dessiné en mètres ; `null` sous jsdom. */
export function canevasEnMetres(l: number, h: number, ppm: number, dessin: (ctx: CanvasRenderingContext2D) => void, couleur = true): THREE.CanvasTexture | null {
  const c = document.createElement('canvas')
  c.width = Math.round(l * ppm)
  c.height = Math.round(h * ppm)
  const ctx = c.getContext('2d')
  if (ctx === null) return null
  ctx.scale(ppm, ppm)
  dessin(ctx)
  const t = new THREE.CanvasTexture(c)
  if (couleur) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
