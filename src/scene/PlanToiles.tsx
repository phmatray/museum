/**
 * Les toiles du plan, et le nom de chaque salle.
 *
 * Tout est décidé dans `plan/hang.ts` et écrit dans `data/accrochage.json` :
 * ici on ne fait que convertir des positions monde en matrices, puis rendre
 * avec les MÊMES lots que l'ancienne scène (texture array, un appel de dessin
 * pour toutes les toiles d'un atlas).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import type { Hanging } from '../builders/artwork'
import { useAccrochage } from '../hooks/useAccrochage'
import { atlasResource, claimNearTextures, nearTextures, subscribeNearTextures, type AtlasTextures } from '../io/arrayTexture'
import { cimaisesDe } from '../plan/cimaises'
import { MUSEE } from '../plan/musee'
import { INT as DEMI_MUR } from '../plan/svg'
import { SALLE_VITRINES } from '../plan/vitrines'
import { CanvasInstances, FrameInstances, NearArtwork } from './ArtworkLayer'
import { CARTEL_FONT } from './cartelStyle'
import { computePoses, posesProches, type Pose } from './planToilesGeometry'

/** Hauteur du nom de salle, au-dessus des toiles les plus hautes. */
const HAUTEUR_NOM = 3.1
/**
 * Plus haut derrière une cimaise qui court devant le mur nord (`cimaises.ts`) :
 * de la banquette, son arête (2,50 m) couperait le nom en deux.
 */
const HAUTEUR_NOM_CIMAISE = 3.6

export function PlanToiles({ level }: { level: number }) {
  const accrochage = useAccrochage()
  const atlas = useAtlas()
  const salles = useMemo(() => accrochage?.rooms.filter((r) => r.level === level) ?? [], [accrochage, level])

  const poses = useMemo(() => computePoses(salles), [salles])

  // De près, la vignette 1024 × 512 du dépôt remplace la couche 256 × 128 de
  // l'atlas, comme dans l'ancienne scène (`ArtworkLayer`) : sans elle, le texte
  // d'une toile restait flou à un mètre. Réévalué tous les demi-mètres.
  const [proches, setProches] = useState<readonly Pose[]>(AUCUNE_POSE)
  const derniere = useRef(new THREE.Vector3(Infinity, 0, 0))
  useFrame(({ camera }) => {
    if (camera.position.distanceToSquared(derniere.current) < 0.25) return
    derniere.current.copy(camera.position)
    const vues = posesProches(poses, camera.position)
    if (vues.length !== proches.length || vues.some((p, i) => p !== proches[i])) setProches(vues)
  })
  useEffect(() => claimNearTextures(`plan:${level}`, proches.map((p) => p.key)), [level, proches])
  useEffect(() => () => claimNearTextures(`plan:${level}`, []), [level])
  const vignettes = useSyncExternalStore(subscribeNearTextures, nearTextures, nearTextures)
  // L'instance ne s'efface qu'une fois la vignette arrivée : un trou se verrait plus qu'un flou.
  const masquees = useMemo(() => new Set(proches.filter((p) => vignettes.has(p.key)).map((p) => p.id)), [proches, vignettes])

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
            <CanvasInstances key={numero} texture={atlas.layers[numero]} hangings={liste} masquees={masquees} />
          ))}
      {proches.map((p) => {
        const texture = vignettes.get(p.key)
        return texture === undefined ? null : <NearArtwork key={p.id} hanging={p} texture={texture} />
      })}
      {niveau !== undefined &&
        salles.map((salle) => {
          const room = niveau.rooms.find((r) => r.id === salle.id)
          // Le mur nord de la salle d'honneur porte les vitrines : pas de nom par-dessus.
          if (room === undefined || room.id === SALLE_VITRINES) return null
          // Sur le mur nord de la salle, face au sud : au-dessus des portes.
          const masque = cimaisesDe(level, room.id).some((c) => c.axe === 'x' && c.z < room.z + room.depth / 2)
          return (
            <Text
              key={salle.id}
              font={CARTEL_FONT}
              position={[room.x + room.width / 2, niveau.elevation + (masque ? HAUTEUR_NOM_CIMAISE : HAUTEUR_NOM), room.z + DEMI_MUR + 0.01]}
              fontSize={0.32}
              // Crème sur les murs de couleur des galeries (parement.ts).
              color="#efe4cc"
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

const AUCUNE_POSE: readonly Pose[] = []

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
