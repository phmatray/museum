/**
 * LOT 9 — Le décor d'architecture à l'écran.
 *
 * Ce composant NE DÉCIDE RIEN. `domain/decor.ts` a posé chaque nervure ;
 * `decorAssets.ts` les a fusionnées en une géométrie unique. Il ne reste qu'à la
 * donner au GPU.
 *
 * ── Un seul maillage, un seul draw call ──
 *
 * Tout le décor du bâtiment tient dans UN `<mesh>`. C'est la raison d'être de la
 * fusion (voir `decorAssets.ts`) : sur un compteur relevé à 259 pour un plafond
 * de 150, une pièce d'architecture ne peut pas se permettre son propre lot.
 *
 * ⚠️ Le maillage reste à l'IDENTITÉ, sans position ni rotation. La géométrie
 * fusionnée est déjà en coordonnées monde ; le moindre décalage sur ce nœud
 * déplacerait le décor entier du bâtiment.
 *
 * ── Pas de culling par étage, et c'est mesuré ──
 *
 * Le §9.3 recommande un jeu par plateau. `PropsLayer` a essayé et l'a rejeté sur
 * mesure : 32 draw calls contre 9 pour zéro gain, parce que la boîte d'un
 * plateau inclut le volume balayé par son ombre et que le musée tient dans
 * trente mètres — dès qu'on en voit un morceau, les quatre boîtes sont dans le
 * champ. Ici l'argument est plus fort encore : découper le lot fusionné lui
 * rendrait exactement le draw call qu'il existe pour économiser.
 *
 * ── Ni ombre portée, ni lumière ──
 *
 * Règle de la maison : le soleil est le seul porteur d'ombre du musée, et sa
 * carte est déjà dépensée sur la verrière. Les nervures la REÇOIVENT — sans quoi
 * une nervure sous le puits de lumière brillerait à travers l'ombre de la dalle —
 * mais n'en projettent pas.
 */
import { useEffect, useMemo, useState } from 'react'

import { placeDecor } from '../domain/decor'
import type { DecorPlacement } from '../domain/decor'
import type { Museum } from '../domain/types'
import type { DecorAssets, DecorLot } from './decorAssets'
import { assemblerLeDecor, decorAssetsResource } from './decorAssets'

export interface DecorLayerProps {
  museum: Museum
  /**
   * Le placement, calculé par `MuseumScene` et partagé avec `PropsLayer`.
   *
   * Facultatif pour que le composant reste montable seul dans une épreuve, mais
   * la scène le fournit TOUJOURS : deux calculs séparés ne seraient pas garantis
   * d'accord, et le mobilier éviterait alors des nervures qui ne sont pas celles
   * qu'on dessine.
   */
  decor?: readonly DecorPlacement[]
}

export function DecorLayer({ museum, decor }: DecorLayerProps) {
  const assets = useDecorAssets()
  const placements = useMemo(() => decor ?? placeDecor(museum), [museum, decor])

  const lot: DecorLot | null = useMemo(
    () => (assets === null ? null : assemblerLeDecor(assets, placements)),
    [assets, placements],
  )

  // La géométrie fusionnée et son matériau sont créés ici : sans libération
  // explicite, un rechargement du musée en laisserait une copie sur le GPU.
  useEffect(() => {
    if (lot === null) return
    return () => {
      lot.geometry.dispose()
      lot.material.dispose()
    }
  }, [lot])

  if (lot === null) return null

  return (
    <group name="decor">
      <mesh geometry={lot.geometry} material={lot.material} castShadow={false} receiveShadow />
    </group>
  )
}

/**
 * Les modèles, sans suspendre.
 *
 * Même parti que `PropsLayer` : `use()` resuspendrait l'arbre ENTIER sous le
 * `<Suspense>` du canvas — physique et joueur compris — après que le musée est
 * déjà affiché. Le bâtiment apparaît d'abord, il se nervure ensuite.
 */
function useDecorAssets(): DecorAssets | null {
  const [assets, setAssets] = useState<DecorAssets | null>(null)

  useEffect(() => {
    let vivant = true
    void decorAssetsResource().then((charges) => {
      if (vivant) setAssets(charges)
    })
    return () => {
      vivant = false
    }
  }, [])

  return assets
}
