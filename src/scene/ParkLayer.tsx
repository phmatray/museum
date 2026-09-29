/**
 * Le parc à l'écran : la pelouse et son gazon, le parvis et les allées, les arbres.
 *
 * `plan/park.ts` a décidé où, `plan/relief.ts` à quelle cote. Ici : la pelouse
 * posée sur le relief, les allées drapées dessus, les brins d'herbe
 * (`gazon.ts`) et un lot d'instances par essence et par matériau.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Parc, PlantPlacement, EspeceParc } from '../plan/park'
import { hauteurDuParc, masqueDuRelief } from '../plan/relief'
import type { Rect } from '../plan/types'
import { REGLAGE_MATIERE, repetitionMetrique, useCartes, useMatiere } from './materials'
import { creerBrique, creerPierre } from './pierre'
import { enceinte } from '../plan/enceinte'
import { Boites } from './PlanBuilding'
import { AlleesDuParc } from './AlleesDuParc'
import { parkAssetsResource, type ParkAssets, type ParkPiece } from './parkAssets'
import { creerMatieresJardin, preparerSol, uvBoite } from './jardinMatieres'
import { brinsDeGazon, carteDuSol, matiereGazon, type ReglageGazon } from './gazon'
import { useGameStore } from '../stores/gameStore'
import { presDeLEau } from '../plan/jardin'
import { PARC } from '../plan/visibilite'
import { INTEMPERIES, intemperer } from './intemperies'

/** Le bord du terrain descend d'autant : du bout du monde, pas une feuille de papier. */
const EPAISSEUR_SOL = 0.4
/** Assez pour ne pas scintiller avec la pelouse. */
const RELIEF_ALLEE = 0.03
/** Le pas de la grille de la pelouse, en mètres : les bornes du plan tombent sur ses nœuds. */
const PAS_PELOUSE = 1
/** Sous l'herbe, une pelouse plus sombre : on voit l'ombre entre les brins, pas le vert du dessus. */
const TEINTE_PELOUSE = '#a0b377'

/**
 * Deux semis : serré près du visiteur, plus lâche et plus large au loin. Deux
 * appels de dessin pour tout le gazon.
 */
const GAZONS: ReglageGazon[] = [
  { nombre: 110000, cote: 20, rayon: 10, largeur: 0.03, hauteur: [0.1, 0.24] },
  { nombre: 50000, cote: 64, rayon: 31, largeur: 0.09, hauteur: [0.12, 0.28] },
]

export function ParkLayer({ placements }: { placements: Parc }) {
  const assets = useParkAssets()
  const cartes = useCartes('herbe', repetitionMetrique(REGLAGE_MATIERE.herbe.motif))
  // Lambert : la pelouse est mate, sans le reflet de l'environnement ni le lustre d'un spéculaire.
  const herbe = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ name: 'parc:pelouse', map: cartes?.couleur ?? null, color: TEINTE_PELOUSE, vertexColors: true })
    intemperer(m, { pelouse: true })
    return m
  }, [cartes])

  const sol = useMemo(() => pelouse(placements), [placements])
  const campagne = useMemo(() => dehors(placements.terrain), [placements])
  useEffect(() => () => campagne.dispose(), [campagne])
  // Le parvis est dallé de la pierre du hall, comme le seuil d'un vrai musée, et
  // l'axe de l'entrée avec lui ; le gravier est pour les allées du jardin.
  // Le dallage 1 cm au-dessus du gravier : à la même cote, les allées qui le
  // rejoignent se battaient avec lui (deux textures entremêlées, signalé par Philippe).
  const parvis = useMemo(() => dalles(placements.dalles.map((r) => pave(r, 0, RELIEF_ALLEE + 0.01))), [placements])
  const dallage = useMemo(() => creerPierre(), [])
  useEffect(() => () => {
    parvis.dispose()
    dallage.map?.dispose()
    dallage.dispose()
  }, [parvis, dallage])
  useEffect(() => () => sol.dispose(), [sol])
  useEffect(() => () => herbe.dispose(), [herbe])

  const parEspece = useMemo(() => {
    const par = new Map<EspeceParc, PlantPlacement[]>()
    for (const p of placements.plantations) par.set(p.espece, [...(par.get(p.espece) ?? []), p])
    return par
  }, [placements])

  return (
    <group name="parc">
      <mesh geometry={sol} material={herbe} />
      <mesh geometry={campagne} material={herbe} />
      <Enceinte parc={placements} />
      <mesh geometry={parvis} material={dallage} />
      <AlleesDuParc parc={placements} dallage={dallage} />
      <Gazon parc={placements} />
      <FeuillesMortes parc={placements} />
      {assets !== null && <Jardin objets={assets.jardin} herbe={herbe} />}
      {assets !== null &&
        [...parEspece].map(([espece, sujets]) =>
          (assets.especes.get(espece) ?? []).map((lot, i) => <Instances key={`${espece}:${i}`} piece={lot} sujets={sujets} />))}
    </group>
  )
}

