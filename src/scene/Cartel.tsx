/**
 * Un cartel : une plaque claire et trois lignes de texte, posées sur le mur.
 * `plan/cartels.ts` a décidé où et quoi écrire.
 */
import { Suspense } from 'react'
import { Text } from '@react-three/drei'

import { CARTEL_LARGEUR, type CartelPlacement } from '../plan/cartels'
import { CARTEL_FONT, PLAQUE, THEME_INK } from './cartelStyle'

const EPAISSEUR = PLAQUE.epaisseur

export function Cartel({ placement, texte }: { placement: CartelPlacement; texte: string }) {
  return (
    <group position={[placement.x, placement.y, placement.z]} rotation={[0, placement.rotation, 0]}>
      {/* La plaque est dans le lot de `CartelLayer` ; ici, le texte, quand sa police est là. */}
      <Suspense fallback={null}>
        <Text
          font={CARTEL_FONT}
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
