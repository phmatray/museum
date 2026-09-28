/**
 * Le ciel du musée, qui suit le soleil (`CycleSolaire`) : une sphère lointaine
 * qui fond le ciel de jour (kloofendal, nuageux) dans le ciel de nuit (rogland,
 * étoilé), et dore l'horizon au lever et au coucher. Deux photos Poly Haven
 * récupérées par `tools/fetch-assets.ts`.
 *
 * L'aplat de fond est posé ICI, à la main, et suit le jour : il est le fond tant
 * que les images ne sont pas là, et pour toujours si elles manquent (#46 :
 * jamais de fond noir). Pas de `<color attach="background">` : en production,
 * R3F le rattachait par-dessus le ciel (#73).
 */
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { directionDuSoleil } from '../domain/soleil'
import { useGameStore } from '../stores/gameStore'
import { INTEMPERIES } from './intemperies'
import { AMBIANCE, CIEL, SOLEIL } from './lighting'

const JOUR = 'assets/ciel/kloofendal_48d_partly_cloudy_puresky.jpg'
const NUIT = 'assets/ciel/rogland_clear_night.jpg'
const FOND_NUIT = new THREE.Color('#0b1224')

const SOMMETS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
// La même projection équirectangulaire que `EquirectangularReflectionMapping`.
const FRAGMENTS = /* glsl */ `
  uniform sampler2D jourTex;
  uniform sampler2D nuitTex;
  uniform float jour;
  uniform float crepuscule;
  uniform float charge;
  uniform float uNuages, uBrume, uEclair;
  uniform vec3 uBrumeCouleur;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    vec3 c = mix(texture2D(nuitTex, uv).rgb, texture2D(jourTex, uv).rgb, jour);
    // L'or du crépuscule, fort à l'horizon, nul au zénith.
    c *= mix(vec3(1.0), vec3(1.25, 0.72, 0.45), crepuscule * 0.75 * (1.0 - smoothstep(0.0, 0.6, abs(d.y))));
    // Couvert : le bleu s'éteint en gris, les nuages de la photo restent en relief.
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    vec3 couvert = uBrumeCouleur * (0.8 + 0.2 * smoothstep(0.3, 1.0, l / max(0.1, jour)) + 0.08 * d.y);
    c = mix(c, couvert, uNuages * 0.95);
    // Le brouillard mange l'horizon d'abord.
    c = mix(c, uBrumeCouleur, uBrume * (1.0 - 0.55 * smoothstep(0.0, 0.7, d.y)));
    c += uEclair * vec3(0.75, 0.8, 1.0);
    gl_FragColor = vec4(c, charge);
    #include <colorspace_fragment>
  }
`

