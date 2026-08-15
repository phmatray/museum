/**
 * LOT SCULPTURES — les pièces en volume à l'écran.
 *
 * Ce composant NE DÉCIDE RIEN : `domain/sculptures.ts` a posé chaque pièce,
 * `builders/plinth.ts` a fabriqué son socle, `sculptureAssets.ts` a chargé son
 * modèle.
 *
 * ── UNE couche, pas une par étage ──
 *
 * Même parti que `CartelLayer` et `PropsLayer`, et pour la raison MESURÉE que
 * l'en-tête de `PropsLayer` documente : découpés par étage, les props coûtaient
 * 32 draw calls contre 9 sans jamais rien économiser, parce que la boîte d'un
 * plateau inclut le volume balayé par son ombre et que les quatre niveaux sont
 * dans le frustum en même temps depuis presque partout. Ici la question ne se
 * pose même pas — il y a une pièce.
 *
 * ── Le collider, une rupture assumée ──
 *
 * `PropsLayer` n'en pose AUCUN : on traverse les bancs, les socles et les
 * plantes du musée. Cette pièce-ci en reçoit un, et c'est délibéré — c'est la
 * seule chose du bâtiment que le visiteur est explicitement invité à approcher
 * et à contourner, et la traverser serait le défaut le plus visible du musée.
 * Un cuboïde sur l'emprise du socle : une boîte convexe, ce que le contrôleur
 * cinématique gère le mieux.
 *
 * Poser des colliders sur les props existants est une décision qui les concerne
 * TOUS et qui se prendra pour eux — pas dans le sillage d'une pièce.
 */
import { useEffect, useMemo, useState } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { buildPlinth } from '../builders/plinth'
import type { SculpturePlacement } from '../domain/sculptures'
import type { Museum, ThemeId } from '../domain/types'
import { SculptureCartel } from './SculptureCartel'
import { matiereDeDalle, useMatiere } from './materials'
import type { SculptureAssets } from './sculptureAssets'
import { sculptureAssetsResource } from './sculptureAssets'
import { useSculpturePlacements } from './useSculpturePlacements'

export interface SculptureLayerProps {
  museum: Museum
}

export function SculptureLayer({ museum }: SculptureLayerProps) {
  /*
    ⚠️ CONTRAT AVEC `PropsLayer` : ce qu'il RÉSERVE
    (`emprisesDeSculptures(useSculpturePlacements(museum))`, dans son propre
    fichier) doit être EXACTEMENT ce qu'on DESSINE ici. Les deux calques
    consommaient chacun leur propre appel à `placeSculptures(museum)` ; le
    hook partagé les fait maintenant lire la MÊME liste. Une divergence entre
    les deux serait silencieuse — aucun test, aucun avertissement, juste un
    socle qui pousse à travers un banc ou une place réservée qui reste vide
    à côté de la pièce.
  */
  const placements = useSculpturePlacements(museum)
  const fichiers = useMemo(() => placements.map((p) => p.file), [placements])
  const assets = useSculptureAssets(fichiers)

  if (placements.length === 0) return null

  return (
    <group name="sculptures">
      {placements.map((placement) => (
        <UneSculpture
          key={placement.id}
          placement={placement}
          objet={assets?.get(placement.file) ?? null}
          theme={themeDeSalle(museum, placement)}
        />
      ))}
    </group>
  )
}

interface UneSculptureProps {
  placement: SculpturePlacement
  objet: import('three').Object3D | null
  theme: ThemeId
}

