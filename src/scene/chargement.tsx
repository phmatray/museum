/**
 * Le côté 3D de l'écran de chargement (`stores/chargementStore.ts`).
 *
 * 1. Chaque chargeur three construit sans gestionnaire passe par
 *    `DefaultLoadingManager` : on compte ses départs et ses arrivées. Ses
 *    rappels `onStart`/`onProgress` ne suffiraient pas — ils ne disent le total
 *    qu'à la PROCHAINE arrivée, et drei les occupe déjà pour `useProgress`.
 * 2. Les polices des textes (troika) se chargent dans un worker, hors de tout
 *    gestionnaire : on les précharge en les comptant.
 * 3. `Pret`, une fois tout arrivé et le réseau calme, compile les shaders, fait
 *    reprendre les sondes de reflets, laisse passer quelques images, et
 *    seulement alors déclare le musée prêt.
 *
 * ── Pourquoi rien n'est dessiné avant la compilation ──
 *
 * Derrière l'écran de chargement (opaque), dessiner ne sert à rien — et coûte
 * cher : chaque matériau vu pour la première fois exige son programme TOUT DE
 * SUITE, et le navigateur bloque le fil principal jusqu'à ce que le pilote l'ait
 * compilé. Cache de shaders froid, c'était ~35 s de fil bloqué, programme après
 * programme. `gl.render` est donc retenu jusqu'à la fin de `compileAsync`, qui
 * lance tout d'un coup et attend sans bloquer (KHR_parallel_shader_compile).
 */
import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { preloadFont } from 'troika-three-text'

import { commencer, finir, marquerPret, suivre, useChargement } from '../stores/chargementStore'
import { CARTEL_FONT, TITRE_FONT } from './cartelStyle'

const gestionnaire = THREE.DefaultLoadingManager as THREE.LoadingManager & { compte?: true }
// Une seule fois, même si le module est réévalué (rechargement à chaud).
if (!gestionnaire.compte) {
  gestionnaire.compte = true
  const { itemStart, itemEnd } = gestionnaire
  gestionnaire.itemStart = (url) => {
    commencer()
    itemStart(url)
  }
  // Un échec appelle aussi `itemEnd` : il compte comme arrivé, le musée fait sans.
  gestionnaire.itemEnd = (url) => {
    itemEnd(url)
    finir()
  }
}

for (const font of [CARTEL_FONT, TITRE_FONT]) void suivre(new Promise<void>((r) => preloadFont({ font }, () => r())))

/** Le réseau doit se taire aussi longtemps : un modèle arrivé en appelle parfois un autre à l'image suivante (s). */
const CALME = 0.5
/** Les images rendues après les sondes, avant de lever le rideau. */
const IMAGES = 3

/** Une cible hors écran quelconque : seule compte sa présence pour les clés de programme. */
const CIBLE = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })

type Phase = 'attente' | 'compilation' | 'sondes' | 'images'

export function Pret() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const phase = useRef<Phase>('attente')
  const calme = useRef(0)
  const images = useRef(0)

  // Le rideau : `gl.render` ne dessine rien avant la compilation (voir l'en-tête).
  // Les sondes de reflets prises pendant ce temps sont vides, mais la finition
  // les reprend toutes.
  const retenu = useRef(true)
  useLayoutEffect(() => {
    const rendre = gl.render
    /* eslint-disable react-hooks/immutability -- le rendu est un état du renderer three */
    gl.render = (scene, camera) => {
      if (!retenu.current) rendre.call(gl, scene, camera)
    }
    return () => {
      gl.render = rendre
    }
    /* eslint-enable react-hooks/immutability */
  }, [gl])

  useFrame((_, dt) => {
    const { faits, total, etape, sondes } = useChargement.getState()
    if (etape === 'pret') {
      // Levé de force (patience épuisée, navigateur piloté) : on dessine, compilé ou non.
      retenu.current = false
      return
    }
    if (faits < total) {
      // Du nouveau pendant la finition : on recommence à attendre, sondes comprises.
      calme.current = 0
      if (phase.current !== 'attente' && phase.current !== 'compilation') {
        phase.current = 'attente'
        images.current = 0
        useChargement.setState({ etape: 'chargement', sondes: false })
      }
      return
    }
    if (phase.current === 'attente') {
      calme.current += dt
      if (total === 0 || calme.current < CALME) return
      phase.current = 'compilation'
      // Les programmes compilés en parallèle (KHR_parallel_shader_compile) plutôt
      // qu'au premier regard vers chaque matériau. Compilés POUR UNE CIBLE hors
      // écran, comme le rendu réel (le composeur dessine dans ses tampons) :
      // sans cible, three compilerait des variantes « écran » (sortie sRGB, rendu
      // des tons) qu'aucune image n'utilise, et les vraies resteraient à faire.
      const avant = gl.getRenderTarget()
      gl.setRenderTarget(CIBLE)
      const compilation = gl.compileAsync(scene, camera)
      gl.setRenderTarget(avant)
      void compilation
        .catch((erreur: unknown) => console.warn('compilation anticipée impossible', erreur))
        .then(() => {
          retenu.current = false
          phase.current = 'sondes'
          useChargement.setState({ etape: 'finition', sondes: false })
        })
    } else if (phase.current === 'sondes') {
      if (sondes) phase.current = 'images'
    } else if (phase.current === 'images' && ++images.current >= IMAGES) marquerPret()
  })
  return null
}
