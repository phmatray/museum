/**
 * LOT 4 — Les lumières allouées (spec §9.4).
 *
 * Ce composant NE DÉCIDE RIEN : `lighting.ts` a calculé où sont les
 * plafonniers, comment ils décroissent dans le puits, lesquels méritent un
 * créneau et quand refaire le calcul. Il ne fait que verser le résultat dans des
 * objets `three`, une fois par réaffectation.
 *
 * ── Ce qu'il monte, et pourquoi le compte ne bouge jamais ──
 *
 *   n `PointLight`  les salles proches, celle qui contient le visiteur d'abord.
 *                   Une source ponctuelle, et non un projecteur : elle éclaire
 *                   les deux faces d'un angle rentrant sous des incidences
 *                   différentes, ce qui est LA seule façon de faire exister un
 *                   coin. Les flaques peintes du §9.2, elles, sont plaquées sur
 *                   une face et ignorent la géométrie voisine par construction ;
 *   m `PointLight`  le puits de l'atrium, une par trémie, d'intensité
 *                   décroissante vers le bas — c'est ce qui fait LIRE que le
 *                   rez-de-chaussée est plus sombre que le dernier étage.
 *
 * `n` et `m` sont figés au montage par `creneauxDeLumieres` et ne changent
 * plus. C'est la contrainte structurante de tout le fichier : `NUM_POINT_LIGHTS`
 * est un `#define` du shader standard, et allumer une lumière de plus en
 * marchant recompilerait les trente-cinq programmes du bâtiment au milieu d'un
 * pas. Un créneau inutilisé n'est donc pas démonté — il descend à intensité
 * nulle, et ne se voit plus.
 *
 * ── Aucune ombre ici, et c'est une mesure, pas un oubli ──
 *
 * Le §9 réservait la seconde shadow map à « la salle courante ». Elle a été
 * écrite (un `SpotLight` zénithal, cône de 74°, carte de 1024) puis mesurée :
 * +77 draw calls, et RIEN à l'image. Tout ce qu'une salle contient est
 * explicitement `castShadow={false}` — les props comme les œuvres — de sorte que
 * la passe ne rendait que les murs, qui n'ombrent qu'eux-mêmes. Voir
 * `BUDGET_OMBRES` dans `lighting.ts` : le budget est un plafond, pas un quota.
 *
 * ── Pourquoi le suivi du joueur n'est pas refait ici ──
 *
 * Le registre de culling (`floorCulling.ts`) sait déjà à quel niveau se tient le
 * visiteur, AVEC HYSTÉRÉSIS, et cette réponse doit être la même pour tout le
 * monde à un instant donné. On la lit, on ne la recalcule pas — sans elle, un
 * pas sur une rampe ferait osciller le niveau, donc sauter les six lumières
 * d'un étage à l'autre plusieurs fois par seconde. La salle, elle, vient de
 * `domain/visitor.roomAt` : la même fonction que le plan et le suivi de salle.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import type { Museum } from '../domain/types'
import { roomAt } from '../domain/visitor'
import type { FloorCulling } from './floorCulling'
import type { EtatDAllocation, SourcePlacee } from './lighting'
import {
  COULEUR_PUITS,
  COULEUR_SALLE,
  affecterCreneaux,
  choisirLumieresDePuits,
  classerLumieresDeSalles,
  creneauxDeLumieres,
  lumieresDePuits,
  lumieresDeSalles,
  reaffectationNecessaire,
} from './lighting'

export interface RoomLightsProps {
  museum: Museum
  /**
   * Le registre de culling. Fourni par `MuseumScene`, qui l'installe déjà pour
   * les plateaux : la question « où est le joueur ? » n'a qu'une réponse, et
   * elle est déjà lissée par une hystérésis.
   */
  culling: FloorCulling
}

