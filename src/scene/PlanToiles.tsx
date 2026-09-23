/**
 * Les toiles du plan, et le nom de chaque salle.
 *
 * Tout est décidé dans `plan/hang.ts` et écrit dans `data/accrochage.json` :
 * ici on ne fait que convertir des positions monde en matrices, puis rendre
 * avec les MÊMES lots que l'ancienne scène (texture array, un appel de dessin
 * pour toutes les toiles d'un atlas).
 */
import { use, useEffect, useMemo, useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

import type { Hanging } from '../builders/artwork'
import { FRAME_BORDER, FRAME_DEPTH } from '../builders/artwork'
import { DEFAULT_ASPECT } from '../domain/hanging'
import { atlasResource, type AtlasTextures } from '../io/arrayTexture'
import type { Accrochage } from '../plan/hang'
import { MUSEE } from '../plan/musee'
import { CanvasInstances, FrameInstances } from './ArtworkLayer'
import { THEME_INK } from './cartelStyle'

/** Hauteur du nom de salle, au-dessus des toiles les plus hautes. */
const HAUTEUR_NOM = 3.1
/** La face d'un mur est à 0,15 m de l'arête du plan (`svg.ts`). */
const DEMI_MUR = 0.15

let enCours: Promise<Accrochage> | null = null

/** Mémorisé pour `use()` ; oublié en cas d'échec pour qu'un remontage réessaie. */
function accrochageResource(): Promise<Accrochage> {
  enCours ??= fetch(`${import.meta.env.BASE_URL}data/accrochage.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`accrochage.json : HTTP ${r.status}`)
      return r.json() as Promise<Accrochage>
    })
    .catch((erreur: unknown) => {
      enCours = null
      throw erreur
    })
  return enCours
}

export function PlanToiles({ level }: { level: number }) {
  const accrochage = use(accrochageResource())
  const atlas = useAtlas()
  const salles = useMemo(() => accrochage.rooms.filter((r) => r.level === level), [accrochage, level])

  const hangings = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0)
    return salles.flatMap((salle) =>
      salle.placements.map((p): Hanging => {
        const n = new THREE.Vector3(p.normal[0], 0, p.normal[1])
        const base = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, n), up, n)
        const face = new THREE.Vector3(p.x, p.y, p.z)
        const height = p.width / DEFAULT_ASPECT
        const at = (offset: number) => face.clone().addScaledVector(n, offset)
        const canvas = base.clone().setPosition(at(FRAME_DEPTH + 0.004)).scale(new THREE.Vector3(p.width, height, 1))
        const frame = base.clone().setPosition(at(FRAME_DEPTH / 2))
          .scale(new THREE.Vector3(p.width + 2 * FRAME_BORDER, height + 2 * FRAME_BORDER, FRAME_DEPTH))
        const entree = atlas?.index.entries[p.key]
        return {
          id: `${salle.id}#${p.key}`,
          key: p.key,
          atlas: entree?.atlas ?? 0,
          layer: entree?.layer ?? 0,
          canvas,
          frame,
          centre: at(0),
        }
      }))
  }, [salles, atlas])

  const parAtlas = useMemo(() => {
    const groupes = new Map<number, Hanging[]>()
    for (const h of hangings) groupes.set(h.atlas, [...(groupes.get(h.atlas) ?? []), h])
    return groupes
  }, [hangings])
  const niveau = MUSEE.levels.find((l) => l.id === level)

  return (
    <>
      {hangings.length > 0 && <FrameInstances hangings={hangings} />}
      {atlas !== null &&
        [...parAtlas].map(([numero, liste]) =>
          atlas.layers[numero] === undefined ? null : (
            <CanvasInstances key={numero} texture={atlas.layers[numero]} hangings={liste} masquees={AUCUNE} />
          ))}
      {niveau !== undefined &&
        salles.map((salle) => {
          const room = niveau.rooms.find((r) => r.id === salle.id)
          if (room === undefined) return null
          // Sur le mur nord de la salle, face au sud : au-dessus des portes.
          return (
            <Text
              key={salle.id}
              position={[room.x + room.width / 2, niveau.elevation + HAUTEUR_NOM, room.z + DEMI_MUR + 0.01]}
              fontSize={0.32}
              color={THEME_INK.classic}
              anchorX="center"
              anchorY="middle"
              maxWidth={room.width - 2}
            >
              {salle.name}
            </Text>
          )
        })}
    </>
  )
}

const AUCUNE: ReadonlySet<string> = new Set()

/** Comme dans `ArtworkLayer` : sans atlas, les cadres restent et la scène ne tombe pas. */
function useAtlas(): AtlasTextures | null {
  const [atlas, setAtlas] = useState<AtlasTextures | null>(null)
  useEffect(() => {
    let vivant = true
    atlasResource().then(
      (charge) => vivant && setAtlas(charge),
      (erreur: unknown) => console.error('atlas des œuvres indisponible', erreur),
    )
    return () => {
      vivant = false
    }
  }, [])
  return atlas
}
