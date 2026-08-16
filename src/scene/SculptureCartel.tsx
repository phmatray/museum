/**
 * LOT SCULPTURES — le cartel posé sur un socle.
 *
 * ── Pourquoi il ne réutilise pas `Cartel.tsx` ──
 *
 * `CartelSpec` exige `key: RepoKey`, `wallId`, `u` et `side` : il est ancré sur
 * un MUR et indexé par DÉPÔT. Une pièce en volume n'a ni l'un ni l'autre. Le
 * spec annonçait une réutilisation directe ; c'était faux, et le forcer aurait
 * demandé une clé factice dans un index de dépôts — exactement l'option écartée
 * au §3 du spec pour la curation.
 *
 * Ce qui EST réutilisé, c'est ce qui doit l'être : la table d'encre
 * (`cartelStyle.ts`) et le seuil de distance de `domain/cartels.ts`. Deux
 * cartels du même bâtiment ne peuvent pas avoir deux couleurs ni deux portées.
 *
 * ── Pourquoi aucun pool ──
 *
 * `CartelLayer` gère seize cases parce qu'il y a cent œuvres. Il y a UNE pièce.
 * Un pool, une hystérésis et une cadence d'évaluation à 10 Hz seraient trois
 * mécanismes pour arbitrer entre un seul candidat et lui-même.
 */
import { useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { CARTEL_MAX_DISTANCE, CARTEL_WIDTH } from '../domain/cartels'
import type { SculpturePlacement } from '../domain/sculptures'
import { sculptureCartelText } from '../domain/sculptures'
import type { ThemeId } from '../domain/types'
import { THEME_INK } from './cartelStyle'

/**
 * Corps du texte, en mètres. Plus gros que le cartel mural (0,026) : celui-ci
 * se lit debout, en plongée, depuis un mètre et demi — pas le nez sur un mur.
 */
const TAILLE = 0.032

const INTERLIGNE = 1.35

/** Retrait du cartel par rapport à l'arête avant du socle, en mètres. */
const RETRAIT = 0.06

/** Relief du texte au-dessus du dessus du socle. */
const RELIEF = 0.004

// Vecteur de travail, alloué UNE fois au niveau du module : `useFrame` tourne
// 60 fois par seconde, et un `new THREE.Vector3()` par image suffit à nourrir
// le ramasse-miettes jusqu'au hoquet visible. Même parti que `CartelLayer`.
const positionMonde = new THREE.Vector3()

export interface SculptureCartelProps {
  placement: SculpturePlacement
  theme: ThemeId
}

/**
 * Le cartel, couché sur le dessus du socle, devant la pièce.
 *
 * Couché et non vertical : un socle de 25 cm n'a pas de joue assez haute pour
 * porter un texte lisible, et c'est de toute façon ainsi qu'on pose un cartel
 * sur un socle bas — à plat, au bord, du côté d'où l'on regarde.
 */
export function SculptureCartel({ placement, theme }: SculptureCartelProps) {
  const groupe = useRef<THREE.Group>(null)
  const texte = useMemo(() => sculptureCartelText(placement.cartel), [placement.cartel])

  // Le cartel s'éteint au-delà du seuil des cartels d'œuvre. Ce n'est pas une
  // économie de draw call — il n'y en a qu'un — c'est de la cohérence : deux
  // étiquettes du même bâtiment ne doivent pas apparaître à deux distances.
  useFrame(({ camera }) => {
    const noeud = groupe.current
    if (noeud === null) return
    const d = camera.position.distanceTo(noeud.getWorldPosition(positionMonde))
    noeud.visible = d <= CARTEL_MAX_DISTANCE
  })

  return (
    <group
      ref={groupe}
      position={[placement.position.x, placement.position.y + placement.plinth.height + RELIEF, placement.position.z]}
      rotation={[0, placement.rotation, 0]}
    >
      <Text
        // Couché sur le socle, tête vers la pièce : on le lit en baissant les
        // yeux depuis le bord du socle.
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, placement.plinth.depth / 2 - RETRAIT]}
        fontSize={TAILLE}
        lineHeight={INTERLIGNE}
        maxWidth={CARTEL_WIDTH * 2}
        anchorX="center"
        anchorY="bottom"
        textAlign="center"
        color={THEME_INK[theme]}
      >
        {texte}
      </Text>
    </group>
  )
}
