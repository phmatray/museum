/**
 * Le temps qu'il fait à Bruxelles, sur le musée : le relevé d'Open-Meteo (au
 * chargement puis tous les quarts d'heure, dans le navigateur, sans clé), ou
 * celui que force `?meteo=`. Publié dans `gameStore.meteo`.
 *
 * Ici : les uniformes partagés (`intemperies.ts`) lissés à chaque image — le
 * sol se mouille puis sèche, la neige tient puis fond —, la brume de la scène,
 * la pluie et la neige qui tombent autour du visiteur (dehors seulement), la
 * brume sur l'étang et l'éclair d'orage (jamais sous `prefers-reduced-motion`).
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import config from '../../museum.config.json'
import { meteoDemandee, meteoDuReleve, urlOpenMeteo, type Releve } from '../domain/meteo'
import { JARDIN, distanceEtang } from '../plan/jardin'
import { useGameStore } from '../stores/gameStore'
import { INTEMPERIES } from './intemperies'

const QUART_D_HEURE = 15 * 60 * 1000
const BRUME_JOUR = new THREE.Color('#b4bcc2')
const BRUME_NUIT = new THREE.Color('#161c28')
const BRUME_SOIR = new THREE.Color('#c9a78e')

/** La caméra est-elle sous les toits du musée ? Alors ni pluie ni neige à l'écran. */
const sousLesToits = (p: THREE.Vector3) => p.x > -0.3 && p.x < 48.3 && p.z > -0.3 && p.z < 40.3 && p.y < 11

