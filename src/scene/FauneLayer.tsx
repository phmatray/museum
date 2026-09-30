/**
 * La faune du jardin : les carpes koï de l'étang, les oiseaux des érables, les
 * lucioles des nuits d'été. Trois appels de dessin (quatre avec les ronds
 * dans l'eau), aucun fichier à télécharger : tout est modelé ici, en quelques
 * dizaines de sommets, et animé dans le shader.
 *
 * `plan/koi.ts` et `plan/oiseaux.ts` décident où va chaque bête ; ici on ne
 * fait que les montrer. Rien n'entre dans le musée : l'étang est au sud-est,
 * les perchoirs sont hors de l'emprise, les lucioles aussi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { CONTOUR_ETANG, TRACE_RUISSEAU, JARDIN } from '../plan/jardin'
import { SURFACE, avancerKoi, distanceEtang, koiInitiaux, type Koi } from '../plan/koi'
import { MUSEE } from '../plan/musee'
import { avancerOiseaux, oiseauxInitiaux, perchoirs, type Oiseau, type Perchoir, type Point3 } from '../plan/oiseaux'
import { generateur, parkPlacements } from '../plan/park'
import { hauteurDuParc, solDuParc } from '../plan/relief'
import { PARC as ZONE_PARC } from '../plan/visibilite'
import { ECHELLE_HERISSON, FAMILLE, avancerFamille, familleInitiale, type EtatHerisson, type Herisson as EtatDuHerisson } from '../domain/herisson'
import type { Saison } from '../domain/saisons'
import { useGameStore } from '../stores/gameStore'
import { moteurCourant, useSon } from '../audio/etat'
import { SOURCES_LAMPADAIRES } from '../plan/eclairage'
import { LAMPES } from './lueurs'
import { FOULE } from './gazon'
import { parkAssetsResource } from './parkAssets'

const PARC = parkPlacements(MUSEE)
const VARIETE = { kohaku: 0, ogon: 1, showa: 2 } as const

/**
 * En développement : de quoi figer la faune pour une photo — `figer(true)`
 * arrête le temps des bêtes, `envoler()` fait décoller tous les oiseaux.
 */
const dev = {
  gel: false, envol: false, oiseaux: [] as Oiseau[], perchoirs: [] as Perchoir[], carpes: [] as Koi[],
  herissons: [] as EtatDuHerisson[], placer: new Map<number, Partial<EtatDuHerisson>>(),
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __FAUNE__?: unknown }).__FAUNE__ = {
    figer: (gel: boolean) => { dev.gel = gel },
    envoler: () => { dev.envol = true },
    oiseaux: () => dev.oiseaux,
    perchoirs: () => dev.perchoirs,
    carpes: () => dev.carpes,
    /** La famille, dans l'ordre de `FAMILLE` : 0 la mère, 1 le petit (celui de #196), 2 la petite, 3 le vieux. */
    herissons: () => dev.herissons,
    herisson: (i = 1) => dev.herissons[i],
    /** `placerHerisson(x, z, cap, 'flaire' | 'marche' | 'boule', t, i)` : pour une photo ; `t` secondes dans cet état (une heure) ; `i` son rang (le petit par défaut). */
    placerHerisson: (x: number, z: number, cap = 0, etat: EtatHerisson = 'flaire', t = 3600, i = 1) => {
      dev.placer.set(i, { x, z, cap, etat, t, rentre: false, flane: true, boule: etat === 'boule' ? 1 : 0, vitesse: etat === 'marche' ? FAMILLE[i].vitesse : 0, but: [x + Math.cos(cap) * 50, z + Math.sin(cap) * 50] })
    },
  }
}

export function FauneLayer() {
  return (
    <group name="faune">
      <Carpes />
      <Oiseaux />
      <Lucioles />
      <Herissons />
    </group>
  )
}

// ── Les carpes ────────────────────────────────────────────────────────────

/**
 * Une carpe d'un mètre de long, le nez vers +x : un corps fuselé en anneaux
 * elliptiques, une caudale en éventail, deux pectorales et une dorsale.
 * `aNageoire` vaut 1 sur les nageoires, qui prennent un voile plus clair.
 */
function corpsDeCarpe(): THREE.BufferGeometry {
  const profil: [number, number][] = [[-0.5, 0.012], [-0.4, 0.03], [-0.25, 0.058], [-0.05, 0.1], [0.12, 0.118], [0.28, 0.108], [0.4, 0.078], [0.47, 0.045], [0.5, 0.012]]
  const n = 10
  const pos: number[] = []
  const index: number[] = []
  profil.forEach(([x, r]) => {
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n
      // Plus large que haut, le dos rond, le ventre plus plat.
      pos.push(x, Math.sin(a) * r * (Math.sin(a) > 0 ? 0.8 : 0.55), Math.cos(a) * r * 1.2)
    }
  })
  for (let i = 0; i + 1 < profil.length; i++)
    for (let j = 0; j < n; j++) {
      const [a, b, c, d] = [i * n + j, i * n + ((j + 1) % n), (i + 1) * n + j, (i + 1) * n + ((j + 1) % n)]
      index.push(a, c, b, b, c, d)
    }
  const corps = new THREE.BufferGeometry()
  corps.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  corps.setIndex(index)
  const nageoires = new THREE.BufferGeometry()
  const f: number[] = [
    // La caudale : deux lobes en éventail, verticaux.
    -0.48, 0, 0, -0.72, 0.13, 0, -0.64, 0, 0,
    -0.48, 0, 0, -0.64, 0, 0, -0.72, -0.13, 0,
    // Les pectorales, presque à plat, un peu tombantes.
    0.2, -0.04, 0.09, 0.08, -0.07, 0.24, 0.02, -0.06, 0.1,
    0.2, -0.04, -0.09, 0.02, -0.06, -0.1, 0.08, -0.07, -0.24,
    // La dorsale.
    0.2, 0.09, 0, -0.18, 0.06, 0, 0.1, 0.16, 0,
  ]
  nageoires.setAttribute('position', new THREE.Float32BufferAttribute(f, 3))
  // Les normales du corps lissées avant de le déplier : une carpe, pas une facette.
  corps.computeVertexNormals()
  nageoires.computeVertexNormals()
  const g = mergeGeometries([corps.toNonIndexed(), nageoires])!
  const drapeau = new Float32Array(g.getAttribute('position').count)
  drapeau.fill(1, corps.getIndex()!.count)
  g.setAttribute('aNageoire', new THREE.BufferAttribute(drapeau, 1))
  corps.dispose()
  nageoires.dispose()
  return g
}

