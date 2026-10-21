/**
 * Les matières dessinées de `scene/pierre.ts`, au pixel près (même hasard
 * Park-Miller, mêmes graines) : pierre de taille (hall, embrasures, façade,
 * balcons, belvédère), brique du S.M.A.K., cannelure des piliers, granit.
 * Pour des UV en mètres (`boitesFusionnees` de boites.ts) : chaque texture
 * répète son motif (uScale = 1/motif). Une texture par scène, partagée entre
 * les matières ; une matière neuve par appel (une couche peut y greffer son
 * plugin, l'usure par exemple, sans toucher les autres).
 * Sans canevas (NullEngine) : l'aplat de repli de three.
 */
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

import { matiere } from './boites.ts'

/** Un hasard reproductible : la même pierre à chaque chargement (pierre.ts:17). */
export function hasard(graine: number): () => number {
  let s = graine
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

type Dessin = (ctx: CanvasRenderingContext2D, px: (m: number) => number) => void
const textures = new WeakMap<Scene, Map<string, Texture | null>>()

/** Un canevas répétable en mètres : `motif` (largeur, hauteur), `ppm` pixels par mètre. sRGB, anisotropie 8. */
function canevas(scene: Scene, nom: string, motif: [number, number], ppm: number, dessin: Dessin): Texture | null {
  const cache = textures.get(scene) ?? new Map<string, Texture | null>()
  textures.set(scene, cache)
  if (cache.has(nom)) return cache.get(nom)!
  let t: DynamicTexture | null = null
  try {
    t = new DynamicTexture(nom, { width: Math.round(motif[0] * ppm), height: Math.round(motif[1] * ppm) }, scene, true)
    const ctx = t.getContext() as CanvasRenderingContext2D | null
    if (!ctx?.fillRect) throw new Error('pas de canevas 2D')
    dessin(ctx, (m) => m * ppm)
    // invertY : le haut du canevas en v = 1, comme `flipY` de three.
    t.update(true)
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE
    t.uScale = 1 / motif[0]
    t.vScale = 1 / motif[1]
    t.anisotropicFilteringLevel = 8
  } catch {
    t?.dispose()
    t = null
  }
  cache.set(nom, t)
  return t
}

/** Une matière blanche sous sa carte, ou l'aplat de repli sans canevas. */
function peinte(nom: string, scene: Scene, t: Texture | null, repli: string, rugosite: number): PBRMaterial {
  const m = matiere(nom, scene, '#ffffff', rugosite)
  if (t) m.albedoTexture = t
  else m.albedoColor = Color3.FromHexString(repli).toLinearSpace()
  return m
}

const BLOC = 1.2
const ASSISE = 0.6

/** La pierre de taille : blocs de 1,20 × 0,60 m à joints croisés, grain du calcaire, joints. Rugosité 0,85. */
export function creerPierre(scene: Scene, nom = 'pierre'): PBRMaterial {
  const t = canevas(scene, 'pierre', [2 * BLOC, 2 * ASSISE], 256, (ctx, px) => {
    const [w, h] = [px(2 * BLOC), px(2 * ASSISE)]
    const r = hasard(7)
    for (let assise = 0; assise < 2; assise++) {
      const decale = assise % 2 === 0 ? 0 : BLOC / 2
      for (let b = -1; b < 2; b++) {
        const v = Math.round(r() * 14 - 7)
        ctx.fillStyle = `rgb(${214 + v}, ${201 + v}, ${176 + v})`
        ctx.fillRect(px(b * BLOC + decale), px(assise * ASSISE), px(BLOC), px(ASSISE))
      }
    }
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(120, 100, 70, 0.10)' : 'rgba(255, 250, 235, 0.12)'
      ctx.fillRect(r() * w, r() * h, 2, 2)
    }
    ctx.fillStyle = 'rgba(95, 80, 60, 0.55)'
    for (const y of [0, px(ASSISE)]) ctx.fillRect(0, y, w, 3)
    for (let assise = 0; assise < 2; assise++) {
      const decale = assise % 2 === 0 ? 0 : BLOC / 2
      for (let b = 0; b < 3; b++) ctx.fillRect(px(b * BLOC + decale) % w, px(assise * ASSISE), 3, px(ASSISE))
    }
  })
  return peinte(nom, scene, t, '#d6c9b0', 0.85)
}

/** La brique rouge-brun du S.M.A.K. : 22 × 6,5 cm, joints d'un centimètre, panneresses décalées. Rugosité 0,9. */
export function creerBrique(scene: Scene, nom = 'brique'): PBRMaterial {
  const [L, H, J] = [0.22, 0.065, 0.01]
  const [cols, rangs] = [8, 12]
  const t = canevas(scene, 'brique', [cols * (L + J), rangs * (H + J)], 400, (ctx, px) => {
    const r = hasard(11)
    ctx.fillStyle = '#b7aa98'
    ctx.fillRect(0, 0, px(cols * (L + J)), px(rangs * (H + J)))
    for (let j = 0; j < rangs; j++)
      for (let i = -1; i < cols; i++) {
        const v = r()
        ctx.fillStyle = `rgb(${Math.round(128 + v * 38)}, ${Math.round(62 + v * 20)}, ${Math.round(44 + v * 14)})`
        ctx.fillRect(px((i + (j % 2) / 2) * (L + J)), px(j * (H + J)), px(L), px(H))
      }
  })
  return peinte(nom, scene, t, '#8f4a35', 0.9)
}

/** La pierre cannelée des piliers : une gorge verticale tous les 10 cm. Rugosité 0,8. */
export function creerCannelure(scene: Scene, nom = 'cannelure'): PBRMaterial {
  const t = canevas(scene, 'cannelure', [0.1, 1], 400, (ctx, px) => {
    const g = ctx.createLinearGradient(0, 0, px(0.1), 0)
    g.addColorStop(0, '#b9b1a4')
    g.addColorStop(0.5, '#e2dccf')
    g.addColorStop(1, '#b9b1a4')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, px(0.1), px(1))
  })
  return peinte(nom, scene, t, '#d6cfc2', 0.8)
}

/** Le granit sombre (plinthes du hall, bandes du sol, résille, menuiseries de façade) : un aplat, rugosité 0,4. */
export function creerGranit(scene: Scene, nom = 'granit'): PBRMaterial {
  return matiere(nom, scene, '#6a6158', 0.4)
}
