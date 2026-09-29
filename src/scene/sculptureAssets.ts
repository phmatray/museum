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
 * Les projecteurs d'une pièce exposée, FAUX et gratuits : deux lumières
 * directionnelles ajoutées au seul shader de la pièce, dans le repère du monde.
 * Une clé, de face, en haut à gauche, qui fait briller le poli ; un contre-jour,
 * de derrière et d'en haut, qui détache la silhouette du panneau. Aucune
 * `SpotLight` de three : chacune coûterait une boucle de plus à TOUS les
 * matériaux de la scène (et une recompilation), pour trois objets.
 */
const PROJECTEURS = {
  cle: { direction: new THREE.Vector3(-0.45, 0.8, 0.9).normalize(), couleur: new THREE.Color('#fff0d8').multiplyScalar(3.2) },
  contre: { direction: new THREE.Vector3(0.35, 0.75, -0.8).normalize(), couleur: new THREE.Color('#ffe6c0').multiplyScalar(3.2) },
}
/** Les reflets de la salle sur le bronze : plus francs que sur le reste. */
const REFLETS = 1.8

/** Greffe les deux projecteurs sur le matériau d'une pièce, par-dessus toute greffe déjà posée. */
function eclairer(m: THREE.MeshStandardMaterial): void {
  const avant = m.onBeforeCompile.bind(m)
  const cleAvant = m.customProgramCacheKey()
  m.onBeforeCompile = (s, r) => {
    avant(s, r)
    s.uniforms.uCleDir = { value: PROJECTEURS.cle.direction }
    s.uniforms.uCleCouleur = { value: PROJECTEURS.cle.couleur }
    s.uniforms.uContreDir = { value: PROJECTEURS.contre.direction }
    s.uniforms.uContreCouleur = { value: PROJECTEURS.contre.couleur }
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCleDir, uCleCouleur, uContreDir, uContreCouleur;')
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
  {
    IncidentLight projecteur;
    projecteur.visible = true;
    projecteur.direction = normalize((viewMatrix * vec4(uCleDir, 0.0)).xyz);
    projecteur.color = uCleCouleur;
    RE_Direct(projecteur, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    projecteur.direction = normalize((viewMatrix * vec4(uContreDir, 0.0)).xyz);
    projecteur.color = uContreCouleur;
    RE_Direct(projecteur, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }`,
      )
  }
  m.customProgramCacheKey = () => `${cleAvant}|projecteurs-sculpture`
  m.envMapIntensity = REFLETS
  m.needsUpdate = true
}

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
      const piece = (await gltf.loadAsync(`${base}assets/sculptures/${fichier}`)).scene
      piece.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) eclairer(o.material)
      })
      pieces.set(fichier, piece)
    } catch (erreur) {
      // Une pièce manquante n'emporte pas les autres.
      console.warn(`sculpture « ${fichier} » introuvable`, erreur)
    }
  }
  // Le décodeur garde un worker vivant tant qu'on ne le libère pas.
  draco.dispose()
  return pieces
}