/**
 * La nage dans le vertex shader (la queue bat, d'autant plus qu'on s'en
 * approche), la robe dans le fragment : kohaku blanc taché de rouge, ogon
 * d'or, showa noir, rouge et blanc. Plus la carpe est profonde, plus l'eau la
 * voile de vert ; une pointe d'émission la garde lisible sous l'eau sombre.
 */
function matiereCarpe(jour: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uJour = jour
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aKoi;
        attribute float aNageoire;
        varying vec3 vLocal;
        varying vec4 vKoi;
        varying float vNageoire;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position; vKoi = aKoi; vNageoire = aNageoire;
        float queue = smoothstep(0.35, -0.75, position.x);
        transformed.z += 0.09 * queue * queue * sin(position.x * 7.0 + aKoi.z)
          + 0.012 * sin(aKoi.z * 0.5 + position.x * 3.0);
        // Les pectorales godillent.
        transformed.y += aNageoire * step(0.0, position.x) * abs(position.z) * 0.25 * sin(aKoi.z * 0.7 + position.z);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uJour;
        varying vec3 vLocal;
        varying vec4 vKoi;
        varying float vNageoire;
        float taches(vec3 p, float g) {
          return sin(p.x * 11.0 + g * 31.0) * 0.6 + sin(p.z * 14.0 - p.x * 6.0 + g * 57.0) * 0.45 + sin(p.x * 29.0 + p.z * 9.0 + g * 11.0) * 0.2;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 blanc = vec3(0.93, 0.92, 0.88);
        vec3 rouge = vec3(0.82, 0.14, 0.05);
        vec3 noir = vec3(0.03, 0.03, 0.035);
        vec3 or = vec3(1.0, 0.56, 0.12);
        float g = vKoi.y;
        float dos = smoothstep(-0.02, 0.03, vLocal.y);
        vec3 robe;
        if (vKoi.x < 0.5) robe = mix(blanc, rouge, dos * smoothstep(-0.12, -0.05, taches(vLocal, g)) * step(-0.44, vLocal.x));
        else if (vKoi.x < 1.5) robe = or * (0.85 + 0.25 * dos);
        else {
          robe = mix(noir, rouge, step(0.25, taches(vLocal, g)) * dos);
          robe = mix(robe, blanc, step(0.55, taches(vLocal.zyx * 1.3, g + 0.3)) * (1.0 - dos * 0.5));
        }
        // Le ventre pâlit, les nageoires sont un voile.
        robe = mix(robe, blanc * 0.95, (1.0 - dos) * 0.35);
        robe = mix(robe, mix(robe, vec3(0.95, 0.8, 0.7), 0.45), vNageoire);
        // L'eau voile ce qui est profond.
        robe = mix(robe, vec3(0.05, 0.12, 0.08), 0.12 + smoothstep(0.03, 0.65, vKoi.w) * 0.55);
        diffuseColor.rgb = robe;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.18 * uJour;`)
  }
  m.customProgramCacheKey = () => 'faune:carpe'
  return m
}

/**
 * Un rond dans l'eau : un anneau qui s'élargit et s'efface, trois à la fois.
 * `aRide` : (graine, force).
 */
function matiereRides(temps: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTemps: temps },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec2 aRide;
      varying vec2 vUv;
      varying vec2 vRide;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vRide = aRide;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTemps;
      varying vec2 vUv;
      varying vec2 vRide;
      void main() {
        float r = length(vUv);
        float a = 0.0;
        for (int i = 0; i < 3; i++) {
          float f = fract(uTemps * 0.45 + vRide.x + float(i) / 3.0);
          a += smoothstep(0.045, 0.0, abs(r - f * 0.95)) * (1.0 - f) * (1.0 - f);
        }
        if (a * vRide.y < 0.01) discard;
        gl_FragColor = vec4(vec3(0.8, 0.86, 0.86), a * vRide.y * 0.35);
      }`,
  })
}

const M = new THREE.Matrix4()
const Q = new THREE.Quaternion()
const E = new THREE.Euler()
const P = new THREE.Vector3()
const S = new THREE.Vector3()
const HAUT = new THREE.Vector3(0, 1, 0)