export function Ciel() {
  const scene = useThree((s) => s.scene)
  const { jour, crepuscule } = useGameStore((s) => s.ciel)

  const materiau = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SOMMETS,
        fragmentShader: FRAGMENTS,
        uniforms: {
          jourTex: { value: null }, nuitTex: { value: null }, jour: { value: 1 }, crepuscule: { value: 0 }, charge: { value: 0 },
          // Le temps qu'il fait (`MeteoLayer`), partagé : réglé une fois par image, pour tout le monde.
          uNuages: INTEMPERIES.uNuages, uBrume: INTEMPERIES.uBrume, uEclair: INTEMPERIES.uEclair, uBrumeCouleur: INTEMPERIES.uBrumeCouleur,
        },
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
      }),
    [],
  )

  useEffect(() => {
    let vivant = true
    const chargeur = new THREE.TextureLoader()
    const base = import.meta.env.BASE_URL
    Promise.all([chargeur.loadAsync(`${base}${JOUR}`), chargeur.loadAsync(`${base}${NUIT}`)])
      .then((textures) => {
        if (!vivant) return textures.forEach((t) => t.dispose())
        for (const t of textures) {
          t.colorSpace = THREE.SRGBColorSpace
          // Sans mipmaps : au raccord de la projection (atan saute de −π à π), le
          // GPU prenait le plus petit niveau de mipmap sur une colonne de pixels,
          // d'où une ligne pointillée verticale dans le ciel.
          t.generateMipmaps = false
          t.minFilter = THREE.LinearFilter
        }
        materiau.uniforms.jourTex.value = textures[0]
        materiau.uniforms.nuitTex.value = textures[1]
        materiau.uniforms.charge.value = 1
      })
      .catch((erreur: unknown) => console.warn('ciel indisponible, fond uni', erreur))
    return () => {
      vivant = false
      for (const k of ['jourTex', 'nuitTex']) (materiau.uniforms[k].value as THREE.Texture | null)?.dispose()
      materiau.dispose()
    }
  }, [materiau])

  /* eslint-disable react-hooks/immutability -- le matériau et le fond sont des états de la scène three */
  useEffect(() => {
    materiau.uniforms.jour.value = jour
    materiau.uniforms.crepuscule.value = crepuscule
    scene.background = FOND_NUIT.clone().lerp(new THREE.Color(CIEL), jour)
  }, [materiau, scene, jour, crepuscule])
  /* eslint-enable react-hooks/immutability */

  // Loin, mais en deçà du plan lointain de la caméra (1000) ; dessinée avant tout.
  return (
    <mesh material={materiau} renderOrder={-1} frustumCulled={false} scale={800}>
      <sphereGeometry args={[1, 48, 24]} />
    </mesh>
  )
}

const LUNE = { couleur: new THREE.Color('#a9bcff'), intensite: 0.35 }
const OR_BAS = new THREE.Color('#ffb070')
/**
 * La nuit, le musée reste éclairé de l'intérieur par ses propres lumières,
 * chaudes : une ambiance bleu lune baignait les salles comme si elles étaient
 * fermées et éteintes. Le bleu de la nuit vient de la lune (directionnelle) et
 * du ciel, pas de l'ambiance.
 */
const AMBIANCE_NUIT = { ciel: new THREE.Color('#8a7358'), intensite: 0.8 }

/**
 * Le soleil de la scène, là où il est vraiment au-dessus du musée, doré quand
 * il rase l'horizon ; la nuit, une lune froide et fixe prend le relais.
 */
export function LumiereDuJour() {
  const { jour, crepuscule, elevation, azimut } = useGameStore((s) => s.ciel)
  // Sous un ciel couvert ou dans le brouillard, le soleil ne porte plus d'ombre franche : il s'efface.
  const voile = useGameStore((s) => Math.min(0.85, s.meteo.nuages * 0.75 + s.meteo.brouillard * 0.4))
  const soleil = useMemo(() => {
    const d = elevation > 0 ? directionDuSoleil({ elevation, azimut }) : directionDuSoleil({ elevation: 35, azimut: (azimut + 180) % 360 })
    const couleur = LUNE.couleur.clone().lerp(new THREE.Color(SOLEIL.couleur).lerp(OR_BAS, crepuscule), jour)
    return { position: [24 + d[0] * 60, d[1] * 60, 20 + d[2] * 60] as [number, number, number], couleur, intensite: (SOLEIL.intensite * jour + LUNE.intensite * (1 - jour)) * (1 - voile) }
  }, [jour, crepuscule, elevation, azimut, voile])
  const ciel = useMemo(() => AMBIANCE_NUIT.ciel.clone().lerp(new THREE.Color(AMBIANCE.ciel), jour), [jour])
  return (
    <>
      {/* En props, pas en `args` : changer d'heure ne reconstruit pas la lumière. */}
      <hemisphereLight color={ciel} groundColor={AMBIANCE.sol} intensity={AMBIANCE_NUIT.intensite + (AMBIANCE.intensite - AMBIANCE_NUIT.intensite) * jour} />
      <directionalLight color={soleil.couleur} intensity={soleil.intensite} position={soleil.position} />
    </>
  )
}
