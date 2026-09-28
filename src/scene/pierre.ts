/**
 * La pierre de taille du hall et le granit de ses bandes de sol.
 *
 * L'appareil est dessiné sur un canevas plutôt que téléchargé : ce qui le fait
 * lire comme de la pierre de taille, ce sont ses JOINTS — des blocs de 1,20 m
 * sur des assises de 60 cm, joints croisés — et aucune photo CC0 ne les pose à
 * la bonne échelle. Les UV sont en mètres (`appliquerEchelleInstance`).
 */
import * as THREE from 'three'
import { appliquerEchelleInstance } from './materials'

const BLOC = 1.2
const ASSISE = 0.6
const PX = 256 // pixels par mètre

/** Un hasard reproductible : la même pierre à chaque chargement. */
function hasard(graine: number): () => number {
  let s = graine
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function appareil(): THREE.Texture | null {
  const [w, h] = [2 * BLOC * PX, 2 * ASSISE * PX]
  const canevas = document.createElement('canvas')
  canevas.width = w
  canevas.height = h
  const ctx = canevas.getContext('2d')
  if (ctx === null) return null // jsdom : la pierre reste en aplat
  const r = hasard(7)
  for (let assise = 0; assise < 2; assise++) {
    const decale = assise % 2 === 0 ? 0 : BLOC / 2
    for (let b = -1; b < 2; b++) {
      const x = (b * BLOC + decale) * PX
      const v = Math.round(r() * 14 - 7)
      ctx.fillStyle = `rgb(${214 + v}, ${201 + v}, ${176 + v})`
      ctx.fillRect(x, assise * ASSISE * PX, BLOC * PX, ASSISE * PX)
    }
  }
  // Le grain du calcaire.
  for (let i = 0; i < 9000; i++) {
    const v = r()
    ctx.fillStyle = v < 0.5 ? 'rgba(120, 100, 70, 0.10)' : 'rgba(255, 250, 235, 0.12)'
    ctx.fillRect(r() * w, r() * h, 2, 2)
  }
  // Les joints, un filet clair sur un filet d'ombre.
  ctx.fillStyle = 'rgba(95, 80, 60, 0.55)'
  for (const y of [0, ASSISE * PX]) ctx.fillRect(0, y, w, 3)
  for (let assise = 0; assise < 2; assise++) {
    const decale = assise % 2 === 0 ? 0 : BLOC / 2
    for (let b = 0; b < 3; b++) ctx.fillRect(((b * BLOC + decale) * PX) % w, assise * ASSISE * PX, 3, ASSISE * PX)
  }
  const t = new THREE.CanvasTexture(canevas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / (2 * BLOC), 1 / (2 * ASSISE))
  t.anisotropy = 8
  return t
}

export function creerPierre(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, map: appareil() })
  if (m.map === null) m.color.set('#d6c9b0')
  appliquerEchelleInstance(m)
  return m
}

export function creerGranit(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#6a6158', roughness: 0.4 })
}

/** Un canevas répétable en mètres : `motif` (largeur, hauteur) et `dessin` qui le remplit. */
function canevas(motif: [number, number], ppm: number, dessin: (ctx: CanvasRenderingContext2D, px: (m: number) => number) => void): THREE.Texture | null {
  const c = document.createElement('canvas')
  c.width = Math.round(motif[0] * ppm)
  c.height = Math.round(motif[1] * ppm)
  const ctx = c.getContext('2d')
  if (ctx === null) return null
  dessin(ctx, (m) => m * ppm)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / motif[0], 1 / motif[1])
  t.anisotropy = 8
  return t
}

/**
 * La brique rouge-brun du S.M.A.K. : briques de 22 × 6,5 cm, joints d'un
 * centimètre, appareil en panneresses décalées d'une demi-brique.
 */
export function creerBrique(): THREE.MeshStandardMaterial {
  const [L, H, J] = [0.22, 0.065, 0.01]
  const [cols, rangs] = [8, 12]
  const r = hasard(11)
  const map = canevas([cols * (L + J), rangs * (H + J)], 400, (ctx, px) => {
    ctx.fillStyle = '#b7aa98' // le mortier
    ctx.fillRect(0, 0, px(cols * (L + J)), px(rangs * (H + J)))
    for (let j = 0; j < rangs; j++)
      for (let i = -1; i < cols; i++) {
        const x = (i + (j % 2) / 2) * (L + J)
        const v = r()
        ctx.fillStyle = `rgb(${Math.round(128 + v * 38)}, ${Math.round(62 + v * 20)}, ${Math.round(44 + v * 14)})`
        ctx.fillRect(px(x), px(j * (H + J)), px(L), px(H))
      }
  })
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map })
  if (map === null) m.color.set('#8f4a35')
  appliquerEchelleInstance(m)
  return m
}

/** La pierre cannelée des piliers : des gorges verticales tous les 10 cm. */
export function creerCannelure(): THREE.MeshStandardMaterial {
  const map = canevas([0.1, 1], 400, (ctx, px) => {
    const g = ctx.createLinearGradient(0, 0, px(0.1), 0)
    g.addColorStop(0, '#b9b1a4')
    g.addColorStop(0.5, '#e2dccf')
    g.addColorStop(1, '#b9b1a4')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, px(0.1), px(1))
  })
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, map })
  if (map === null) m.color.set('#d6cfc2')
  appliquerEchelleInstance(m)
  return m
}