function Carpes() {
  const banc = useRef<Koi[]>(koiInitiaux())
  const n = banc.current.length
  const corps = useRef<THREE.InstancedMesh>(null)
  const rides = useRef<THREE.InstancedMesh>(null)
  const phases = useRef(new Float32Array(n))
  const { geometrie, attrKoi, plan, attrRide, jour, temps, matiere, eau } = useMemo(() => {
    const geometrie = corpsDeCarpe()
    const attrKoi = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
    geometrie.setAttribute('aKoi', attrKoi)
    const plan = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const attrRide = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2)
    plan.setAttribute('aRide', attrRide)
    const jour = { value: 1 }
    const temps = { value: 0 }
    return { geometrie, attrKoi, plan, attrRide, jour, temps, matiere: matiereCarpe(jour), eau: matiereRides(temps) }
  }, [n])
  useEffect(() => () => {
    for (const o of [geometrie, plan, matiere, eau]) o.dispose()
  }, [geometrie, plan, matiere, eau])

  /* eslint-disable react-hooks/immutability */
  useFrame(({ camera }, delta) => {
    const [c, r] = [corps.current, rides.current]
    if (!c || !r) return
    const dt = dev.gel ? 0 : Math.min(delta, 0.1)
    // Le visiteur, c'est la caméra : dehors et à hauteur d'homme.
    const visiteur = camera.position.y < 3 ? { x: camera.position.x, z: camera.position.z } : null
    // Loin de l'étang, le banc nage quand même, mais on ne le suit pas à chaque image.
    const loin = Math.hypot(camera.position.x - 46, camera.position.z - 65) > 60
    if (!dev.gel && (!loin || Math.random() < 0.1)) banc.current = avancerKoi(banc.current, loin ? 0.1 : dt, visiteur)
    dev.carpes = banc.current
    jour.value = useGameStore.getState().ciel.jour
    temps.value += dt
    banc.current.forEach((k, i) => {
      phases.current[i] += dt * (4 + k.vitesse * 22)
      attrKoi.setXYZW(i, VARIETE[k.variete], k.graine, phases.current[i], k.prof)
      E.set(0, -k.cap, k.tangage, 'YXZ')
      c.setMatrixAt(i, M.compose(P.set(k.x, SURFACE - k.prof - 0.1 * k.taille, k.z), Q.setFromEuler(E), S.setScalar(k.taille)))
      // Le rond, au bout du nez, quand la bouche crève la surface.
      const nez = k.taille * 0.45
      const force = THREE.MathUtils.clamp((0.05 - k.prof) / 0.025, 0, 1)
      attrRide.setXY(i, k.graine, force)
      r.setMatrixAt(i, M.compose(P.set(k.x + Math.cos(k.cap) * nez, SURFACE + 0.01, k.z + Math.sin(k.cap) * nez), Q.setFromAxisAngle(HAUT, 0), S.setScalar(0.55)))
    })
    attrKoi.needsUpdate = true
    attrRide.needsUpdate = true
    c.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <instancedMesh ref={corps} args={[geometrie, undefined, n]} material={matiere} frustumCulled={false} />
      <instancedMesh ref={rides} args={[plan, undefined, n]} material={eau} frustumCulled={false} renderOrder={2} />
    </>
  )
}

// ── Les oiseaux ───────────────────────────────────────────────────────────

/**
 * Un passereau de 15 cm, le bec vers −z : corps, tête, bec, queue et deux ailes.
 * Deux robes par sommet — `color` le moineau, `color2` la mésange bleue — et
 * `aAile` (−1 gauche, +1 droite) pour que le shader batte des ailes.
 */
function corpsDOiseau(): THREE.BufferGeometry {
  type Partie = 'dos' | 'tete' | 'bec' | 'queue' | 'aile'
  const robes: Record<Partie, [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation]> = {
    // [moineau dessus, moineau dessous, mésange dessus, mésange dessous]
    dos: ['#6b4a2c', '#b8ad98', '#6f8a3a', '#f0cf3a'],
    tete: ['#7a7470', '#d8d2c6', '#3b6fc4', '#f4f1ea'],
    bec: ['#2a2622', '#2a2622', '#1e1e22', '#1e1e22'],
    queue: ['#4a3422', '#4a3422', '#3d5f9a', '#3d5f9a'],
    aile: ['#7a5230', '#5a3c22', '#4a72b8', '#3a5a90'],
  }
  const parties: [Partie, THREE.BufferGeometry, number][] = [
    ['dos', new THREE.SphereGeometry(1, 8, 6).scale(0.034, 0.032, 0.056).translate(0, 0.05, 0.005), 0],
    ['tete', new THREE.SphereGeometry(1, 8, 6).scale(0.026, 0.026, 0.028).translate(0, 0.082, -0.045), 0],
    ['bec', new THREE.ConeGeometry(0.008, 0.02, 5).rotateX(-Math.PI / 2).translate(0, 0.078, -0.078), 0],
    ['queue', new THREE.BoxGeometry(0.028, 0.004, 0.06).rotateX(-0.25).translate(0, 0.058, 0.075), 0],
    ['aile', ala(-1), -1],
    ['aile', ala(1), 1],
  ]
  function ala(cote: number) {
    const g = new THREE.BufferGeometry()
    const p = [[0.02, 0.066, -0.025], [0.02, 0.066, 0.035], [0.1, 0.07, 0.03], [0.085, 0.07, -0.01]].map(([x, y, z]) => [x * cote, y, z])
    g.setAttribute('position', new THREE.Float32BufferAttribute([...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]], 3))
    return g
  }
  const c = new THREE.Color()
  const morceaux = parties.map(([partie, g0, aile]) => {
    const g = g0.index ? g0.toNonIndexed() : g0
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    const p = g.getAttribute('position')
    const [c1, c2, a] = [new Float32Array(p.count * 3), new Float32Array(p.count * 3), new Float32Array(p.count)]
    const [mDessus, mDessous, tDessus, tDessous] = robes[partie]
    for (let i = 0; i < p.count; i++) {
      const dessous = p.getY(i) < (partie === 'tete' ? 0.078 : 0.047) && partie !== 'aile'
      c.set(dessous ? mDessous : mDessus).toArray(c1, 3 * i)
      c.set(dessous ? tDessous : tDessus).toArray(c2, 3 * i)
      a[i] = aile
    }
    g.setAttribute('color', new THREE.BufferAttribute(c1, 3))
    g.setAttribute('color2', new THREE.BufferAttribute(c2, 3))
    g.setAttribute('aAile', new THREE.BufferAttribute(a, 1))
    return g
  })
  const g = mergeGeometries(morceaux)!
  g.computeVertexNormals()
  for (const m of morceaux) m.dispose()
  return g
}

