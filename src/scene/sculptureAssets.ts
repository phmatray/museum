/**
 * LOT SCULPTURES — le chargement des pièces en volume.
 *
 * `domain/sculptures.ts` a décidé OÙ. Ce module dit AVEC QUOI : il ramène les
 * GLB commités et les rend tels quels.
 *
 * ── Pourquoi on ne réduit rien, contrairement à `propAssets.ts` ──
 *
 * `propAssets` fusionne les primitives d'un prop en une géométrie à couleurs de
 * sommet, parce qu'un banc est instancié vingt fois et que chaque matière de
 * plus coûte un lot d'instances. Une sculpture est UNIQUE : il n'y a rien à
 * instancier, donc rien à gagner à fusionner — et beaucoup à perdre, puisque la
 * fusion jette les cartes, c'est-à-dire tout ce qui fait exister une
 * reconstruction photogrammétrique.
 *
 * Le fichier arrive déjà à la bonne échelle, ancré au sol et orienté : c'est
 * `tools/blender/build-sculptures.py` qui le garantit, et
 * `__tests__/sculptureAssets.test.ts` qui le vérifie sur le fichier réel.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Les pièces chargées, indexées par nom de fichier. Vide si tout a échoué. */
export type SculptureAssets = ReadonlyMap<string, THREE.Object3D>

export const SCULPTURE_DIR = 'assets/sculptures/'
export const DRACO_PATH = 'draco/'

/**
 * Budget de triangles d'une pièce, et le chiffre que le test fait respecter.
 *
 * Regardé et non estimé : trois décimations rendues de face à 2 m, œil à
 * 1,62 m. À 8 000 le plaid et la lisse du fauteuil facettent ; à 40 000 l'écart
 * avec 18 000 est invisible pour 2,2 fois le coût.
 */
export const SCULPTURE_BUDGET_TRIANGLES = 18_000

const cache = new Map<string, Promise<SculptureAssets>>()

/**
 * Charge les pièces demandées, une fois par jeu de fichiers.
 *
 * Mémorisé comme `propAssetsResource()` : sans ça, un remontage du calque
 * retéléchargerait le fichier.
 */
export function sculptureAssetsResource(
  fichiers: readonly string[],
  base: string = import.meta.env.BASE_URL,
): Promise<SculptureAssets> {
  const cle = `${base}|${[...fichiers].sort().join(',')}`
  let promesse = cache.get(cle)
  if (promesse === undefined) {
    promesse = charger(fichiers, base).catch((erreur: unknown) => {
      // Le musée reste visitable sans ses sculptures : on le signale, on ne fait
      // pas tomber la scène. Même parti que l'atlas des œuvres et le mobilier.
      console.error('sculptures indisponibles', erreur)
      return new Map<string, THREE.Object3D>()
    })
    cache.set(cle, promesse)
  }
  return promesse
}

async function charger(
  fichiers: readonly string[],
  base: string,
): Promise<SculptureAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}${DRACO_PATH}`)
  gltf.setDRACOLoader(draco)

  const pieces = new Map<string, THREE.Object3D>()
  for (const fichier of fichiers) {
    try {
      const charge = await gltf.loadAsync(`${base}${SCULPTURE_DIR}${fichier}`)
      // Les pièces ne projettent pas d'ombre — la seule shadow map du bâtiment
      // est celle de la verrière (§9.2) — mais elles en REÇOIVENT, sans quoi une
      // pièce posée dans le puits de lumière brillerait à travers l'ombre de la
      // dalle. Même réglage que les props.
      charge.scene.traverse((objet) => {
        if (objet instanceof THREE.Mesh) {
          objet.castShadow = false
          objet.receiveShadow = true
        }
      })
      pieces.set(fichier, charge.scene)
    } catch (erreur) {
      // Une pièce manquante ne doit pas emporter les autres : elles sont
      // indépendantes, et une config qui en déclare trois doit en montrer deux.
      console.warn(`sculpture « ${fichier} » introuvable`, erreur)
    }
  }

  // Le décodeur garde un worker vivant tant qu'on ne le libère pas.
  draco.dispose()
  return pieces
}
