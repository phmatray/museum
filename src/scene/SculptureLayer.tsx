/**
 * Les sculptures du plan à l'écran : un socle de marbre, la pièce, son nom.
 *
 * `plan/sculptures.ts` a décidé où — dans une niche que la marche contourne
 * déjà. Ici on ne fait que dessiner.
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Text } from '@react-three/drei'

import type { SculpturePlacement } from '../plan/sculptures'
import { THEME_INK } from './cartelStyle'
import { useMatiere } from './materials'
import { sculptureAssetsResource, type SculptureAssets } from './sculptureAssets'

export function SculptureLayer({ placements }: { placements: SculpturePlacement[] }) {
  const cle = placements.map((p) => p.file).join(',')
  const assets = useSculptureAssets(cle)
  const marbre = useMatiere('marbre')

  return (
    <group name="sculptures">
      {placements.map((p) => {
        const objet = assets?.get(p.file)
        return (
          <group key={p.id} position={[p.x, p.y, p.z]} rotation={[0, p.rotation, 0]}>
            <mesh position={[0, p.plinth.height / 2, 0]} material={marbre}>
              <boxGeometry args={[p.plinth.width, p.plinth.height, p.plinth.depth]} />
            </mesh>
            {objet !== undefined && <primitive object={objet} position={[0, p.plinth.height, 0]} />}
            {/* Le cartel du socle, sur sa face avant. Sa propre attente : la police
                ne retient ni le socle ni la pièce. */}
            <Suspense fallback={null}>
              <Text
                position={[0, p.plinth.height / 2, p.plinth.depth / 2 + 0.005]}
                fontSize={0.05}
                color={THEME_INK.classic}
                anchorX="center"
                anchorY="middle"
                maxWidth={p.plinth.width - 0.1}
                textAlign="center"
              >
                {`${p.cartel.title}\n${p.cartel.author}, ${p.cartel.year}`}
              </Text>
            </Suspense>
          </group>
        )
      })}
    </group>
  )
}

/** Sans suspendre : le bâtiment apparaît d'abord, la pièce ensuite. */
function useSculptureAssets(cle: string): SculptureAssets | null {
  const [assets, setAssets] = useState<SculptureAssets | null>(null)
  const fichiers = useMemo(() => (cle === '' ? [] : cle.split(',')), [cle])
  useEffect(() => {
    let vivant = true
    void sculptureAssetsResource(fichiers).then((charges) => vivant && setAssets(charges))
    return () => {
      vivant = false
    }
  }, [fichiers])
  return assets
}
