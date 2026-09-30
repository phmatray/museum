/**
 * Les reflets : ce que le laiton, le bronze, le marbre poli et le verre ont à
 * refléter (`scene.environment`), selon où se tient le visiteur.
 *
 * - Dehors, le CIEL de l'heure : la sphère de `Ciel` rendue seule en carte
 *   d'environnement pré-filtrée (PMREM) — le jour, la nuit, l'or du couchant.
 * - Dedans, une SONDE par salle et une pour la nef : la scène elle-même, rendue
 *   depuis le centre de la pièce. Le laiton d'une salle rouge reflète du rouge,
 *   la verrière brille dans l'horloge.
 *
 * Rien n'est rendu à chaque image : une sonde par image, en file, au montage,
 * une seconde fois quand les modèles sont arrivés, puis quand le soleil a
 * tourné d'environ une heure.
 *
 * L'environnement ne sert QU'AU spéculaire. Three s'en sert aussi pour le
 * diffus (l'irradiance IBL), et c'était la moitié de la lumière d'un mur :
 * passer une porte changeait de sonde, donc la clarté de TOUT ce qu'on voyait,
 * la pièce quittée comme celle où l'on entre — mesuré, 3 à 24 % sur un même
 * pan de mur ou de sol en un pas, plus un creux de 5 à 20 % le temps du fondu.
 * Le diffus ambiant vient désormais de l'hémisphérique, modulée par la lumière
 * cuite (`lumiere.ts`) : rien qui dépende d'où se tient le visiteur.
 *
 * Et le reflet lui-même passe la porte en glissant : sur le seuil, les deux
 * sondes se mêlent selon la place (`melangeDeReflets`), moitié-moitié sur la
 * ligne du mur, une seule à 1,5 m. Le marbre poli ne saute plus d'un pas.
 *
 * Toutes les cartes ont la même taille : changer de carte ne recompile aucun
 * matériau.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

import { melangeDeReflets } from '../domain/ombres'
import { MUSEE } from '../plan/musee'
import { useChargement } from '../stores/chargementStore'
import { useGameStore } from '../stores/gameStore'
import { sansTri } from './tri'

/** Côté d'une face de sonde : les reflets sont flous, 128 suffit. */
const TAILLE = 128
/** L'intensité des reflets, dehors et dedans, et la part qui en reste la nuit. */
const INTENSITE = { ciel: 0.6, dedans: 0.8, nuit: 0.25 }
/** La seconde passe, quand les modèles et les textures sont arrivés (ms). */
const RATTRAPAGE = 9000

/** Le centre de chaque salle, à 2 m du plancher ; la nef au-dessus du hall. */
const SONDES = new Map<string, THREE.Vector3>()
for (const l of MUSEE.levels)
  for (const r of l.rooms) {
    const centre = new THREE.Vector3(r.x + r.width / 2, l.elevation + 2, r.z + r.depth / 2)
    if (r.kind === 'hall') SONDES.set('nef', centre.setY(3))
    else if (r.kind !== 'balcony') SONDES.set(`${l.id}:${r.id}`, centre)
  }
const TOUTES = ['ciel', ...SONDES.keys()]
const NIVEAUX = new Map(MUSEE.levels.map((l) => [l.id, l]))