/**
 * Les ailes battent autour de l'axe du corps, à l'épaule ; repliées, elles
 * rétrécissent et se couchent sur le flanc. `aVol` : (phase, en vol, espèce, —).
 */
function matiereOiseau(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 color2;
        attribute float aAile;
        attribute vec4 aVol;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = mix(color, color2, aVol.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aAile != 0.0) {
          float battement = mix(-1.1, 0.9 * sin(aVol.x), aVol.y);
          vec2 d = vec2(transformed.x - aAile * 0.02, transformed.y - 0.066);
          d.x *= mix(0.35, 1.0, aVol.y);
          float a = battement * aAile;
          transformed.xy = vec2(aAile * 0.02, 0.066) + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
        }`)
  }
  m.customProgramCacheKey = () => 'faune:oiseau'
  return m
}

/**
 * Le BORD du houppier, dans son repère : où un oiseau posé se voit. Dessus,
 * le feuillage le cache à qui regarde d'en bas ; dedans, partout. Sur chaque
 * rayon partant du tronc, des rayons tombés du ciel tous les 25 cm cherchent
 * le dernier qui touche une carte de feuillage : l'oiseau s'y pose, sur la
 * feuille, en silhouette sur le ciel ou sur l'arbre d'en face.
 */
function bordsDuHouppier(g: THREE.BufferGeometry, azimuts = 48): Point3[] {
  const maillage = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const rayon = new THREE.Raycaster()
  const [haut, bas] = [new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]
  g.computeBoundingBox()
  const { max } = g.boundingBox!
  const out: Point3[] = []
  for (let a = 0; a < azimuts; a++) {
    const [c, s] = [Math.cos((2 * Math.PI * a) / azimuts), Math.sin((2 * Math.PI * a) / azimuts)]
    let bord: Point3 | null = null
    for (let r = 1; r < 6; r += 0.25) {
      rayon.set(haut.set(c * r, max.y + 1, s * r), bas)
      const touche = rayon.intersectObject(maillage)[0]
      if (touche && touche.point.y > 1.2) bord = [c * r, touche.point.y, s * r]
    }
    if (bord) out.push(bord)
  }
  ;(maillage.material as THREE.Material).dispose()
  return out
}

/** Branches nues : le bout des rameaux, haut (plus de 2 m) et loin du tronc (plus de 1,5 m), un point tous les 40 cm. */
function rameaux(g: THREE.BufferGeometry): Point3[] {
  const p = g.getAttribute('position')
  const out: Point3[] = []
  for (let i = 0; i < p.count; i += 5) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    if (y > 2 && Math.hypot(x, z) > 1.5 && !out.some((q) => Math.hypot(q[0] - x, q[1] - y, q[2] - z) < 0.4)) out.push([x, y + 0.03, z])
  }
  return out
}

/** Les perchoirs, une fois les érables chargés : on se pose sur leurs vraies branches. */
function Oiseaux() {
  const [ps, setPs] = useState<Perchoir[] | null>(null)
  useEffect(() => {
    let vivant = true
    void parkAssetsResource().then(({ especes }) => {
      const branches: Record<string, Point3[]> = {}
      for (const [espece, lots] of especes) {
        if (!espece.startsWith('erable')) continue
        // Houppier plein : au bord des feuilles. Branches nues (l'hiver, `saison.chute`) : sur le bois.
        const nu = useGameStore.getState().saison.chute > 0.5
        const lot = lots.find((l) => l.material.name.startsWith(nu ? 'Jardin_Ecorce' : 'Jardin_Feuillage'))
        if (lot) branches[espece] = nu ? rameaux(lot.geometry) : bordsDuHouppier(lot.geometry)
      }
      if (vivant) setPs(perchoirs(PARC, branches))
    })
    return () => { vivant = false }
  }, [])
  return ps && <Volee ps={ps} />
}

function Volee({ ps: PERCHOIRS }: { ps: Perchoir[] }) {
  const volee = useRef<Oiseau[]>(oiseauxInitiaux(PERCHOIRS, 16))
  const n = volee.current.length
  const ref = useRef<THREE.InstancedMesh>(null)
  const phases = useRef(new Float32Array(n).map((_, i) => i * 2.3))
  const { geometrie, attr, matiere } = useMemo(() => {
    const geometrie = corpsDOiseau()
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
    geometrie.setAttribute('aVol', attr)
    return { geometrie, attr, matiere: matiereOiseau() }
  }, [n])
  useEffect(() => () => {
    geometrie.dispose()
    matiere.dispose()
  }, [geometrie, matiere])

  /* eslint-disable react-hooks/immutability */
  useFrame(({ camera }, delta) => {
    const mesh = ref.current
    if (!mesh) return
    // La nuit, ils dorment au creux des arbres : on ne les voit plus.
    mesh.visible = useGameStore.getState().ciel.jour > 0.15
    if (!mesh.visible) return
    const dt = dev.gel ? 0 : Math.min(delta, 0.1)
    const visiteur = camera.position.y < 3 ? { x: camera.position.x, z: camera.position.z } : null
    if (dev.envol) {
      dev.envol = false
      // Un visiteur fictif sous chaque oiseau : tous décollent.
      volee.current = volee.current.map((o) => avancerOiseaux([o], PERCHOIRS, 0, { x: o.x, z: o.z }, Math.random)[0])
    }
    const { pluie, neige } = useGameStore.getState().meteo
    if (!dev.gel) volee.current = avancerOiseaux(volee.current, PERCHOIRS, dt, visiteur, Math.random, Math.max(pluie, neige))
    dev.oiseaux = volee.current
    dev.perchoirs = PERCHOIRS
    volee.current.forEach((o, i) => {
      const vol = o.etat === 'vol'
      phases.current[i] += dt * (vol ? 55 : 0)
      attr.setXYZW(i, phases.current[i], vol ? 1 : 0, o.espece === 'mesange' ? 1 : 0, 0)
      // Un saut : une parabole de 6 cm ; un coup de bec : le corps qui plonge.
      const bond = 0.06 * Math.sin(Math.PI * o.saut)
      const bec = 0.7 * Math.sin(Math.PI * o.picore)
      E.set(vol ? 0.15 : -bec, o.cap, 0, 'YXZ')
      mesh.setMatrixAt(i, M.compose(P.set(o.x, o.y + bond, o.z), Q.setFromEuler(E), S.setScalar(1.15)))
    })
    attr.needsUpdate = true
    mesh.instanceMatrix.needsUpdate = true
  })
  /* eslint-enable react-hooks/immutability */

  return <instancedMesh ref={ref} args={[geometrie, undefined, n]} material={matiere} frustumCulled={false} />
}

// ── Les lucioles ──────────────────────────────────────────────────────────

const NB_LUCIOLES = 300

/**
 * Les lucioles volent de juin à la mi-septembre : ni au débourrement, ni quand
 * les érables tournent, ni sous la pelouse terne de l'hiver. 0 à 1.
 */
const saisonDesLucioles = (s: Saison): number => (1 - s.chute) * (1 - s.feuillage) * (1 - s.pelouse.terne) * (1 - s.tendre)

/** Où elles dansent : sur les berges de l'étang, le long du ruisseau, sous les érables. */
function nuageDeLucioles(): THREE.BufferGeometry {
  const alea = generateur('lucioles')
  const erables = PARC.plantations.filter((p) => p.espece.startsWith('erable') && Math.hypot(p.x - 46, p.z - 50) < 45)
  const pos: number[] = []
  const graines: number[] = []
  while (pos.length < NB_LUCIOLES * 3) {
    const u = alea()
    let x: number
    let z: number
    if (u < 0.5) {
      const [a, b] = [CONTOUR_ETANG[Math.floor(alea() * CONTOUR_ETANG.length)], alea() * 3.5 - 1.2]
      const [cx, cz] = [46, 65]
      const l = Math.hypot(a[0] - cx, a[1] - cz)
      ;[x, z] = [a[0] + ((a[0] - cx) / l) * b, a[1] + ((a[1] - cz) / l) * b]
    } else if (u < 0.72) {
      const t = TRACE_RUISSEAU[Math.floor(alea() * TRACE_RUISSEAU.length)]
      ;[x, z] = [t[0] + (alea() - 0.5) * 5, t[1] + (alea() - 0.5) * 5]
    } else {
      const e = erables[Math.floor(alea() * erables.length)]
      const [th, r] = [alea() * 2 * Math.PI, Math.sqrt(alea()) * e.rayon]
      ;[x, z] = [e.x + Math.cos(th) * r, e.z + Math.sin(th) * r]
    }
    // Jamais dans le musée.
    if (x > -1 && x < 49 && z > -1 && z < 41) continue
    const sol = distanceEtang(x, z) < 0 ? JARDIN.etang.niveau : hauteurDuParc(x, z)
    pos.push(x, sol + 0.25 + alea() * 1.5, z)
    graines.push(alea(), alea(), alea(), alea())
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aGraine', new THREE.Float32BufferAttribute(graines, 4))
  return g
}

/**
 * Des points additifs, un seul appel de dessin : chaque luciole erre sur une
 * somme de sinus (un brownien de poche) et s'allume à son rythme — un éclat
 * d'une demi-seconde, puis le noir. Au-dessus de 1, la lueur passe le seuil
 * du bloom : un halo, sans éclairer quoi que ce soit.
 */
function Lucioles() {
  const geometrie = useMemo(() => nuageDeLucioles(), [])
  const uniforms = useMemo(() => ({ uTemps: { value: 0 }, uNuit: { value: 0 }, uEchelle: { value: 400 } }), [])
  const matiere = useMemo(() => new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTemps;
      uniform float uNuit;
      uniform float uEchelle;
      attribute vec4 aGraine;
      varying float vEclat;
      void main() {
        vec4 g = aGraine * 6.2831;
        float t = uTemps;
        vec3 p = position + vec3(
          sin(t * 0.31 + g.x) * 0.9 + sin(t * 0.83 + g.y) * 0.35,
          sin(t * 0.47 + g.z) * 0.35 + sin(t * 1.1 + g.w) * 0.12,
          sin(t * 0.37 + g.y) * 0.9 + sin(t * 0.71 + g.z) * 0.35);
        // Un éclat par cycle de 2 à 5 s, décalé pour chacune.
        float cycle = 2.0 + aGraine.w * 3.0;
        float f = fract(t / cycle + aGraine.x);
        vEclat = uNuit * (smoothstep(0.0, 0.12, f) * smoothstep(0.6, 0.25, f) + 0.1);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uEchelle * 0.16 / -mv.z * (0.5 + vEclat), 2.0, 30.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vEclat;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (exp(-r * r * 14.0) + 0.35 * exp(-r * r * 3.0)) * vEclat;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.6, 1.25, 0.45) * a, a);
      }`,
  }), [uniforms])
  useEffect(() => () => {
    geometrie.dispose()
    matiere.dispose()
  }, [geometrie, matiere])
  const points = useRef<THREE.Points>(null)
  /* eslint-disable react-hooks/immutability */
  useFrame(({ gl, size }, delta) => {
    const jour = useGameStore.getState().ciel.jour
    // Elles naissent au crépuscule, pleinement là quand la nuit est faite — les nuits chaudes et sèches seulement.
    const { saison, meteo } = useGameStore.getState()
    uniforms.uNuit.value = (1 - THREE.MathUtils.smoothstep(jour, 0.05, 0.3)) * saisonDesLucioles(saison) * (1 - meteo.pluie) * (1 - meteo.neige)
    uniforms.uTemps.value += dev.gel ? 0 : delta
    uniforms.uEchelle.value = size.height * gl.getPixelRatio()
    if (points.current) points.current.visible = uniforms.uNuit.value > 0.001
  })
  /* eslint-enable react-hooks/immutability */
  return <points ref={points} geometry={geometrie} material={matiere} frustumCulled={false} />
}

