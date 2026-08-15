/**
 * LOT 4 — Le mobilier et la végétation à l'écran (spec §9.4).
 *
 * Ce composant NE DÉCIDE RIEN. `domain/props.ts` a posé chaque banc, chaque bac
 * et chaque projecteur ; `propAssets.ts` a réduit les modèles à des couples
 * (géométrie, matériau). Il ne reste qu'à les donner au GPU sans faire exploser
 * le budget.
 *
 * ── Pourquoi de l'instanciation, et pas un maillage par pièce ──
 *
 * Le placement produit deux cent cinquante pièces sur le bâtiment réel, dont
 * une centaine de projecteurs. Rendues une par une, ce seraient deux cent
 * cinquante draw calls à elles seules — le budget du §9 en compte cent
 * cinquante POUR TOUT LE MUSÉE. Instanciées, les mêmes pièces tiennent en NEUF
 * lots : un par type de prop, plus un second pour la seule espèce à porter deux
 * matériaux (un pot en terre cuite, un feuillage masqué).
 *
 * ── Une seule couche, et pas une par étage — mesuré ──
 *
 * Le §9.3 recommande un jeu d'instances PAR ÉTAGE, pour qu'un plateau hors
 * champ se saute d'un bloc. Écrit d'abord ainsi, puis mesuré sur le bâtiment
 * réel, ça donnait 32 draw calls contre 9, et zéro gain : la sonde
 * `__MUSEUM__.stats()` montre les QUATRE plateaux `inFrustum: true` depuis
 * l'intérieur d'une salle du premier étage. C'est structurel — la boîte d'un
 * plateau inclut le volume balayé par son ombre jusqu'au sol du bâtiment
 * (`shadowSweptBox`), et le musée entier tient dans trente mètres de côté :
 * dès qu'on en voit un morceau, on voit la boîte de tous les niveaux.
 *
 * Les 23 draw calls du découpage payaient donc pour un culling qui ne se
 * déclenche jamais. Même parti que `CartelLayer`, pour la même raison : une
 * couche unique quand le découpage ne coupe rien. Le coût en triangles, lui,
 * a été mesuré nul — 62 im/s avec les props, 62 sans.
 *
 * ── Ce que ce calque n'ajoute pas ──
 *
 * Aucune lumière. Les projecteurs du plafond sont des OBJETS, pas des sources :
 * le §9.2 le dit et le §9.4 le confirme, l'éclairage des toiles est peint dans
 * le shader des œuvres. Cent projecteurs émetteurs ne tourneraient nulle part,
 * et le budget de douze lumières est déjà réparti ailleurs.
 *
 * Aucune ombre portée non plus : la seule shadow map du bâtiment est celle de la
 * verrière zénithale. Les props la REÇOIVENT (`receiveShadow`) — sans quoi une
 * plante posée dans le puits de lumière brillerait à travers l'ombre de la
 * dalle — mais n'en projettent pas.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { PropId, PropPlacement } from '../domain/props'
import { PROP_IDS, placeProps } from '../domain/props'
import { emprisesDeSculptures, placeSculptures } from '../domain/sculptures'
import type { Museum } from '../domain/types'
import type { PropAssets, PropPiece } from './propAssets'
import { propAssetsResource } from './propAssets'

export interface PropsLayerProps {
  museum: Museum
}

/** Le mobilier et la végétation du bâtiment entier. */
export function PropsLayer({ museum }: PropsLayerProps) {
  const assets = usePropAssets()

  // Les emprises des pièces en volume sont réservées AVANT que quoi que ce soit
  // ne soit semé.
  //
  // C'est une GARDE, pas la correction d'une collision constatée : mesuré,
  // aucun des 40 props du rez-de-chaussée ne tombe au centre de la salle
  // d'honneur. Mais `poserLesSocles` pose un socle au centre EXACT de toute
  // salle entre 70 et 150 m², et l'aire des salles dérive du nombre de dépôts,
  // qui change à chaque build — treize salles du musée actuel sont déjà dans ce
  // cas. La preuve du mécanisme vit dans `sculptures.test.ts`, sur une salle au
  // centre réellement occupé.
  const parType = useMemo(
    () => grouperParType(placeProps(museum, emprisesDeSculptures(placeSculptures(museum)))),
    [museum],
  )

  if (assets === null) return null

  return (
    <group name="props">
      {PROP_IDS.map((id) => {
        const placements = parType.get(id)
        const lots = assets.get(id)
        if (placements === undefined || lots === undefined) return null
        return lots.map((lot, index) => (
          <PropInstances key={`${id}:${index}`} piece={lot} placements={placements} />
        ))
      })}
    </group>
  )
}

// ── Un lot d'instances ───────────────────────────────────────────────────

interface PropInstancesProps {
  piece: PropPiece
  placements: readonly PropPlacement[]
}

function PropInstances({ piece, placements }: PropInstancesProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const noeud = mesh.current
    if (noeud === null) return

    const matrice = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const echelle = new THREE.Vector3()
    const axeY = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]
      position.set(p.position.x, p.position.y, p.position.z)
      quaternion.setFromAxisAngle(axeY, p.rotation)
      echelle.setScalar(p.scale)
      noeud.setMatrixAt(i, matrice.compose(position, quaternion, echelle))
    }
    noeud.instanceMatrix.needsUpdate = true
    // Sans sphère englobante recalculée, three teste le frustum sur la géométrie
    // d'UNE pièce à l'origine : le lot entier disparaîtrait dès que le point
    // (0, 0, 0) sort du champ — c'est-à-dire presque toujours.
    noeud.computeBoundingSphere()
  }, [placements])

  return (
    <instancedMesh
      ref={mesh}
      args={[piece.geometry, piece.material, placements.length]}
      castShadow={false}
      receiveShadow
    />
  )
}

// ── Chargement ───────────────────────────────────────────────────────────

/**
 * Les modèles, sans suspendre.
 *
 * Même parti que l'atlas des œuvres (lot 3) : `use()` resuspendrait l'arbre
 * ENTIER sous le `<Suspense>` du canvas — physique et joueur compris — après
 * que le musée est déjà affiché. Le bâtiment apparaît d'abord, il se meuble
 * ensuite ; un état local dit exactement cela et ne fait clignoter personne.
 */
function usePropAssets(): PropAssets | null {
  const [assets, setAssets] = useState<PropAssets | null>(null)

  useEffect(() => {
    let vivant = true
    void propAssetsResource().then((charges) => {
      if (vivant) setAssets(charges)
    })
    return () => {
      vivant = false
    }
  }, [])

  return assets
}

// ── Outils ───────────────────────────────────────────────────────────────

/**
 * Un lot par type, pour le niveau demandé.
 *
 * L'ordre des placements à l'intérieur d'un lot est celui de `placeProps`, qui
 * est contractuel : l'index d'instance est donc stable d'un rendu à l'autre, ce
 * qui rend les matrices comparables entre deux sessions — et une régression de
 * placement visible dans un diff plutôt que seulement à l'œil.
 */
function grouperParType(
  placements: readonly PropPlacement[],
): ReadonlyMap<PropId, PropPlacement[]> {
  const groupes = new Map<PropId, PropPlacement[]>()
  for (const placement of placements) {
    const liste = groupes.get(placement.id)
    if (liste === undefined) groupes.set(placement.id, [placement])
    else liste.push(placement)
  }
  return groupes
}
