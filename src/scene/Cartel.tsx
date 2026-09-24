/**
 * Un cartel : une plaque claire et trois lignes de texte, posées sur le mur.
 * `plan/cartels.ts` a décidé où et quoi écrire.
 */
import { Suspense } from 'react'
import { Text } from '@react-three/drei'

import { CARTEL_LARGEUR, type CartelPlacement } from '../plan/cartels'
import { THEME_INK } from './cartelStyle'

const HAUTEUR = 0.16
const EPAISSEUR = 0.01

export function Cartel({ placement, texte }: { placement: CartelPlacement; texte: string }) {
  return (
    <group position={[placement.x, placement.y, placement.z]} rotation={[0, placement.rotation, 0]}>
      <mesh position={[0, 0, EPAISSEUR / 2]}>
        <boxGeometry args={[CARTEL_LARGEUR, HAUTEUR, EPAISSEUR]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.9} />
      </mesh>
      {/* La plaque d'abord ; le texte quand sa police est là. */}
      <Suspense fallback={null}>
        <Text
          position={[-CARTEL_LARGEUR / 2 + 0.02, 0, EPAISSEUR + 0.001]}
          fontSize={0.022}
          lineHeight={1.3}
          color={THEME_INK.classic}
          anchorX="left"
          anchorY="middle"
          maxWidth={CARTEL_LARGEUR - 0.04}
        >
          {texte}
        </Text>
      </Suspense>
    </group>
  )
}
