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