/** Le mur d'enceinte (`plan/enceinte.ts`) : brique et pierre du musée, grilles de fer. Trois appels de dessin. */
function Enceinte({ parc }: { parc: Parc }) {
  const mur = useMemo(() => enceinte(parc.terrain, parc.allees), [parc])
  const mats = useMemo(() => {
    const m = { brique: creerBrique(), pierre: creerPierre(), fer: new THREE.MeshStandardMaterial({ color: '#1c1e1d', metalness: 0.7, roughness: 0.45 }) }
    for (const k of ['brique', 'pierre'] as const) intemperer(m[k])
    return m
  }, [])
  useEffect(() => () => Object.values(mats).forEach((m) => { m.map?.dispose(); m.dispose() }), [mats])
  return (
    <>
      <Boites boites={mur.brique} material={mats.brique} />
      <Boites boites={mur.pierre} material={mats.pierre} />
      <Boites boites={mur.fer} material={mats.fer} />
    </>
  )
}

/** Les pas de la campagne, du mur vers l'horizon : serrés près du mur, lâches au loin (en mètres, cumulés). */
const AU_DELA = [2, 5, 9, 14, 20, 28, 38, 52, 70, 95, 130, 180, 250, 340, 460]

/**
 * La campagne, derrière le mur : le relief du parc continue, puis s'aplanit vers
 * l'horizon. Sans elle, du haut d'une butte, on voyait par-dessus le mur le
 * bord du monde : rien sous le ciel. Une grille à pas croissants, percée du
 * terrain (la pelouse du parc y est), qui pâlit au loin comme dans l'air réel.
 */