function UneSculpture({ placement, objet, theme }: UneSculptureProps) {
  const { plinth } = placement
  // ⚠️ L'ORDRE DES TROIS COTES. `buildPlinth(width, depth, height)` n'a pas le
  // même que `BoxGeometry(width, height, depth)` qu'il appelle, et le socle de
  // Bavette est CARRÉ (1,10 × 1,10) : une permutation des deux premiers
  // arguments ne se verrait donc ni à l'écran ni dans un test. Les trois
  // propriétés sont nommées à l'appel pour que l'erreur soit au moins visible
  // en relecture. Ne jamais réécrire cet appel avec des littéraux.
  const socle = useMemo(
    () => buildPlinth(plinth.width, plinth.depth, plinth.height),
    [plinth.width, plinth.depth, plinth.height],
  )
  // Le socle porte la matière du sol du rez-de-chaussée — marbre
  // (`matiereDeDalle(0)`). Un socle de musée est du même matériau que le
  // lieu : c'est ce qui le fait lire comme un élément du bâtiment et non
  // comme un meuble posé là.
  const matiere = useMatiere(matiereDeDalle(0))

  // La géométrie du socle est allouée par ce composant : sans libération, chaque
  // rechargement à chaud en laisse une en VRAM.
  useEffect(() => () => socle.geometry.dispose(), [socle])

  const { x, y, z } = placement.position

  return (
    <>
      {/*
        ⚠️ LE CARTEL EST DEHORS, et c'est une décision.

        `SculptureCartel` lit `placement.position` comme des coordonnées MONDE —
        c'est ce que le type documente. Le monter DANS le groupe déjà translaté
        ci-dessous l'aurait décalé deux fois, et la parade évidente — lui passer
        un placement dont la position est remise à zéro — marche mais pose un
        piège : un composant qui exige qu'on lui mente sur son entrée casse en
        silence au premier qui déplace la ligne. Frère du groupe plutôt
        qu'enfant, il reçoit le placement RÉEL et personne n'a rien à compenser.
      */}
      <SculptureCartel placement={placement} theme={theme} />

      <group position={[x, y, z]}>
        <mesh geometry={socle.geometry} material={matiere} castShadow={false} receiveShadow />

        {/*
          La pièce est déjà à l'échelle, ancrée au sol et orientée vers +Z :
          c'est `build-sculptures.py` qui le garantit et
          `sculptureAssets.test.ts` qui le vérifie sur le fichier réel. Il ne
          reste qu'à la monter sur son socle et à lui donner son lacet.
        */}
        {objet !== null && (
          <group position={[0, plinth.height, 0]} rotation={[0, placement.rotation, 0]}>
            <primitive object={objet} />
          </group>
        )}

        {/*
          Le collider couvre le socle ET la pièce. `CuboidCollider` prend des
          DEMI-dimensions, et son origine est son centre — d'où le décalage
          d'une demi-hauteur.

          ⚠️ L'ORDRE DES TROIS DEMI-COTES : `args` est positionnel, et le socle
          de Bavette est CARRÉ (1,10 × 1,10). Intervertir la largeur et la
          profondeur ne se verrait donc ni à l'écran ni dans un test — c'est le
          motif trouvé DEUX fois dans ce lot. `scene/__tests__/` a cinq suites,
          dont `propAssets.test.ts`, frère direct de ce fichier — mais aucune
          ne REND un composant R3F (`@react-three/test-renderer` n'est pas une
          dépendance du projet), donc rien n'exécute jamais ce JSX en test.
          L'ordre est `[x, y, z]`, donc `[largeur/2, hauteur/2, profondeur/2]`.
        */}
        <RigidBody type="fixed" colliders={false} name={`sculpture:${placement.id}`}>
          <CuboidCollider
            args={[
              plinth.width / 2,
              (plinth.height + placement.height) / 2,
              plinth.depth / 2,
            ]}
            position={[0, (plinth.height + placement.height) / 2, 0]}
          />
        </RigidBody>
      </group>
    </>
  )
}

/** Le thème de la salle qui accueille la pièce ; `classic` si elle a disparu. */
function themeDeSalle(museum: Museum, placement: SculpturePlacement): ThemeId {
  for (const floor of museum.floors) {
    const room = floor.rooms.find((r) => r.id === placement.roomId)
    if (room !== undefined) return room.theme
  }
  return 'classic'
}

/**
 * Les modèles, sans suspendre.
 *
 * Même parti que `usePropAssets` : `use()` resuspendrait l'arbre ENTIER sous le
 * `<Suspense>` du canvas — physique et joueur compris — après que le musée est
 * déjà affiché. Le bâtiment apparaît d'abord, la pièce ensuite.
 */
function useSculptureAssets(fichiers: readonly string[]): SculptureAssets | null {
  const [assets, setAssets] = useState<SculptureAssets | null>(null)
  const cle = fichiers.join(',')

  useEffect(() => {
    let vivant = true
    void sculptureAssetsResource(cle === '' ? [] : cle.split(',')).then((charges) => {
      if (vivant) setAssets(charges)
    })
    return () => {
      vivant = false
    }
  }, [cle])

  return assets
}
