/**
 * Les sculptures du plan à l'écran : un socle de pierre, la pièce, son nom.
 *
 * `plan/sculptures.ts` a décidé où — dans une niche que la marche contourne
 * déjà, ou à côté de la vitrine de son projet, une fois le catalogue chargé.
 * Ici on ne fait que dessiner.
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Text } from '@react-three/drei'

import { useVitrines } from '../hooks/useCatalogue'
import { sculpturesDesVitrines, type SculpturePlacement } from '../plan/sculptures'
import { CARTEL_FONT, THEME_INK } from './cartelStyle'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'
import { sculptureAssetsResource, type SculptureAssets } from './sculptureAssets'

/** La plaque du cartel : ses cotes, et sa distance au haut du socle (m). */
const CARTEL = { largeur: 0.3, hauteur: 0.09, epaisseur: 0.006, haut: 0.12 }

export function SculptureLayer({ placements: niches }: { placements: SculpturePlacement[] }) {
  const vitrines = useVitrines()
  const placements = useMemo(() => [...niches, ...sculpturesDesVitrines(vitrines?.map((a) => a.key) ?? [])], [niches, vitrines])
  const cle = placements.map((p) => p.file).join(',')
  const assets = useSculptureAssets(cle)
  // Un socle de pierre claire, comme au Louvre : il porte la pièce sans lui disputer le regard.
  const pierre = useMatiere('beton', repetitionMetrique(REGLAGE_MATIERE.beton.motif), { teinte: '#e2dccf' })

  return (
    <group name="sculptures">
      {placements.map((p) => {
        const objet = assets?.get(p.file)
        return (
          <group key={p.id} position={[p.x, p.y, p.z]} rotation={[0, p.rotation, 0]}>
            <mesh position={[0, p.plinth.height / 2, 0]} material={pierre}>
              <boxGeometry args={[p.plinth.width, p.plinth.height, p.plinth.depth]} />
            </mesh>
            {objet !== undefined && <primitive object={objet} position={[0, p.plinth.height, 0]} />}
            {/* Le cartel, une plaque crème en haut de la face avant du socle —
                celle des vitrines. Sa propre attente : la police ne retient ni
                le socle ni la pièce. */}
            <mesh position={[0, p.plinth.height - CARTEL.haut, p.plinth.depth / 2 + CARTEL.epaisseur / 2]}>
              <boxGeometry args={[Math.min(CARTEL.largeur, p.plinth.width - 0.08), CARTEL.hauteur, CARTEL.epaisseur]} />
              <meshStandardMaterial color="#efe6d2" roughness={0.85} />
            </mesh>
            <Suspense fallback={null}>
              <Text
                font={CARTEL_FONT}
                position={[0, p.plinth.height - CARTEL.haut, p.plinth.depth / 2 + CARTEL.epaisseur + 0.001]}
                fontSize={0.026}
                lineHeight={1.3}
                color={THEME_INK.classic}
                anchorX="center"
                anchorY="middle"
                maxWidth={Math.min(CARTEL.largeur, p.plinth.width - 0.08) - 0.02}
                textAlign="center"
              >
                {`${p.cartel.title}\n${p.project?.split('/')[1] ?? `${p.cartel.author}, ${p.cartel.year}`}`}
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