function dehors(terrain: Rect): THREE.BufferGeometry {
  const axe = (a0: number, a1: number) => {
    const n = Math.round((a1 - a0) / 8)
    return [...AU_DELA.map((d) => a0 - d).reverse(), ...Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n), ...AU_DELA.map((d) => a1 + d)]
  }
  const [xs, zs] = [axe(terrain.x, terrain.x + terrain.width), axe(terrain.z, terrain.z + terrain.depth)]
  const pos: number[] = []
  const couleur: number[] = []
  const index: number[] = []
  // Au-delà de 1 : la brume ÉCLAIRCIT et bleuit le vert au loin (la teinte multiplie la carte).
  const brume = new THREE.Color(1.5, 1.5, 1.95)
  for (const z of zs) {
    for (const x of xs) {
      const d = Math.hypot(Math.max(terrain.x - x, 0, x - terrain.x - terrain.width), Math.max(terrain.z - z, 0, z - terrain.z - terrain.depth))
      pos.push(x, hauteurDuParc(x, z) * (1 - THREE.MathUtils.smoothstep(d, 20, 200)), z)
      const c = new THREE.Color(0.95, 0.97, 0.93).lerp(brume, THREE.MathUtils.smoothstep(d, 40, 460))
      couleur.push(c.r, c.g, c.b)
    }
  }
  const nx = xs.length
  const interieur = (x: number, z: number) => x > terrain.x && x < terrain.x + terrain.width && z > terrain.z && z < terrain.z + terrain.depth
  for (let j = 0; j + 1 < zs.length; j++)
    for (let i = 0; i + 1 < nx; i++) {
      if (interieur((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)) continue
      const v = j * nx + i
      index.push(v, v + nx, v + 1, v + 1, v + nx, v + nx + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(couleur, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((c, i) => (i % 3 === 1 ? [] : [c])), 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** Les brins d'herbe, repliés autour de la caméra (`gazon.ts`). */
function Gazon({ parc }: { parc: Parc }) {
  const sol = useMemo(() => carteDuSol(parc), [parc])
  const lots = useMemo(() => GAZONS.map((r, i) => ({ geometrie: brinsDeGazon(r, 7 + i), ...matiereGazon(sol, r) })), [sol])
  useEffect(() => () => {
    sol.texture.dispose()
    for (const l of lots) {
      l.geometrie.dispose()
      l.material.dispose()
    }
  }, [sol, lots])
  useFrame(({ camera, clock }) => {
    for (const l of lots) l.animer(camera.position.x, camera.position.z, clock.elapsedTime)
  })
  return <>{lots.map((l, i) => <mesh key={i} geometry={l.geometrie} material={l.material} frustumCulled={false} userData={{ zone: PARC }} />)}</>
}

/**
 * La pelouse : une grille d'un mètre sur tout le terrain, posée sur le relief,
 * dont on ne garde que les mailles des bandes `parc.sol` (le parvis et le sol
 * creusé du jardin sont ailleurs). Une jupe borde le terrain. Sa couleur varie
 * à grande échelle, là où le relief vit : une pelouse n'est jamais d'un vert uni.
 */
function pelouse(parc: Parc): THREE.BufferGeometry {
  const { terrain } = parc
  const [nx, nz] = [Math.round(terrain.width / PAS_PELOUSE), Math.round(terrain.depth / PAS_PELOUSE)]
  const pos: number[] = []
  const couleur: number[] = []
  const index: number[] = []
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const [x, z] = [terrain.x + i * PAS_PELOUSE, terrain.z + j * PAS_PELOUSE]
      pos.push(x, hauteurDuParc(x, z), z)
      const v = 1 + masqueDuRelief(x, z) * 0.14 * Math.sin(x * 0.13 + 2 * Math.sin(z * 0.05)) * Math.sin(z * 0.11 - x * 0.04)
      couleur.push(v, v * (1 + 0.04 * Math.sin(x * 0.07 + z * 0.09)), v)
    }
  }
  const v = (i: number, j: number) => j * (nx + 1) + i
  const dans = (x: number, z: number) => parc.sol.some((r) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      if (dans(terrain.x + (i + 0.5) * PAS_PELOUSE, terrain.z + (j + 0.5) * PAS_PELOUSE))
        index.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1))
  // La jupe : le tour du terrain, descendu de `EPAISSEUR_SOL`.
  const tour = [
    ...Array.from({ length: nx }, (_, i) => v(i, 0)), ...Array.from({ length: nz }, (_, j) => v(nx, j)),
    ...Array.from({ length: nx }, (_, i) => v(nx - i, nz)), ...Array.from({ length: nz }, (_, j) => v(0, nz - j)),
  ]
  const n = pos.length / 3
  tour.forEach((k, i) => {
    pos.push(pos[3 * k], -EPAISSEUR_SOL, pos[3 * k + 2])
    couleur.push(1, 1, 1)
    const [a, b] = [k, tour[(i + 1) % tour.length]]
    const [c, d] = [n + i, n + ((i + 1) % tour.length)]
    index.push(a, c, b, b, c, d)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(couleur, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((c, i) => (i % 3 === 1 ? [] : [c])), 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

function pave(r: Rect, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(r.width, y1 - y0, r.depth)
  g.translate(r.x + r.width / 2, (y0 + y1) / 2, r.z + r.depth / 2)
  return g
}

/**
 * Fusionne des morceaux de sol en un seul maillage, UV en MÈTRES lues sur le plan (x, z) :
 * `repetitionMetrique` donne alors la même échelle de gravier sur chaque bande.
 */
function dalles(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    const p = g.getAttribute('position')
    const uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) [uv[2 * i], uv[2 * i + 1]] = [p.getX(i), p.getZ(i)]
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }
  const fusion = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return fusion ?? new THREE.BufferGeometry()
}

function Instances({ piece, sujets }: { piece: ParkPiece; sujets: PlantPlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const haut = new THREE.Vector3(0, 1, 0)
    sujets.forEach((s, i) =>
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q.setFromAxisAngle(haut, s.rotation), new THREE.Vector3().setScalar(s.scale))))
    mesh.instanceMatrix.needsUpdate = true
    // Sinon la sphère englobante est celle d'un arbre à l'origine.
    mesh.computeBoundingSphere()
  }, [sujets])
  return <instancedMesh key={sujets.length} ref={ref} args={[piece.geometry, undefined, sujets.length]} material={piece.material} />
}

