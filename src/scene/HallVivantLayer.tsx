/**
 * Ce qui vit dans la nef : la mosaïque des contributions dans l'allée, la cloche
 * de l'horloge qui annonce les nouvelles versions, et le compteur de visites de
 * l'entrée. Un seul point de montage dans `PlanBuilding`.
 */
import { ClocheLayer } from './ClocheLayer'
import { CompteurLayer } from './CompteurLayer'
import { MosaiqueLayer } from './MosaiqueLayer'

export function HallVivantLayer() {
  return (
    <>
      <MosaiqueLayer />
      <ClocheLayer />
      <CompteurLayer />
    </>
  )
}