/** Deux cartes pré-filtrées de même taille se mêlent texel à texel : même disposition des mips. */
const FONDU = {
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D a, b;
    uniform float part;
    varying vec2 vUv;
    void main() { gl_FragColor = mix(texture2D(a, vUv), texture2D(b, vUv), part); }`,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.NoBlending,
}

// Le diffus ne lit plus l'environnement (voir plus haut) : avant toute compilation de matériau.
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '')

export function RefletsLayer() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl])
  const cartes = useRef(new Map<string, THREE.WebGLRenderTarget>())
  const file = useRef<string[]>([])
  // Le mélange de deux sondes, sur le seuil d'une porte : une passe plein écran, seulement quand il change.
  const melange = useRef<THREE.WebGLRenderTarget | null>(null)
  const dernier = useRef('')
  const uniformes = useMemo(() => ({ a: { value: null as THREE.Texture | null }, b: { value: null as THREE.Texture | null }, part: { value: 0 } }), [])
  const fondu = useMemo(() => new FullScreenQuad(new THREE.ShaderMaterial({ ...FONDU, uniforms: uniformes })), [uniformes])
  // Le ciel seul, dans sa propre scène : même géométrie, même matériau que `Ciel`.
  const cielSeul = useMemo(() => new THREE.Scene(), [])

  // Environ une heure de soleil : 8° d'élévation, ou un sixième du jour qui tombe.
  const { elevation, jour } = useGameStore((s) => s.ciel)
  const epoque = `${Math.round(elevation / 8)}:${Math.round(jour * 6)}`
  useEffect(() => {
    file.current = [...TOUTES]
  }, [epoque])
  useEffect(() => {
    const id = setTimeout(() => (file.current = [...new Set([...file.current, ...TOUTES])]), RATTRAPAGE)
    return () => clearTimeout(id)
  }, [])
  // Tout est arrivé (écran de chargement) : chaque sonde est reprise avant de lever le rideau.
  const finition = useChargement((s) => s.etape === 'finition')
  useEffect(() => {
    if (finition) file.current = [...new Set([...file.current, ...TOUTES])]
  }, [finition])
  useEffect(() => {
    const toutes = cartes.current
    return () => {
      for (const c of toutes.values()) c.dispose()
      toutes.clear()
      pmrem.dispose()
      melange.current?.dispose()
      melange.current = null
      fondu.material.dispose()
      fondu.dispose()
    }
  }, [pmrem, fondu])

  /* eslint-disable react-hooks/immutability -- l'environnement est un état de la scène three */
  useFrame(() => {
    // En VR, three rend toute scène avec la caméra du casque : ni capture ni fondu
    // ne tiendraient. Les sondes attendent la sortie ; on garde la plus proche.
    const casque = gl.xr.isPresenting
    const cle = casque ? undefined : file.current[0]
    if (cle !== undefined) {
      let carte: THREE.WebGLRenderTarget | null = null
      if (cle === 'ciel') {
        const ciel = scene.getObjectByName('ciel') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined
        if (ciel && ciel.material.uniforms.charge.value === 1) {
          if (cielSeul.children.length === 0) {
            const sphere = new THREE.Mesh(ciel.geometry, ciel.material)
            sphere.scale.setScalar(800)
            cielSeul.add(sphere)
          }
          carte = pmrem.fromScene(cielSeul, 0, 1, 1000, { size: TAILLE })
        }
      } else {
        // La sonde voit le ciel dans les métaux qu'elle capture, pas sa propre carte périmée.
        const avant = scene.environment
        scene.environment = cartes.current.get('ciel')?.texture ?? avant
        // Toute la scène, pas seulement ce que le visiteur voit d'où il est (VisibiliteLayer).
        carte = sansTri(() => pmrem.fromScene(scene, 0, 0.1, 1000, { size: TAILLE, position: SONDES.get(cle) }))
        scene.environment = avant
      }
      file.current.shift()
      if (carte) {
        cartes.current.get(cle)?.dispose()
        cartes.current.set(cle, carte)
      } else file.current.push(cle) // le ciel n'est pas encore chargé : plus tard
      if (file.current.length === 0 && finition) useChargement.setState({ sondes: true })
    }

    // Près d'une porte, les deux sondes se mêlent selon la place, pas selon l'horloge.
    const v = useGameStore.getState().visiteur
    const m = melangeDeReflets(NIVEAUX.get(v?.level ?? 0), v?.x ?? 0, v?.z ?? 0, v?.surface)
    const a = cartes.current.get(m.sonde) ?? cartes.current.get('ciel')
    const b = cartes.current.get(m.voisine) ?? a
    if (a && b) {
      if (a === b || m.part < 0.005 || casque) scene.environment = (m.part > 0.5 && casque ? b : a).texture
      else {
        const cle = `${a.texture.id}:${b.texture.id}:${m.part.toFixed(3)}`
        if (melange.current === null) melange.current = a.clone()
        if (cle !== dernier.current) {
          uniformes.a.value = a.texture
          uniformes.b.value = b.texture
          uniformes.part.value = m.part
          const avant = gl.getRenderTarget()
          gl.setRenderTarget(melange.current)
          fondu.render(gl)
          gl.setRenderTarget(avant)
          dernier.current = cle
        }
        scene.environment = melange.current.texture
      }
    }
    const jour = useGameStore.getState().ciel.jour
    const intensite = (k: string) => (k === 'ciel' ? INTENSITE.ciel : INTENSITE.dedans)
    const part = a && b && a !== b ? m.part : 0
    scene.environmentIntensity = (intensite(m.sonde) * (1 - part) + intensite(m.voisine) * part) * (INTENSITE.nuit + (1 - INTENSITE.nuit) * jour)
  })
  /* eslint-enable react-hooks/immutability */
  return null
}