// ── Les hérissons ─────────────────────────────────────────────────────────

/**
 * Les hérissons (`domain/herisson.ts` décide où va chacun) : un seul maillage
 * Meshy aux piquants modelés (`tools/blender/build-herisson.py`), le nez vers
 * +x, les pieds à 0, instancié quatre fois — un seul appel de dessin pour la
 * famille. Leurs trois gestes se font dans le vertex shader, sans squelette ni
 * cible de morphose à télécharger — `aGeste`, par individu :
 * - x `boule` : le corps enroulé autour d'un axe transversal, le dos dehors,
 *   la tête et la croupe rentrées dessous (0 à 1) ;
 * - y `tete` : la tête qui tourne autour du cou, levée (> 0) ou au sol (< 0) ;
 * - z `pas` : les pattes en diagonale, avant gauche et arrière droite d'un
 *   côté, les deux autres de l'autre (−1 à 1, au rythme du trot) ;
 * - w `eclat` : l'éclat des yeux et de la truffe mouillée, la nuit (0 le
 *   jour) — un reflet minuscule, tourné vers qui le regarde, plus vif près
 *   d'un lampadaire. Ni lumière, ni halo : on le découvre en s'approchant.
 * `aTeinte` : 0 le pelage brun des petits, 1 celui des adultes, plus clair et
 * plus gris. Le dandinement, le rebond et la taille de chacun sont dans sa
 * matrice d'instance : tout ici est en coordonnées du modèle (15 cm).
 */