export function MeteoLayer() {
  useReleve()
  const scene = useThree((s) => s.scene)
  const flash = useRef<THREE.AmbientLight>(null)
  const eclair = useRef({ prochain: 3, debut: -10 })
  const calme = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const brume = useMemo(() => new THREE.FogExp2(BRUME_JOUR.clone(), 0), [])

  /* eslint-disable react-hooks/immutability -- les uniformes et la brume sont l'état de la scène three */
  // Au montage, le temps déjà publié tient d'emblée : un `?meteo=neige` arrive enneigé.
  useEffect(() => {
    const { meteo } = useGameStore.getState()
    INTEMPERIES.uPluie.value = INTEMPERIES.uMouille.value = meteo.pluie
    INTEMPERIES.uEnneige.value = meteo.neige
    return () => {
      if (scene.fog === brume) scene.fog = null
    }
  }, [scene, brume])

  useFrame(({ camera, clock }, dt) => {
    const { meteo, saison, ciel } = useGameStore.getState()
    const I = INTEMPERIES
    const pas = Math.min(dt, 0.1)
    const vers = (u: { value: number }, cible: number, vitesse: number) => {
      u.value += (cible - u.value) * Math.min(1, pas * vitesse)
    }
    I.uTemps.value = clock.elapsedTime
    vers(I.uPluie, meteo.pluie, 0.5)
    // Le sol se mouille vite, sèche lentement ; la neige tient, fond sous la pluie.
    vers(I.uMouille, Math.max(meteo.pluie, meteo.neige * 0.3), meteo.pluie > I.uMouille.value ? 0.2 : 0.01)
    vers(I.uEnneige, meteo.neige > 0 ? Math.min(1, 0.4 + meteo.neige) : 0, meteo.neige > 0 ? 0.02 : 0.005 + meteo.pluie * 0.03)
    vers(I.uVent, meteo.vent, 0.3)
    vers(I.uNuages, meteo.nuages, 0.3)
    vers(I.uBrume, meteo.brouillard, 0.3)
    I.uFeuillage.value = saison.feuillage
    I.uChute.value = saison.chute
    I.uFloraison.value = saison.floraison
    I.uTendre.value = saison.tendre
    I.uFeuillesSol.value = saison.feuillesAuSol
    I.uJaune.value = saison.pelouse.jaune
    I.uTerne.value = saison.pelouse.terne
    I.uBrumeCouleur.value.copy(BRUME_NUIT).lerp(BRUME_JOUR, ciel.jour).lerp(BRUME_SOIR, ciel.crepuscule * ciel.jour * 0.4)

    // La brume de la scène : le brouillard, et l'air chargé de la pluie ou de la neige.
    // Sous les toits, à peine : il ne pleut pas dans la nef.
    const densite = I.uBrume.value * 0.055 + I.uPluie.value * 0.012 + meteo.neige * 0.02
    const dedans = sousLesToits(camera.position)
    brume.density = densite * (dedans ? 0.25 : 1)
    brume.color.copy(I.uBrumeCouleur.value)
    // Pas de brume par beau temps : le rendu reste celui d'avant, sans programme recompilé.
    const voulu = densite > 0.002 ? brume : null
    if (scene.fog !== voulu) scene.fog = voulu

    // L'orage : un double éclair toutes les 4 à 14 s.
    const t = clock.elapsedTime
    const e = eclair.current
    if (meteo.orage && !calme && t > e.prochain) {
      e.debut = t
      e.prochain = t + 4 + Math.random() * 10
    }
    const dt2 = t - e.debut
    const lueur = dt2 < 0.6 ? Math.max(0, 1 - dt2 / 0.12) + (dt2 > 0.2 ? Math.max(0, 0.7 - (dt2 - 0.2) / 0.3) : 0) : 0
    I.uEclair.value = lueur
    if (flash.current) flash.current.intensity = lueur * 2.2
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <ambientLight ref={flash} color="#dfe6ff" intensity={0} />
      <Chute neige={false} />
      <Chute neige />
      <BrumeDeLEtang />
    </>
  )
}

/** Le relevé d'Open-Meteo, au chargement et tous les quarts d'heure ; rien si l'adresse force le temps. */
function useReleve() {
  useEffect(() => {
    if (import.meta.env.MODE === 'test' || meteoDemandee(location.search) !== null) return
    const controle = new AbortController()
    const relever = () =>
      fetch(urlOpenMeteo(config.location.latitude, config.location.longitude), { signal: controle.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ current?: Releve }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => j.current && useGameStore.setState({ meteo: meteoDuReleve(j.current) }))
        // Hors ligne ou refusé : on garde le temps d'avant (clair au premier chargement).
        .catch((erreur: unknown) => controle.signal.aborted || console.warn('météo indisponible', erreur))
    void relever()
    const id = setInterval(relever, QUART_D_HEURE)
    return () => {
      clearInterval(id)
      controle.abort()
    }
  }, [])
}

const SOMMETS_CHUTE = /* glsl */ `
  uniform float uTemps, uVent, uTaille;
  uniform vec3 uBoite, uCam;
  attribute vec4 aGoutte;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    #ifdef NEIGE
      vec3 vit = vec3(0.3 * uVent, -1.0, 0.1 * uVent);
      vec3 p = aGoutte.xyz * uBoite + vit * uTemps * (0.7 + 0.6 * aGoutte.w);
      p.x += sin(uTemps * 0.9 + aGoutte.w * 40.0) * 0.3;
      p.z += cos(uTemps * 0.7 + aGoutte.w * 23.0) * 0.3;
    #else
      vec3 vit = vec3(0.35 * uVent, -9.0, 0.12 * uVent);
      vec3 p = aGoutte.xyz * uBoite + vit * uTemps * (0.85 + 0.3 * aGoutte.w);
    #endif
    // Replié autour de la caméra : chaque goutte garde sa place, le nuage suit le visiteur.
    vec3 coin = uCam - 0.5 * uBoite;
    p = coin + mod(p - coin, uBoite);
    // Pas sous les toits : ni dans les salles ni dans la nef.
    float dedans = step(-0.3, p.x) * step(p.x, 48.3) * step(-0.3, p.z) * step(p.z, 40.3) * step(p.y, 11.5);
    float d = length(p.xz - uCam.xz) / (0.5 * uBoite.x);
    vAlpha = (1.0 - smoothstep(0.6, 1.0, d)) * smoothstep(0.8, 3.0, distance(p, uCam)) * (1.0 - dedans);
    #ifdef NEIGE
      vec3 droite = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 haut = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 w = p + (droite * position.x + haut * (position.y - 0.5)) * uTaille;
    #else
      // Un trait le long de sa chute, de face pour la caméra : le flou de bougé d'une goutte.
      vec3 dir = normalize(vit);
      vec3 cote = normalize(cross(dir, p - uCam));
      vec3 w = p + cote * position.x * uTaille + dir * position.y * 0.5;
    #endif
    vUv = vec2(position.x + 0.5, position.y);
    gl_Position = vAlpha <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`
const FRAGMENTS_CHUTE = /* glsl */ `
  uniform float uJour, uOpacite, uEclair;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    #ifdef NEIGE
      float a = smoothstep(0.5, 0.15, length(vUv - 0.5));
      vec3 c = vec3(0.95, 0.96, 1.0);
    #else
      float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
      vec3 c = vec3(0.72, 0.77, 0.84);
    #endif
    gl_FragColor = vec4(c * (0.15 + 0.85 * uJour + uEclair), a * vAlpha * uOpacite);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * La pluie (des traits) ou la neige (des flocons) : des milliers de quads en UN
 * appel de dessin, repliés dans une boîte qui suit la caméra. Le nombre dessiné
 * suit l'intensité ; rien sous les toits.
 */
const CHUTES = {
  pluie: { n: 16000, boite: new THREE.Vector3(26, 16, 26), taille: 0.012, opacite: 0.26 },
  neige: { n: 9000, boite: new THREE.Vector3(26, 16, 26), taille: 0.045, opacite: 0.9 },
}

function Chute({ neige }: { neige: boolean }) {
  const reglage = CHUTES[neige ? 'neige' : 'pluie']
  const geometrie = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    // Le même semis à chaque chargement.
    let etat = neige ? 11 : 7
    const alea = () => ((etat = (etat * 16807) % 2147483647) - 1) / 2147483646
    g.setAttribute('aGoutte', new THREE.InstancedBufferAttribute(Float32Array.from({ length: reglage.n * 4 }, alea), 4))
    g.instanceCount = 0
    return g
  }, [neige, reglage])
  const materiau = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SOMMETS_CHUTE,
        fragmentShader: FRAGMENTS_CHUTE,
        defines: neige ? { NEIGE: '' } : {},
        uniforms: {
          uTemps: INTEMPERIES.uTemps,
          uVent: INTEMPERIES.uVent,
          uEclair: INTEMPERIES.uEclair,
          uTaille: { value: reglage.taille },
          uBoite: { value: reglage.boite },
          uCam: { value: new THREE.Vector3() },
          uJour: { value: 1 },
          uOpacite: { value: reglage.opacite },
        },
        transparent: true,
        depthWrite: false,
        // Le sens d'un trait dépend de la goutte : pas de face arrière à écarter.
        side: THREE.DoubleSide,
      }),
    [neige, reglage],
  )
  useEffect(() => () => {
    geometrie.dispose()
    materiau.dispose()
  }, [geometrie, materiau])
  const mesh = useRef<THREE.Mesh>(null)
  /* eslint-disable react-hooks/immutability -- le nombre d'instances et le jour sont l'état three de la chute */
  useFrame(({ camera }) => {
    const { meteo, ciel } = useGameStore.getState()
    const intensite = neige ? meteo.neige : INTEMPERIES.uPluie.value
    geometrie.instanceCount = sousLesToits(camera.position) ? 0 : Math.round(reglage.n * Math.min(1, intensite))
    materiau.uniforms.uJour.value = ciel.jour
    if (mesh.current) mesh.current.visible = geometrie.instanceCount > 0
    ;(materiau.uniforms.uCam.value as THREE.Vector3).copy(camera.position)
  })
  /* eslint-enable react-hooks/immutability */
  // Dessinée après le décor transparent : les traits passent devant la verrière.
  return <mesh ref={mesh} geometry={geometrie} material={materiau} frustumCulled={false} renderOrder={2} />
}

const SOMMETS_BRUME = /* glsl */ `
  attribute float aBord;
  varying float vBord;
  varying vec2 vXZ;
  void main() {
    vBord = aBord;
    vXZ = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAGMENTS_BRUME = /* glsl */ `
  uniform float uTemps, uBrume;
  uniform vec3 uBrumeCouleur;
  varying float vBord;
  varying vec2 vXZ;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float b(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec2 q = vXZ * 0.25 + vec2(uTemps * 0.03, uTemps * 0.012);
    float n = b(q) * 0.6 + b(q * 2.3 - uTemps * 0.02) * 0.4;
    gl_FragColor = vec4(uBrumeCouleur * 1.05, vBord * uBrume * smoothstep(0.25, 0.8, n) * 0.4);
    #include <colorspace_fragment>
  }
`

/** Un voile au ras de l'étang, qui dérive : fondu vers la berge, visible par temps de brouillard. */
function BrumeDeLEtang() {
  const geometrie = useMemo(() => {
    const xs = JARDIN.etang.contour.map(([x]) => x)
    const zs = JARDIN.etang.contour.map(([, z]) => z)
    const [x0, x1, z0, z1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...zs) - 2, Math.max(...zs) + 2]
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil(x1 - x0), Math.ceil(z1 - z0))
    g.rotateX(-Math.PI / 2)
    g.translate((x0 + x1) / 2, JARDIN.etang.niveau + 0.35, (z0 + z1) / 2)
    const p = g.getAttribute('position')
    g.setAttribute('aBord', new THREE.Float32BufferAttribute(Array.from({ length: p.count }, (_, i) => {
      const d = distanceEtang(p.getX(i), p.getZ(i))
      return Math.min(1, Math.max(0, (1.5 - d) / 3))
    }), 1))
    return g
  }, [])
  const materiau = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SOMMETS_BRUME,
        fragmentShader: FRAGMENTS_BRUME,
        uniforms: { uTemps: INTEMPERIES.uTemps, uBrume: INTEMPERIES.uBrume, uBrumeCouleur: INTEMPERIES.uBrumeCouleur },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => {
    geometrie.dispose()
    materiau.dispose()
  }, [geometrie, materiau])
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (mesh.current) mesh.current.visible = INTEMPERIES.uBrume.value > 0.02
  })
  return <mesh ref={mesh} geometry={geometrie} material={materiau} renderOrder={1} />
}