/**
 * Le décor fixe du jardin, tel que Blender l'a posé dans le repère du plan :
 * le sol creusé prend la pelouse du parc, l'eau et la cascade leurs matières
 * animées ; galets, pont et lanterne gardent les leurs.
 */
function Jardin({ objets, herbe }: { objets: THREE.Object3D[]; herbe: THREE.Material }) {
  const matieres = useMemo(() => creerMatieresJardin(), [])
  useEffect(() => () => matieres.dispose(), [matieres])
  const pierre = useMatiere('beton', repetitionMetrique(REGLAGE_MATIERE.beton.motif), { teinte: '#b9b6ad' })
  const bois = useMatiere('parquet', repetitionMetrique(REGLAGE_MATIERE.parquet.motif), { teinte: '#6b4a34' })

  const lueurs = useMemo(() => {
    const lueurs = new Set<THREE.MeshStandardMaterial>()
    for (const m of [pierre, bois]) intemperer(m)
    const par: Record<string, THREE.Material> = { sol: herbe, eau: matieres.eau, cascade: matieres.cascade, granit: pierre, bois }
    for (const racine of objets) {
      racine.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const g = o.geometry as THREE.BufferGeometry
        // Le rôle est lu une fois, sur le nom Blender : ensuite, le matériau a changé de nom.
        if (o.userData.jardin === undefined) {
          const nom = (o.material as THREE.Material).name
          const role = nom.startsWith('Jardin_Sol') ? 'sol' : nom.startsWith('Jardin_Eau') ? 'eau'
            : nom.startsWith('Jardin_Cascade') ? 'cascade' : nom.startsWith('Jardin_Granit') ? 'granit'
              : nom.startsWith('Jardin_Bois') ? 'bois' : 'garde'
          if (role === 'sol' || role === 'eau') preparerSol(g, role === 'eau')
          if (role === 'granit' || role === 'bois') uvBoite(g)
          o.userData.jardin = role
        }
        const m = par[o.userData.jardin as string]
        if (m) o.material = m
        else if (o.material instanceof THREE.MeshStandardMaterial && o.material.name.startsWith('Jardin_Lueur')) lueurs.add(o.material)
      })
    }
    for (const l of lueurs) l.userData.eclat ??= l.emissiveIntensity
    return [...lueurs]
  }, [objets, matieres, herbe, pierre, bois])
  // Le foyer de la lanterne ne brûle qu'au crépuscule et la nuit : à 14 h, il
  // luisait en plein soleil comme une ampoule oubliée.
  useFrame(({ clock }) => {
    const jour = useGameStore.getState().ciel.jour
    matieres.animer(clock.elapsedTime, jour)
    for (const l of lueurs) l.emissiveIntensity = (l.userData.eclat as number) * (1 - THREE.MathUtils.smoothstep(jour, 0.15, 0.6))
  })

  return <>{objets.map((o) => <primitive key={o.uuid} object={o} />)}</>
}

