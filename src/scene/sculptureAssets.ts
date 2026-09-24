/**
 * Le chargement des sculptures : les GLB commités, rendus tels quels.
 *
 * Repris de l'ancien bâtiment (#29). Une sculpture est UNIQUE : rien à
 * instancier, donc rien à fusionner — et la fusion jetterait les cartes, tout
 * ce qui fait exister une reconstruction photogrammétrique. Le fichier arrive
 * déjà à l'échelle, ancré au sol et tourné vers +Z (`tools/blender/build-sculptures.py`).
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Les pièces chargées, par nom de fichier. Vide si tout a échoué. */
export type SculptureAssets = ReadonlyMap<string, THREE.Object3D>

const cache = new Map<string, Promise<SculptureAssets>>()

/**
 * Mémorisé par jeu de fichiers : un remontage ne retélécharge rien. Sous
 * `BASE_URL`, comme les toiles : le site est servi sous `/museum/`.
 */
export function sculptureAssetsResource(fichiers: readonly string[], base: string = import.meta.env.BASE_URL): Promise<SculptureAssets> {
  const cle = `${base}|${[...fichiers].sort().join(',')}`
  let promesse = cache.get(cle)
  if (promesse === undefined) {
    promesse = charger(fichiers, base).catch((erreur: unknown) => {
      // Le musée reste visitable sans ses sculptures.
      console.error('sculptures indisponibles', erreur)
      return new Map<string, THREE.Object3D>()
    })
    cache.set(cle, promesse)
  }
  return promesse
}

async function charger(fichiers: readonly string[], base: string): Promise<SculptureAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}draco/`)
  gltf.setDRACOLoader(draco)
  const pieces = new Map<string, THREE.Object3D>()
  for (const fichier of fichiers) {
    try {
      pieces.set(fichier, (await gltf.loadAsync(`${base}assets/sculptures/${fichier}`)).scene)
    } catch (erreur) {
      // Une pièce manquante n'emporte pas les autres.
      console.warn(`sculpture « ${fichier} » introuvable`, erreur)
    }
  }
  // Le décodeur garde un worker vivant tant qu'on ne le libère pas.
  draco.dispose()
  return pieces
}
