/**
 * Les matières du jardin japonais que Blender ne peut pas porter : l'eau qui
 * frémit, la cascade qui coule, et le sol creusé habillé de la pelouse du parc.
 *
 * Tout est calculé ici, rien n'est téléchargé : une carte de normales de
 * 128 px faite de sinus entiers (elle se répète sans couture) et une carte
 * d'alpha en filets pour la chute d'eau.
 */
import * as THREE from 'three'

import { rider } from './intemperies'

/** Des vaguelettes : une somme de sinus à fréquences ENTIÈRES, donc une tuile sans raccord. */
function carteDeVaguelettes(n = 128): THREE.DataTexture {
  const ondes = [[3, 1, 0.9, 0.3], [1, 4, 0.7, 1.7], [5, -3, 0.35, 2.9], [-2, 7, 0.25, 0.8], [8, 5, 0.15, 4.1]]
  const h = (x: number, y: number) =>
    ondes.reduce((s, [kx, ky, a, p]) => s + a * Math.sin((2 * Math.PI * (kx * x + ky * y)) / n + p), 0)
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [dx, dy] = [(h(x + 1, y) - h(x - 1, y)) / 2, (h(x, y + 1) - h(x, y - 1)) / 2]
      const l = Math.hypot(dx, dy, 1)
      const i = (y * n + x) * 4
      data.set([((-dx / l) * 0.5 + 0.5) * 255, ((-dy / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], i)
    }
  }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/** Des filets d'eau verticaux, plus ou moins opaques : la nappe de la cascade (alphaMap lit le vert). */
function carteDeFilets(n = 64): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4)
  for (let x = 0; x < n; x++) {
    const filet = 0.7 + 0.3 * Math.sin(x * 0.45) * Math.sin(x * 0.19 + 1.3)
    for (let y = 0; y < n; y++) {
      const v = Math.max(0, Math.min(1, filet * (0.75 + 0.25 * Math.sin((y / n) * Math.PI * 6 + x))))
      data.set([v * 255, v * 255, v * 255, 255], (y * n + x) * 4)
    }
  }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

const CIEL_JOUR = new THREE.Color('#5d746c')
const CIEL_NUIT = new THREE.Color('#0b1224')

export interface MatieresJardin {
  eau: THREE.MeshStandardMaterial
  cascade: THREE.MeshStandardMaterial
  /** À chaque image : l'eau dérive, la cascade tombe, le reflet suit le ciel (`jour` ∈ [0, 1]). */
  animer: (t: number, jour: number) => void
  dispose: () => void
}

export function creerMatieresJardin(): MatieresJardin {
  const vaguelettes = carteDeVaguelettes()
  // Presque noire, verte en profondeur : c'est le reflet qui fait l'eau, pas sa couleur.
  const eau = new THREE.MeshStandardMaterial({
    name: 'jardin:eau',
    color: '#16291d',
    roughness: 0.1,
    metalness: 0.1,
    normalMap: vaguelettes,
    normalScale: new THREE.Vector2(0.14, 0.14),
    envMapIntensity: 0.45,
  })
  // Le reflet du ciel, au rasant : `scene.environment` est un studio neutre, pas
  // le ciel du parc. Un terme de Fresnel qui tire l'eau vers la couleur du ciel
  // de l'heure — sombre sous les pieds, claire au loin, comme un vrai étang.
  const ciel = { value: CIEL_JOUR.clone() }
  eau.onBeforeCompile = (shader) => {
    shader.uniforms.uCiel = ciel
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCiel;')
      .replace(
        '#include <opaque_fragment>',
        `float fresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
         outgoingLight = mix(outgoingLight, uCiel, fresnel * 0.6);
         #include <opaque_fragment>`,
      )
  }
  eau.customProgramCacheKey = () => 'jardin:eau'
  // Et les ronds de la pluie sur l'étang.
  rider(eau)

  const filets = carteDeFilets()
  const cascade = new THREE.MeshStandardMaterial({
    name: 'jardin:cascade',
    color: '#e8f2ee',
    roughness: 0.35,
    alphaMap: filets,
    transparent: true,
    opacity: 0.7,
    emissive: '#5a6a66',
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  return {
    eau,
    cascade,
    animer: (t, jour) => {
      ciel.value.copy(CIEL_NUIT).lerp(CIEL_JOUR, jour)
      vaguelettes.offset.set(t * 0.012, t * 0.007)
      filets.offset.set(0, t * 0.9)
    },
    dispose: () => {
      for (const m of [eau, cascade]) m.dispose()
      for (const t of [vaguelettes, filets]) t.dispose()
    },
  }
}

/**
 * Couvre de mousse le dessus d'un rocher : les textures Poly Haven sont d'une
 * pierre brune, et c'est la mousse, sur les faces tournées vers le ciel, qui
 * fait un rocher de jardin japonais. La pierre qui reste passe au gris.
 *
 * La normale lue est celle de l'OBJET : les rochers ne tournent qu'autour de la
 * verticale, sa composante y est donc celle du monde.
 */
export function mousser(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMousse;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvMousse = normalize(objectNormal).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMousse;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
         vec3 pierre = mix(diffuseColor.rgb, vec3(lum) * vec3(0.92, 0.95, 0.9), 0.6);
         vec3 mousse = vec3(0.16, 0.24, 0.07) * (0.6 + 1.6 * lum);
         diffuseColor.rgb = mix(pierre, mousse, smoothstep(0.25, 0.75, vMousse + (lum - 0.3) * 0.8));`,
      )
  }
  m.customProgramCacheKey = () => 'jardin:mousse'
  m.needsUpdate = true
}

/**
 * UV « de boîte » en mètres, pour les pièces que Blender livre sans UV : chaque
 * face prend la projection du plan qui lui fait face. Assez pour qu'une
 * matière du musée (pierre, bois) s'y pose à la bonne échelle.
 */
export function uvBoite(g: THREE.BufferGeometry, echelle = 1): void {
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const [p, n] = [g.getAttribute('position'), g.getAttribute('normal')]
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const [ax, ay, az] = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv[2 * i] = u / echelle
    uv[2 * i + 1] = v / echelle
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** La berge fonce et verdit en descendant vers l'eau : la terre mouillée, la mousse. */
const BERGE = new THREE.Color('#4a5a2c')

/**
 * Prépare le sol creusé pour la pelouse du parc : UV en mètres lues sur le plan
 * (comme les dalles de ParkLayer) et une couleur par sommet qui assombrit la
 * berge. Et l'eau : UV en mètres, pour que les vaguelettes aient partout la même taille.
 */
export function preparerSol(g: THREE.BufferGeometry, eau: boolean): void {
  const p = g.getAttribute('position')
  const uv = new Float32Array(p.count * 2)
  const couleur = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    ;[uv[2 * i], uv[2 * i + 1]] = eau ? [x / 3, z / 3] : [x, z]
    c.setRGB(1, 1, 1).lerp(BERGE, Math.min(1, Math.max(0, (-y - 0.05) / 0.25)))
    couleur.set([c.r, c.g, c.b], 3 * i)
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (!eau) g.setAttribute('color', new THREE.BufferAttribute(couleur, 3))
}
