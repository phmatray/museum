/**
 * Les toiles du plan, et le nom de chaque salle.
 *
 * Tout est décidé dans `plan/hang.ts` et écrit dans `data/accrochage.json` :
 * ici on ne fait que convertir des positions monde en matrices, puis rendre
 * avec les MÊMES lots que l'ancienne scène (texture array, un appel de dessin
 * pour toutes les toiles d'un atlas).
 */
import { useEffect, useMemo, useState } from 'react'
import { Text } from '@react-three/drei'

import type { Hanging } from '../builders/artwork'
import { atlasResource, type AtlasTextures } from '../io/arrayTexture'
import type { Accrochage } from '../plan/hang'
import { MUSEE } from '../plan/musee'
import { INT as DEMI_MUR } from '../plan/svg'
import { CanvasInstances, FrameInstances } from './ArtworkLayer'
import { THEME_INK } from './cartelStyle'
import { computePoses } from './planToilesGeometry'

/** Hauteur du nom de salle, au-dessus des toiles les plus hautes. */
const HAUTEUR_NOM = 3.1

export function PlanToiles({ level }: { level: number }) {
  const accrochage = useAccrochage()
  const atlas = useAtlas()
  const salles = useMemo(() => accrochage?.rooms.filter((r) => r.level === level) ?? [], [accrochage, level])

  const poses = useMemo(() => computePoses(salles), [salles])

  // Une œuvre absente de l'index (atlas plus récent que l'accrochage) garde son
  // cadre mais pas de toile : la couche 0 montrerait l'image d'un autre dépôt.
  const parAtlas = useMemo(() => {
    const groupes = new Map<number, Hanging[]>()
    for (const pose of poses) {
      const entree = atlas?.index.entries[pose.key]
      if (entree === undefined) continue
      const liste = groupes.get(entree.atlas)
      const h = { ...pose, ...entree }
      if (liste === undefined) groupes.set(entree.atlas, [h])
      else liste.push(h)
    }
    return groupes
  }, [poses, atlas])
  const niveau = MUSEE.levels.find((l) => l.id === level)

  return (
    <>
      {poses.length > 0 && <FrameInstances hangings={poses} />}
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

/**
 * Chargé en effet, pas par `use()` : un accrochage absent ou en retard ne doit
 * ni masquer les murs derrière le Suspense, ni faire tomber la visite.
 */
function useAccrochage(): Accrochage | null {
  const [accrochage, setAccrochage] = useState<Accrochage | null>(null)
  useEffect(() => {
    let vivant = true
    fetch(`${import.meta.env.BASE_URL}data/accrochage.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Accrochage>
      })
      .then(
        (charge) => vivant && setAccrochage(charge),
        (erreur: unknown) => console.error('accrochage.json indisponible', erreur),
      )
    return () => {
      vivant = false
    }
  }, [])
  return accrochage
}

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
