/**
 * Les ombres de contact (OmbresDeContact de three, scene/OmbresLayer.tsx) : sous
 * un banc, une banquette, un pot, un socle, une vitrine, la tache douce que le
 * ciel n'atteint pas et qui POSE l'objet sur le sol. Une tache par meuble (les
 * pièces d'un même meuble fusionnées, `regrouperEmprises`), toutes en thin
 * instances d'un seul plan : un appel. Bavette a la sienne (bavette.ts).
 *
 * ponytail : calculées une fois, les meubles arrivés (main.ts les attend) ;
 * three recompte chaque seconde. À refaire si un meuble arrive plus tard.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { regrouperEmprises, type Emprise } from '../domain/ombres.ts'
import { MUSEE } from '../plan/musee.ts'
import { hauteurDuParc } from '../plan/relief.ts'

/** La tache déborde l'emprise de tant (m) et d'une fraction, comme une vraie pénombre. */
const DEBORD = { fixe: 0.3, relatif: 0.4 }
const PLANCHERS = MUSEE.levels.map((l) => l.elevation)

/**
 * Les taches à poser : les emprises de moins de 6 m, fusionnées, posées au sol
 * (à 12 cm d'un plancher, ou à 20 cm du relief du parc).
 */
export function emprisesDeContact(boites: readonly Emprise[], planchers: readonly number[] = PLANCHERS, sol: (x: number, z: number) => number = hauteurDuParc): Emprise[] {
  return regrouperEmprises(boites.filter((e) => e.maxX - e.minX < 6 && e.maxZ - e.minZ < 6)).filter((e) =>
    planchers.some((y) => Math.abs(e.minY - y) < 0.12) || Math.abs(e.minY - sol((e.minX + e.maxX) / 2, (e.minZ + e.maxZ) / 2)) < 0.2)
}

/** Les boîtes monde d'un maillage, une par thin instance (aucune pour un maillage sans éclairage : halos, textes). */
export function emprisesDuMaillage(m: AbstractMesh): Emprise[] {
  const mat = m.material as { unlit?: boolean; disableLighting?: boolean } | null
  if (!mat || mat.unlit || mat.disableLighting) return []
  const b = m.getRawBoundingInfo().boundingBox
  const w = m.computeWorldMatrix(true)
  const mats = (m as Mesh).hasThinInstances ? (m as Mesh).thinInstanceGetWorldMatrices() : [Matrix.Identity()]
  const [t, v] = [new Matrix(), new Vector3()]
  return mats.map((i) => {
    i.multiplyToRef(w, t)
    const e: Emprise = { minX: Infinity, maxX: -Infinity, minY: Infinity, minZ: Infinity, maxZ: -Infinity }
    for (const c of b.vectors) {
      Vector3.TransformCoordinatesToRef(c, t, v)
      e.minX = Math.min(e.minX, v.x)
      e.maxX = Math.max(e.maxX, v.x)
      e.minY = Math.min(e.minY, v.y)
      e.minZ = Math.min(e.minZ, v.z)
      e.maxZ = Math.max(e.maxZ, v.z)
    }
    return e
  })
}

/**
 * La tache de OmbresLayer (rectangle 24..104 sur 128, flou gaussien de 12 px),
 * calculée : son opacité en alpha (pas de canvas : testable sous jsdom). Un
 * dégradé smoothstep sur ±2σ suffit à l'œil.
 */
export function tache(n = 128): Uint8Array {
  const lisse = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const bord = (x: number) => lisse(0, 48, x) * (1 - lisse(80, 128, x))
  const out = new Uint8Array(4 * n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[4 * (j * n + i) + 3] = Math.round(255 * bord(i + 0.5) * bord(j + 0.5))
  return out
}

/** La matière d'une tache (contact des meubles, ombre de Bavette) : noire, l'alpha de `tache()` à 75 %. */
export function matiereDeTache(nom: string, scene: Scene): StandardMaterial {
  const dt = RawTexture.CreateRGBATexture(tache(), 128, 128, scene)
  const noir = new StandardMaterial(nom, scene)
  noir.diffuseColor = noir.specularColor = Color3.Black()
  noir.disableLighting = true
  // Par la diffuse (noire) et son alpha : en `opacityTexture`, la tache ne sortait pas (WebGL2, mesuré).
  dt.hasAlpha = true
  noir.diffuseTexture = dt
  noir.useAlphaFromDiffuseTexture = true
  noir.alpha = 0.75
  noir.disableDepthWrite = true
  noir.zOffset = -2
  return noir
}

export function monterContact(scene: Scene, meubles: readonly AbstractMesh[]): Mesh {
  const emprises = emprisesDeContact(meubles.flatMap(emprisesDuMaillage))
  const taches = CreateGround('contact', { width: 1, height: 1 }, scene)
  taches.material = matiereDeTache('contact', scene)
  taches.isPickable = false
  taches.alphaIndex = 1
  const buf = new Float32Array(16 * emprises.length)
  emprises.forEach((e, i) => {
    const [w, d] = [e.maxX - e.minX, e.maxZ - e.minZ]
    const s = new Vector3(w * (1 + DEBORD.relatif) + DEBORD.fixe, 1, d * (1 + DEBORD.relatif) + DEBORD.fixe)
    Matrix.Compose(s, Quaternion.Identity(), new Vector3((e.minX + e.maxX) / 2, e.minY + 0.012, (e.minZ + e.maxZ) / 2)).copyToArray(buf, 16 * i)
  })
  taches.thinInstanceSetBuffer('matrix', buf, 16)
  // Sans instance, Babylon dessinerait le plan seul à l'origine.
  taches.setEnabled(emprises.length > 0)
  return taches
}
