/**
 * Lire les VRAIS `.glb` commités (sorties de `tools/blender`) hors navigateur,
 * pour les confronter aux cotes du plan : `@gltf-transform/core` et le
 * décodeur Draco de `draco3d`, comme `tools/compresser-glb.ts`. Les textures
 * (KTX2 comprises) restent des octets : seule la géométrie compte ici.
 *
 * Les sommets sont rendus en coordonnées du fichier (glTF : y en haut), qui
 * sont celles du plan (Babylon, main droite, les prend telles quelles, glb.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NodeIO, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3d'

type V3 = [number, number, number]
export interface Boite { min: V3; max: V3 }

let io: Promise<NodeIO> | null = null

export async function lireGlb(chemin: string): Promise<Document> {
  io ??= draco3d.createDecoderModule({}).then((d) => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': d }))
  return (await io).readBinary(new Uint8Array(readFileSync(resolve(process.cwd(), 'public/assets', chemin))))
}

/** Le premier nœud de ce nom (Blender exporte des noms uniques). */
export function noeud(doc: Document, nom: string): Node {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === nom)
  if (!n) throw new Error(`nœud « ${nom} » absent`)
  return n
}

/** Les racines de la scène. */
export const racines = (doc: Document): Node[] => doc.getRoot().getDefaultScene()?.listChildren() ?? doc.getRoot().listScenes()[0].listChildren()

/**
 * Les sommets des maillages sous `noeuds` (eux compris), en monde. `avant` :
 * une transformation de plus, appliquée après la matrice monde (poser une pièce à sa place).
 */
export function sommets(noeuds: Node | Node[], avant: (p: V3) => V3 = (p) => p): V3[] {
  const out: V3[] = []
  const visiter = (n: Node) => {
    const mesh = n.getMesh()
    if (mesh) {
      const m = n.getWorldMatrix()
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!
        const p: number[] = []
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, p)
          const [x, y, z] = p
          out.push(avant([
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          ]))
        }
      }
    }
    n.listChildren().forEach(visiter)
  }
  ;[noeuds].flat().forEach(visiter)
  return out
}

export function boite(points: readonly V3[]): Boite {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k])
      max[k] = Math.max(max[k], p[k])
    }
  return { min, max }
}