export function RoomLights({ museum, culling }: RoomLightsProps) {
  // Catalogues : ils ne dépendent que du bâtiment, jamais de la position.
  const salles = useMemo(() => lumieresDeSalles(museum), [museum])
  const puits = useMemo(() => lumieresDePuits(museum), [museum])
  const creneaux = useMemo(() => creneauxDeLumieres(museum), [museum])

  const plafonniers = useRef<(THREE.PointLight | null)[]>([])
  const colonnes = useRef<(THREE.PointLight | null)[]>([])

  // Mémoire de la dernière réaffectation. Des `ref` et non un état React : ces
  // valeurs changent dans `useFrame`, et un `setState` par image redéclencherait
  // le rendu de tout le sous-arbre soixante fois par seconde.
  const occupants = useRef<(string | null)[]>(
    Array.from({ length: creneaux.salles }, () => null),
  )
  const precedent = useRef<EtatDAllocation | null>(null)

  useFrame(({ camera }) => {
    const oeil = camera.position
    const courant: EtatDAllocation = {
      oeil: { x: oeil.x, y: oeil.y, z: oeil.z },
      // `roomAt` rend la salle qui CONTIENT l'œil, ou `null` dans l'atrium et
      // sur les rampes. C'est elle qui est servie la première.
      salle: roomAt(museum, oeil),
      // Le niveau du registre, avec son hystérésis — et avec une image de
      // retard, que `reaffectationNecessaire` sait rattraper.
      niveau: culling.snapshot().playerLevel,
    }

    if (!reaffectationNecessaire(precedent.current, courant)) return
    precedent.current = courant

    // ── Salles ───────────────────────────────────────────────────────────
    const classees = classerLumieresDeSalles(
      salles,
      oeil,
      courant.salle,
      courant.niveau,
    )
    // La mémoire des créneaux doit avoir EXACTEMENT la taille de la réserve :
    // `affecterCreneaux` rend autant d'entrées qu'on lui en donne, et une
    // mémoire trop courte — ce qui arrive au premier rendu après un changement
    // de musée, l'éditeur du §10 ou un rechargement à chaud — laisserait les
    // derniers plafonniers éteints pour toujours.
    if (occupants.current.length !== creneaux.salles) {
      occupants.current = Array.from({ length: creneaux.salles }, () => null)
    }
    // Chaque salle retenue reste si possible dans le créneau qu'elle occupait :
    // sans cela, une salle qui recule d'un rang ferait sauter une lumière d'un
    // bout du bâtiment à l'autre en une image, ce qui se voit franchement.
    const retenues = affecterCreneaux(
      occupants.current,
      classees.slice(0, creneaux.salles),
    )
    occupants.current = retenues.map((v) => v?.roomId ?? null)

    for (let i = 0; i < plafonniers.current.length; i++) {
      poser(plafonniers.current[i], retenues[i] ?? null)
    }

    // ── Puits ────────────────────────────────────────────────────────────
    const colonne = choisirLumieresDePuits(puits, oeil.y, creneaux.puits)
    for (let i = 0; i < colonnes.current.length; i++) {
      poser(colonnes.current[i], colonne[i] ?? null)
    }
  })

  return (
    <>
      {Array.from({ length: creneaux.salles }, (_, i) => (
        <pointLight
          key={`salle-${i}`}
          ref={(noeud) => {
            plafonniers.current[i] = noeud
          }}
          color={COULEUR_SALLE}
          intensity={0}
          decay={2}
        />
      ))}

      {Array.from({ length: creneaux.puits }, (_, i) => (
        <pointLight
          key={`puits-${i}`}
          ref={(noeud) => {
            colonnes.current[i] = noeud
          }}
          color={COULEUR_PUITS}
          intensity={0}
          decay={2}
        />
      ))}
    </>
  )
}

/**
 * Verse une lumière dans un créneau, ou éteint le créneau.
 *
 * Éteindre, c'est passer l'intensité à zéro — jamais démonter la lumière ni la
 * rendre invisible : les deux changeraient le nombre de lumières que voit
 * `WebGLPrograms`, donc les `#define` du shader standard, donc tous les
 * programmes du bâtiment.
 */
function poser(point: THREE.PointLight | null, lumiere: SourcePlacee | null): void {
  if (point === null) return
  if (lumiere === null) {
    point.intensity = 0
    return
  }
  point.position.set(...lumiere.position)
  point.intensity = lumiere.intensity
  point.distance = lumiere.distance
}
