/**
 * La visite en VR (WebXR) : un casque, ou un Cardboard (`io/xr.ts`).
 *
 * ── Le gréement ──
 *
 * En VR, c'est le casque qui pose la caméra, dans le repère de son sol. La
 * caméra passe donc dans un gréement que `PlanPlayer` promène comme il
 * promenait la caméra : le visiteur marche (`walk.ts`, collisions comprises),
 * le gréement le suit à la cote de son pied, et la tête bouge librement dedans.
 * Sans sol connu (un Cardboard), le gréement se hausse à hauteur d'œil.
 *
 * ── Les effets, adaptés plutôt que retirés ──
 *
 * La chaîne d'écran (`PostProcessing`) ne sait rendre qu'une image, pas deux
 * yeux : elle se retire en VR, et `SortieVR` prend le relais. La scène est
 * rendue une fois pour les deux yeux dans une cible HDR multiéchantillonnée
 * (l'anticrénelage matériel remplace SMAA), puis recopiée dans le casque par
 * une seule passe par œil qui refait :
 *
 * - le rendu des tons (Khronos PBR Neutral, même exposition que l'écran) ;
 * - l'étalonnage de l'heure (`etalonnage.ts`, mêmes uniformes, que
 *   `AtmosphereLayer` règle toujours) ;
 * - le halo des lumières, lu dans les niveaux de mip de l'image (un flou
 *   gratuit : le GPU les calcule en une passe) au lieu des huit passes du bloom ;
 * - et, propre au casque, une vignette de CONFORT qui resserre le champ
 *   pendant qu'on marche ou qu'on tourne (`domain/vr.ts`).
 *
 * L'occlusion ambiante d'écran n'a pas d'équivalent à deux yeux ; la lumière
 * cuite et les ombres de contact tiennent les angles.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { ETAT_VR, confort, lireEntrees, type Manette } from '../domain/vr'
import { brancherVR, modeVR } from '../io/xr'
import { useGameStore, vrEntree } from '../stores/gameStore'
import { ETALONNAGE } from './etalonnage'
import { TONE_EXPOSURE } from './lighting'
import { BLOOM } from './postProcessingSettings'

/** Un téléphone rend deux yeux : un peu moins de pixels, pour tenir la cadence. */
const ECHELLE_TELEPHONE = 0.8

