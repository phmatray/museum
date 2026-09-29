/**
 * Les sculptures du plan à l'écran : un socle de pierre, la pièce, son nom.
 *
 * `plan/sculptures.ts` a décidé où — dans une niche que la marche contourne
 * déjà, ou à côté de la vitrine de son projet, une fois le catalogue chargé.
 * Ici on ne fait que dessiner.
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

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
  const halo = useHalo()

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
            {/* La flaque du projecteur : au sol, un peu en avant, et le long de la face du socle. */}
            {halo && (
              <>
                <mesh position={[0, HALO.sol, HALO.avance]} rotation={[-Math.PI / 2, 0, 0]} material={halo.sol}>
                  <planeGeometry args={[HALO.diametre, HALO.diametre]} />
                </mesh>
                <mesh position={[0, p.plinth.height / 2, p.plinth.depth / 2 + 0.002]} material={halo.face}>
                  <planeGeometry args={[p.plinth.width, p.plinth.height]} />
                </mesh>
              </>
            )}
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

/**
 * La lumière d'un projecteur qu'on ne voit pas, là où elle tombe : une flaque
 * chaude au sol et un dégradé sur la face du socle, en mélange additif. Le
 * vrai éclairage de la pièce est greffé sur son shader (`sculptureAssets.ts`) ;
 * ceci dit, de l'autre bout de la salle, qu'elle est sous un projecteur. Deux
 * maillages par pièce, deux matériaux partagés, aucune lumière de three.
 */
const HALO = { diametre: 2.6, avance: 0.25, sol: 0.03, couleur: '#ffd9a0', opacite: { sol: 0.32, face: 0.12 } }

function degrade(dessiner: (ctx: CanvasRenderingContext2D, n: number) => CanvasGradient): THREE.Texture | null {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  if (ctx === null) return null // jsdom
  ctx.fillStyle = dessiner(ctx, 128)
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function useHalo(): { sol: THREE.Material; face: THREE.Material } | null {
  const halo = useMemo(() => {
    const rond = degrade((ctx, n) => {
      const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
      g.addColorStop(0, '#fff')
      g.addColorStop(0.45, '#8a8a8a')
      g.addColorStop(1, '#000')
      return g
    })
    const haut = degrade((ctx, n) => {
      const g = ctx.createLinearGradient(0, 0, 0, n)
      g.addColorStop(0, '#fff')
      g.addColorStop(1, '#000')
      return g
    })
    if (rond === null || haut === null) return null
    const materiau = (map: THREE.Texture, opacity: number) =>
      new THREE.MeshBasicMaterial({ map, color: HALO.couleur, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    return { sol: materiau(rond, HALO.opacite.sol), face: materiau(haut, HALO.opacite.face) }
  }, [])
  useEffect(
    () => () => {
      for (const m of halo ? [halo.sol, halo.face] : []) {
        ;(m as THREE.MeshBasicMaterial).map?.dispose()
        m.dispose()
      }
    },
    [halo],
  )
  return halo
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