/**
 * Les feuilles mortes de l'automne, sous chaque érable : de petites cartes
 * lobées couchées sur le relief, aux couleurs de l'arbre qui les a perdues,
 * plus serrées sous le houppier. Un seul maillage, calculé une fois ; le shader
 * n'en montre qu'une part (`uFeuillesSol`) : chacune tombe et disparaît à son tour.
 */
function FeuillesMortes({ parc }: { parc: Parc }) {
  const geometrie = useMemo(() => feuillesMortes(parc), [parc])
  const materiau = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    // `uFeuillesSol` est déclaré par la greffe d'`intemperer`, posée juste après.
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, INTEMPERIES)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aFeuille;\nattribute vec2 aForme;\nvarying vec2 vFeuille;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = mix(aFeuille.xyz, transformed, step(aFeuille.w, uFeuillesSol));\n  vFeuille = aForme * 2.0 - 1.0;')
      // Une feuille d'érable : cinq lobes découpés dans la carte.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFeuille;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float th = atan(vFeuille.y, vFeuille.x);
  if (length(vFeuille) > 0.4 + 0.6 * pow(abs(cos(2.5 * th)), 1.5)) discard;`)
    }
    m.customProgramCacheKey = () => 'parc:feuilles-mortes'
    intemperer(m)
    return m
  }, [])
  useEffect(() => () => {
    geometrie.dispose()
    materiau.dispose()
  }, [geometrie, materiau])
  return <mesh geometry={geometrie} material={materiau} frustumCulled={false} />
}

const AUTOMNE = {
  'erable-rouge': ['#8c1a12', '#a3230f', '#6e1410', '#5a2a18'].map((c) => new THREE.Color(c)),
  'erable-vert': ['#c8641a', '#d4861c', '#b03a14', '#c9a227', '#7a4a22'].map((c) => new THREE.Color(c)),
}

function feuillesMortes(parc: Parc): THREE.BufferGeometry {
  // Le même tirage à chaque chargement (mulberry32, comme `park.ts`).
  let etat = 0x5eed
  const alea = () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const [pos, uv, couleur, feuille, index] = [[], [], [], [], []] as number[][]
  for (const p of parc.plantations) {
    if (p.espece !== 'erable-rouge' && p.espece !== 'erable-vert') continue
    const palette = AUTOMNE[p.espece]
    const rayon = 3 * p.scale
    for (let k = 0; k < 320 * p.scale; k++) {
      const [a, r] = [alea() * Math.PI * 2, rayon * Math.sqrt(alea()) * (0.35 + 0.65 * alea())]
      const [x, z] = [p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]
      if (presDeLEau(x, z, 0.2)) continue
      const y = hauteurDuParc(x, z) + 0.035 + alea() * 0.006
      const [t, l] = [alea() * Math.PI * 2, 0.06 + alea() * 0.05]
      const [c, s] = [Math.cos(t) * l, Math.sin(t) * l]
      const [rang, w] = [pos.length / 3, alea()]
      const teinte = palette[Math.floor(alea() * palette.length)].clone().multiplyScalar(0.75 + alea() * 0.4)
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(x + u * c - v * s, y + (alea() - 0.5) * 0.01, z + u * s + v * c)
        uv.push((u + 1) / 2, (v + 1) / 2)
        couleur.push(teinte.r, teinte.g, teinte.b)
        feuille.push(x, y, z, w)
      }
      index.push(rang, rang + 2, rang + 1, rang, rang + 3, rang + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('aForme', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(couleur, 3))
  g.setAttribute('aFeuille', new THREE.Float32BufferAttribute(feuille, 4))
  g.setIndex(index)
  return g
}

/** Sans suspendre : le bâtiment d'abord, les arbres ensuite. */
function useParkAssets(): ParkAssets | null {
  const [assets, setAssets] = useState<ParkAssets | null>(null)
  useEffect(() => {
    let vivant = true
    void parkAssetsResource().then((a) => vivant && setAssets(a))
    return () => {
      vivant = false
    }
  }, [])
  return assets
}