export function VRLayer() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const enVR = useGameStore((s) => s.enVR)

  // La scène sait prendre une session : `entrerEnVR` (le bouton de l'accueil) la lui passe.
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- le renderer est un objet three */
    gl.xr.enabled = true
    brancherVR(async (session) => {
      // Le sol du casque, s'il en a un ; sinon (Cardboard), un repère à hauteur de tête.
      const sol = session.enabledFeatures?.includes('local-floor') ?? false
      gl.xr.setReferenceSpaceType(sol ? 'local-floor' : 'local')
      gl.xr.setFramebufferScaleFactor(matchMedia('(pointer: coarse)').matches ? ECHELLE_TELEPHONE : 1)
      gl.xr.setFoveation(1)
      vrEntree.sansSol = !sol
      session.addEventListener('end', () => useGameStore.setState({ enVR: false }))
      await gl.xr.setSession(session)
      useGameStore.setState({ enVR: true, paused: false, tourActive: false })
    })
    /* eslint-enable react-hooks/immutability */
    return () => brancherVR(null)
  }, [gl])

  // Le gréement : la caméra y entre en VR, en ressort ensuite, tournée comme on regardait.
  const gree = useMemo(() => {
    const g = new THREE.Group()
    g.name = 'vr:greement'
    return g
  }, [])
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (!enVR) return
    /* eslint-disable react-hooks/immutability */
    camera.rotation.order = 'YXZ'
    gree.rotation.set(0, camera.rotation.y, 0)
    camera.position.set(0, 0, 0)
    camera.rotation.set(0, 0, 0)
    scene.add(gree)
    gree.add(camera)
    return () => {
      const cap = new THREE.Euler().setFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y
      gree.remove(camera)
      scene.remove(gree)
      camera.rotation.set(0, cap, 0)
    }
    /* eslint-enable react-hooks/immutability */
  }, [enVR, camera, gree, scene])

  // Les mains et le regard, lus avant la marche (`PlanPlayer`, priorité 0).
  const etat = useRef(ETAT_VR)
  const selections = useRef(0)
  const avant = useRef<{ x: number; z: number; cap: number } | null>(null)
  useEffect(() => {
    if (!enVR) return
    const session = gl.xr.getSession()
    if (session === null) return
    // Un tapotement du Cardboard (ou un regard sans manette) : la marche au regard.
    const compter = (e: XRInputSourceEvent) => {
      if (e.inputSource.targetRayMode !== 'tracked-pointer') selections.current++
    }
    session.addEventListener('select', compter)
    // Le polyfill du Cardboard ne fait pas d'un tapotement une sélection (seulement
    // des manettes) : on l'écoute nous-mêmes, sauf sur sa flèche de retour (en
    // haut à gauche) et sa roue de réglages (en bas au milieu).
    const taper = (e: PointerEvent) => {
      const bouton = 64
      if (e.clientX < bouton && e.clientY < bouton) return
      if (Math.abs(e.clientX - innerWidth / 2) < bouton && e.clientY > innerHeight - bouton) return
      selections.current++
    }
    if (modeVR() === 'cardboard') addEventListener('pointerdown', taper)
    return () => {
      removeEventListener('pointerdown', taper)
      session.removeEventListener('select', compter)
      etat.current = ETAT_VR
      avant.current = null
      Object.assign(vrEntree, { avance: 0, cote: 0, hate: false, confort: 0 })
    }
  }, [enVR, gl])
  /* eslint-disable react-hooks/immutability -- le gréement et l'entrée partagée, réglés à chaque image */
  useFrame((_, dt) => {
    const session = gl.xr.getSession()
    if (!enVR || session === null) return
    const manettes: Manette[] = [...session.inputSources].map((s) => ({
      handedness: s.handedness,
      targetRayMode: s.targetRayMode,
      axes: s.gamepad ? [...s.gamepad.axes] : [],
      boutons: s.gamepad ? s.gamepad.buttons.map((b) => b.pressed) : [],
    }))
    const r = lireEntrees(manettes, selections.current, etat.current)
    selections.current = 0
    Object.assign(vrEntree, { avance: r.entree.avance, cote: r.entree.cote, hate: r.entree.hate })
    gree.rotation.y += r.entree.tourner
    // La vignette de confort : la vitesse du gréement et sa rotation, image par image.
    const ici = { x: gree.position.x, z: gree.position.z, cap: gree.rotation.y }
    const a = avant.current ?? ici
    const vitesse = dt > 0 ? Math.hypot(ici.x - a.x, ici.z - a.z) / dt : 0
    const rotation = dt > 0 ? Math.abs(ici.cap - a.cap) / dt : 0
    avant.current = ici
    etat.current = { ...r.etat, confort: confort(r.etat.confort, vitesse, rotation, dt) }
    vrEntree.confort = etat.current.confort
  }, -1)
  /* eslint-enable react-hooks/immutability */

  return enVR ? <SortieVR /> : null
}

/**
 * La passe par œil : tons, étalonnage, halos, confort, puis l'encodage sRGB du
 * casque. Un triangle en coordonnées d'écran, dessiné dans chaque vue (three
 * rend une scène VR œil par œil) ; il lit l'image HDR au même pixel.
 */
const SORTIE_VERT = /* glsl */ `
void main() {
  // À mi-profondeur : sur le plan limite (z = 0), le tampon inversé l’écrêterait.
  gl_Position = vec4(position.xy, 0.5, 1.0);
}`

const SORTIE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTaille;
uniform float uExposition;
uniform float uLueur;
uniform float uSeuil;
uniform float uConfort;
uniform vec4 uOeilG;
uniform vec4 uOeilD;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContraste;
uniform float uNuit;