function matiereHerisson(m: THREE.MeshStandardMaterial, g: THREE.BufferGeometry): void {
  g.computeBoundingBox()
  const [x0, x1, h] = [g.boundingBox!.min.x, g.boundingBox!.max.x, g.boundingBox!.max.y]
  const xc = (x0 + x1) / 2
  // L'axe du corps fait 1,7 demi-tour ; `r` va de 12 mm (le ventre) à 12 mm + 0,6 h (le dos).
  const neutre = (x1 - x0) / (1.7 * Math.PI)
  // Le dessous de la boule (la tête et la croupe rentrées), pour la poser au sol.
  const p = g.getAttribute('position')
  let dessous = 0
  for (let i = 0; i < p.count; i++) dessous = Math.min(dessous, Math.cos((p.getX(i) - xc) / neutre) * (0.012 + 0.6 * Math.max(0, p.getY(i))))
  const f = (v: number) => v.toFixed(5)
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aGeste;
        attribute float aTeinte;
        varying vec3 vRepos;
        varying float vEclat;
        varying float vTeinte;
        vec2 tourne(vec2 v, float a) { return vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a)); }`)
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = normal;
        vec3 pH = position;
        vRepos = position;
        vEclat = aGeste.w;
        vTeinte = aTeinte;
        // Les pattes, sous 2,2 cm : ±9 mm en diagonale.
        float jambe = 1.0 - smoothstep(0.004, 0.022, pH.y);
        pH.x += 0.009 * aGeste.z * jambe * sign(1e-5 - pH.z) * sign(pH.x - ${f(xc - 0.01)});
        // La tête, devant le cou : 18° au plus.
        vec2 cou = vec2(${f(x1 - 0.055)}, ${f(0.42 * h)});
        float a = 0.314 * aGeste.y * smoothstep(cou.x - 0.012, cou.x + 0.018, pH.x);
        pH.xy = cou + tourne(pH.xy - cou, a);
        objectNormal.xy = tourne(objectNormal.xy, a);
        // La boule.
        float t = (pH.x - ${f(xc)}) / ${f(neutre)};
        float r = 0.012 + max(pH.y, 0.0) * 0.6;
        vec3 roule = vec3(sin(t) * r, cos(t) * r - (${f(dessous)}), pH.z * 1.05);
        vec3 nRoule = vec3(objectNormal.x * cos(t) + objectNormal.y * sin(t), -objectNormal.x * sin(t) + objectNormal.y * cos(t), objectNormal.z);
        pH = mix(pH, roule, aGeste.x);
        objectNormal = normalize(mix(objectNormal, nRoule, aGeste.x));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pH;')
    // La texture de Meshy est terne : sur la photo, la pointe crème des piquants tranche
    // sur leur base brun-noir, et le poil du visage est gris-brun. On éclaircit le clair.
    // Les yeux et la truffe, noirs sur la texture (relevés dans le GLB) : de petites
    // sphères autour de chacun, et seulement là où la texture est sombre.
    // Les adultes : le même brun, passé, plus gris et un peu plus clair.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRepos;
        varying float vEclat;
        varying float vTeinte;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float lumH = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        vec3 oeil = vec3(vRepos.x - ${f(x1 - 0.0225)}, vRepos.y - 0.027, abs(vRepos.z) - 0.0145);
        vec3 truffe = vRepos - vec3(${f(x1 - 0.0035)}, 0.011, 0.0);
        float sombre = 1.0 - smoothstep(0.04, 0.1, lumH);
        float yeux = (1.0 - smoothstep(0.003, 0.0065, length(oeil))) * sombre;
        float nez = (1.0 - smoothstep(0.004, 0.008, length(truffe))) * sombre;
        diffuseColor.rgb *= vec3(1.06, 1.0, 0.88) * (1.0 + 1.7 * smoothstep(0.07, 0.3, lumH));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lumH * 2.0) * vec3(1.0, 0.96, 0.9), 0.3 * vTeinte * (1.0 - yeux - nez)) * (1.0 + 0.06 * vTeinte);`)
      // Mouillés : lisses.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.15, yeux);`)
      // Le reflet : un point de lumière sur la face tournée vers l'œil qui regarde.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // La truffe, elle, n'a qu'un lustre : un point plus serré et plus faible — pas une perle.
        float face = max(dot(normal, normalize(vViewPosition)), 0.0);
        totalEmissiveRadiance += vec3(1.0, 0.93, 0.8) * (vEclat * (yeux * face * face * face + 0.4 * nez * pow(face, 16.0)));`)
  }
  m.customProgramCacheKey = () => 'faune:herissons'
}

let herissonPromis: Promise<THREE.Mesh | null> | null = null
function useHerisson(): THREE.Mesh | null {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null)
  useEffect(() => {
    let vivant = true
    herissonPromis ??= (async () => {
      const base = import.meta.env.BASE_URL
      const draco = new DRACOLoader()
      draco.setDecoderPath(`${base}draco/`)
      const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`${base}assets/faune/herisson.glb`)
      draco.dispose()
      let m: THREE.Mesh | null = null
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) m = o as THREE.Mesh })
      return m
    })().catch((e: unknown) => {
      console.warn('hérisson indisponible', e)
      return null
    })
    void herissonPromis.then((m) => vivant && setMesh(m))
    return () => { vivant = false }
  }, [])
  return mesh
}

/** Le soleil et l'hiver du moment : ils hibernent quand la pelouse s'éteint. */
function heureDesHerissons(): [number, boolean] {
  const { ciel, saison } = useGameStore.getState()
  return [ciel.elevation, saison.pelouse.terne > 0.5]
}

/** Une graine par session : ils ne sont pas deux fois au même endroit. */
const GRAINE_HERISSON = Math.floor(Math.random() * 2 ** 31)

/** Sous les globes : ce qu'il reçoit des lampadaires à moins de 7 m (la flaque de `lueurs.ts`). */
function flaqueDesLampadaires(x: number, z: number): number {
  let f = 0
  for (const [lx, , lz] of SOURCES_LAMPADAIRES) {
    const a = 1 - Math.hypot(lx - x, lz - z) / 7
    if (a > 0) f += a * a
  }
  return Math.min(1, f)
}

/** Le froissement, s'il y a du son : le moteur n'existe qu'après un geste, et se tait coupé ou en pause. */
function froisser(x: number, z: number, force: number, voix: number) {
  const m = moteurCourant()
  if (!m || !useSon.getState().actif || m.ctx.state !== 'running') return
  m.froisser([x, solDuParc(x, z) + 0.05, z], force, voix)
}

/** On n'entend que les deux plus proches : quatre hérissons qui fouillent, ce serait un vacarme. */
const VOIX = 2

function Herissons() {
  const mesh = useHerisson()
  return mesh && <HerissonsVivants modele={mesh} />
}

const M4 = new THREE.Matrix4()
const Q4 = new THREE.Quaternion()
const V3 = new THREE.Vector3()
const S3 = new THREE.Vector3()
const RIEN = new THREE.Matrix4().makeScale(0, 0, 0)

function HerissonsVivants({ modele }: { modele: THREE.Mesh }) {
  const n = FAMILLE.length
  const etat = useRef<EtatDuHerisson[]>(familleInitiale(...heureDesHerissons(), GRAINE_HERISSON))
  const lot = useRef<THREE.InstancedMesh>(null)
  // Chacun son horloge, décalée : ils ne flairent pas en chœur.
  const horloges = useRef(FAMILLE.map((_, i) => ({ pas: i * 1.3, flair: i * 2.7 })))
  const [geste, teinte] = useMemo(() => {
    const geste = new THREE.InstancedBufferAttribute(new Float32Array(4 * n), 4)
    const teinte = new THREE.InstancedBufferAttribute(new Float32Array(FAMILLE.map((i) => i.teinte)), 1)
    geste.setUsage(THREE.DynamicDrawUsage)
    return [geste, teinte]
  }, [n])
  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    modele.geometry.setAttribute('aGeste', geste)
    modele.geometry.setAttribute('aTeinte', teinte)
    matiereHerisson(modele.material as THREE.MeshStandardMaterial, modele.geometry)
    ;(modele.material as THREE.Material).needsUpdate = true
    /* eslint-enable react-hooks/immutability */
  }, [modele, geste, teinte])

  useFrame(({ camera }, delta) => {
    const m = lot.current
    if (!m) return
    const dt = dev.gel ? 0 : Math.min(delta, 0.1)
    let f = etat.current
    if (dev.placer.size) {
      f = f.map((h, i) => (dev.placer.has(i) ? { ...h, ...dev.placer.get(i) } : h))
      dev.placer.clear()
    }
    const sol = hauteurDuParc(camera.position.x, camera.position.z)
    const visiteur = camera.position.y - sol < 3 ? { x: camera.position.x, z: camera.position.z } : null
    // Figés pour une photo : ils gardent la pose qu'on leur a donnée, même sous le nez de l'objectif.
    f = etat.current = dev.gel ? f : avancerFamille(f, dt, visiteur, ...heureDesHerissons())
    dev.herissons = f
    // Les voix : les deux plus proches du visiteur, dehors.
    const proches = f.filter((h) => h.etat !== 'nid').sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z)).slice(0, VOIX)
    const nuit = 1 - useGameStore.getState().ciel.jour

    /* eslint-disable react-hooks/immutability */
    for (let i = 0; i < n; i++) {
      const h = f[i]
      const { echelle, demiLongueur } = FAMILLE[h.qui]
      const dehors = h.etat !== 'nid'
      // L'herbe se couche sous lui (sinon elle le noie) ; au nid, plus rien.
      FOULE.value[i].set(h.x, h.z, dehors ? 0.3 * echelle : 0)
      if (!dehors) {
        m.setMatrixAt(i, RIEN)
        continue
      }
      // Le trot : quatre à cinq foulées par seconde à son pas, des pattes de deux centimètres (à quinze centimètres).
      const c = horloges.current[i]
      const foulee = Math.floor(c.pas / Math.PI)
      c.pas += dt * h.vitesse * (2 * Math.PI / (0.028 * echelle))
      c.flair += dt
      // Il froisse l'herbe : à chaque pas qu'il trotte, et par à-coups quand il fouille du museau.
      const voix = proches.indexOf(h)
      const bruisse = h.etat === 'marche' ? Math.floor(c.pas / Math.PI) !== foulee : h.etat === 'flaire' && Math.random() < dt * 2.5
      if (voix >= 0 && bruisse && dt > 0) froisser(h.x, h.z, (h.etat === 'marche' ? 1 : 0.6) * Math.sqrt(echelle / ECHELLE_HERISSON), voix)
      const marche = Math.min(1, h.vitesse / 0.08)
      const roule = THREE.MathUtils.smoothstep(h.boule, 0, 1)
      const deroule = 1 - roule
      // Il flaire : le museau monte et descend vite, par salves, la tête plus basse entre deux.
      const flaire = h.etat === 'flaire' ? 1 : 0.3 * marche
      const salve = 0.5 + 0.5 * Math.sin(c.flair * 1.3)
      const tete = flaire * (0.35 * Math.sin(c.flair * 17) * salve - 0.3 + 0.4 * Math.sin(c.flair * 0.7))
      // L'éclat des yeux, la nuit : un soupçon sous la lune, vif sous un lampadaire allumé.
      const eclat = nuit * 0.15 + 0.6 * LAMPES.x * flaqueDesLampadaires(h.x, h.z)
      geste.setXYZW(i, roule, tete * deroule, Math.sin(c.pas) * marche * deroule, eclat)

      // Posé sur la pente, le nez vers son cap.
      const [x, z, cap] = [h.x, h.z, h.cap]
      const [ax, az] = [Math.cos(cap) * demiLongueur, Math.sin(cap) * demiLongueur]
      const tangage = Math.atan2(solDuParc(x + ax, z + az) - solDuParc(x - ax, z - az), 2 * demiLongueur)
      const devers = Math.atan2(solDuParc(x - az, z + ax) - solDuParc(x + az, z - ax), 2 * demiLongueur)
      const dandine = 0.07 * Math.sin(c.pas) * marche * deroule
      const bond = 0.0025 * echelle * Math.abs(Math.sin(c.pas)) * marche * deroule
      E.set(devers + dandine, -cap, tangage, 'YXZ')
      m.setMatrixAt(i, M4.compose(V3.set(x, solDuParc(x, z) + bond, z), Q4.setFromEuler(E), S3.setScalar(echelle)))
    }
    m.instanceMatrix.needsUpdate = true
    geste.needsUpdate = true
    /* eslint-enable react-hooks/immutability */
  })
  // Roulés, ils débordent de leur boîte au repos : on ne les coupe pas au bord de l'écran.
  return (
    <instancedMesh
      ref={lot}
      args={[modele.geometry, undefined, n]}
      material={modele.material}
      frustumCulled={false}
      userData={{ zone: ZONE_PARC }}
    />
  )
}