// Khronos PBR Neutral, comme le rendu des tons de l'écran (lighting.ts).
vec3 neutre(vec3 c) {
  const float debut = 0.8 - 0.04;
  const float desaturation = 0.15;
  c *= uExposition;
  float x = min(c.r, min(c.g, c.b));
  float decalage = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= decalage;
  float pic = max(c.r, max(c.g, c.b));
  if (pic < debut) return c;
  float d = 1.0 - debut;
  float nouveau = 1.0 - d * d / (pic + d - debut);
  c *= nouveau / pic;
  float g = 1.0 - 1.0 / (desaturation * (pic - nouveau) + 1.0);
  return mix(c, vec3(nouveau), g);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uTaille;
  vec3 hdr = texture2D(tScene, uv).rgb;
  // Le halo : ce qui dépasse le seuil, lu dans quatre niveaux de mip, de plus en plus flous.
  vec3 halo = vec3(0.0);
  halo += max(textureLod(tScene, uv, 2.0).rgb - uSeuil, 0.0) * 0.35;
  halo += max(textureLod(tScene, uv, 3.0).rgb - uSeuil, 0.0) * 0.3;
  halo += max(textureLod(tScene, uv, 4.0).rgb - uSeuil, 0.0) * 0.2;
  halo += max(textureLod(tScene, uv, 5.0).rgb - uSeuil, 0.0) * 0.15;
  vec3 brut = neutre(hdr + halo * uLueur);
  // L'étalonnage de l'heure, le même que celui de l'écran (etalonnage.ts).
  vec3 c = clamp(brut, 0.0, 1.0);
  c = uGain * c + uLift * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / uGamma);
  vec3 s = sqrt(c);
  s = clamp((s - 0.46) * uContraste + 0.46, 0.0, 1.0);
  c = s * s;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSaturation), 0.0);
  vec3 b = clamp(brut, 0.0, 1.0);
  c = mix(c, max(c, b), uNuit * smoothstep(0.12, 0.45, max(b.r, max(b.g, b.b))));
  // La vignette de confort, dans chaque œil : la vue où tombe le pixel.
  vec4 vue = gl_FragCoord.x < uOeilD.x ? uOeilG : uOeilD;
  vec2 oeil = (gl_FragCoord.xy - vue.xy) / vue.zw - 0.5;
  float r = length(oeil * vec2(1.0, 1.15));
  c *= 1.0 - uConfort * smoothstep(0.52 - 0.22 * uConfort, 0.62, r);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`

function SortieVR() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const { cible, passe } = useMemo(() => {
    const cible = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    cible.texture.generateMipmaps = true
    cible.texture.minFilter = THREE.LinearMipmapLinearFilter
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
    const m = new THREE.ShaderMaterial({
      vertexShader: SORTIE_VERT,
      fragmentShader: SORTIE_FRAG,
      uniforms: {
        tScene: { value: cible.texture },
        uTaille: { value: new THREE.Vector2(1, 1) },
        uExposition: { value: TONE_EXPOSURE },
        uLueur: { value: BLOOM.intensity },
        uSeuil: { value: BLOOM.luminanceThreshold },
        uConfort: { value: 0 },
        uOeilG: { value: new THREE.Vector4(0, 0, 1, 1) },
        uOeilD: { value: new THREE.Vector4(1, 0, 1, 1) },
        ...ETALONNAGE,
      },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(g, m)
    quad.frustumCulled = false
    const passe = new THREE.Scene()
    passe.add(quad)
    return { cible, passe }
  }, [])
  useEffect(() => () => {
    cible.dispose()
    passe.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }, [cible, passe])

  // Priorité 1 : R3F ne rend plus lui-même, c'est cette passe qui dessine.
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    // La cible du casque, que three pose avant chaque image XR.
    const casque = gl.getRenderTarget()
    if (casque === null) return
    if (cible.width !== casque.width || cible.height !== casque.height) cible.setSize(casque.width, casque.height)
    const u = (passe.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms
    u.uTaille.value.set(casque.width, casque.height)
    u.uConfort.value = vrEntree.confort
    // Les deux yeux dans la cible HDR : three y rend chaque vue à sa place.
    gl.setRenderTarget(cible)
    gl.render(scene, camera)
    // Où tombe chaque œil, pour la vignette : les vues du casque, en pixels.
    const [g, d] = gl.xr.getCamera().cameras
    if (g && d) {
      u.uOeilG.value.copy(g.viewport)
      u.uOeilD.value.copy(d.viewport)
    }
    // Puis le triangle, dans chaque vue du casque. L'état GL d'abord remis à plat :
    // le Cardboard (polyfill) le touche dans le dos de three, dont le cache le
    // croit encore juste — et le second rendu de l'image ne dessinait plus rien.
    gl.resetState()
    gl.setRenderTarget(casque)
    gl.render(passe, camera)
  }, 1)
  /* eslint-enable react-hooks/immutability */
  return null
}
