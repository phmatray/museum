/**
 * Le parc à l'écran : la pelouse et son gazon, le parvis et les allées, les arbres.
 *
 * `plan/park.ts` a décidé où, `plan/relief.ts` à quelle cote. Ici : la pelouse
 * posée sur le relief, les allées drapées dessus, les brins d'herbe
 * (`gazon.ts`) et un lot d'instances par essence et par matériau.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Parc, PlantPlacement, EspeceParc } from '../plan/park'
import { ARRONDI_PARVIS, COTE_DALLAGE, distanceParvis, hauteurDuParc, masqueDuRelief } from '../plan/relief'
import type { Rect } from '../plan/types'
import { REGLAGE_MATIERE, repetitionMetrique, useCartes, useMatiere } from './materials'
import { creerBrique, creerPierre } from './pierre'
import { enceinte } from '../plan/enceinte'
import { pierresDuBelvedere } from '../plan/belvedere'
import { Boites } from './PlanBuilding'
import { AlleesDuParc } from './AlleesDuParc'
import { parkAssetsResource, type ParkAssets, type ParkPiece } from './parkAssets'
import { caustiques, creerMatieresJardin, preparerSol, uvBoite } from './jardinMatieres'
import { brinsDeGazon, carteDuSol, champDeVue, matiereGazon, parcellesDeGazon, uneEnVue, type ReglageGazon } from './gazon'
import { useGameStore } from '../stores/gameStore'
import { useChargement } from '../stores/chargementStore'
import { distanceRuisseau, presDeLEau, rubanDuRuisseau } from '../plan/jardin'
import { remous } from '../plan/ruisseau'
import { Ruisseau } from './RuisseauLayer'
import { PARC } from '../plan/visibilite'
import { INTEMPERIES, intemperer, vieillirBrique } from './intemperies'
import { mousserChaperon, pietiner } from './usure'
import { Lierre } from './lierre'

/** Le bord du terrain descend d'autant : du bout du monde, pas une feuille de papier. */
const EPAISSEUR_SOL = 0.4
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
    // Le fond du ruisseau (le sol creusé porte la pelouse) : le soleil y danse.
    caustiques(m)
    return m
  }, [cartes])

  const sol = useMemo(() => pelouse(placements), [placements])
  const campagne = useMemo(() => dehors(placements.terrain), [placements])
  useEffect(() => () => campagne.dispose(), [campagne])
  // Le parvis est dallé de la pierre du hall, comme le seuil d'un vrai musée, et
  // l'axe de l'entrée avec lui ; le gravier est pour les allées du jardin.
  // Le dallage 1 cm au-dessus du gravier : à la même cote, les allées qui le
  // rejoignent se battaient avec lui (deux textures entremêlées, signalé par Philippe).
  const parvis = useMemo(() => dalles(placements.dalles.map((r) => pave(r, placements.parvis, COTE_DALLAGE))), [placements])
  const dallage = useMemo(() => {
    // Mouillé et semé de flaques sous l'averse, comme le gravier qu'il traverse.
    const m = creerPierre()
    // Usé au milieu, moussu dans les joints (`usure.ts`) ; puis mouillé par-dessus.
    pietiner(m, { joints: true })
    intemperer(m, { flaques: true })
    return m
  }, [])
  useEffect(() => () => {
    parvis.dispose()
    dallage.map?.dispose()
    dallage.dispose()
  }, [parvis, dallage])
  useEffect(() => () => sol.dispose(), [sol])
  useEffect(() => () => herbe.dispose(), [herbe])

  const parEspece = useMemo(() => {
    const par = new Map<EspeceParc, PlantPlacement[]>()
    // Les plantations, les herbes de berge et le lierre du mur d'enceinte : un lot d'instances par essence.
    const lierre = enceinte(placements.terrain, placements.allees).lierre
    for (const p of [...placements.plantations, ...placements.berges, ...lierre]) par.set(p.espece, [...(par.get(p.espece) ?? []), p])
    // Les érables — 7 000 triangles chacun, les trois quarts de ceux du parc — et le
    // lierre, qui fait le tour du parc, par parcelle ; le reste, léger, en un lot par essence.
    return new Map([...par].map(([espece, sujets]) => [espece, espece.startsWith('erable') || espece === 'lierre' ? parParcelle(sujets, placements.terrain) : [sujets]]))
  }, [placements])

  return (
    <group name="parc">
      <mesh geometry={sol} material={herbe} />
      <mesh geometry={campagne} material={herbe} />
      <Enceinte parc={placements} dallage={dallage} />
      <mesh geometry={parvis} material={dallage} />
      <AlleesDuParc parc={placements} dallage={dallage} />
      <Gazon parc={placements} />
      <FeuillesMortes parc={placements} />
      {assets !== null && <Jardin objets={assets.jardin} herbe={herbe} parc={placements} />}
      {assets !== null && <Ruisseau pieces={assets.ruisseau} />}
      {assets !== null &&
        [...parEspece].map(([espece, parcelles]) =>
          (assets.especes.get(espece) ?? []).map((lot, i) =>
            parcelles.map((sujets, k) => <Instances key={`${espece}:${i}:${k}`} piece={lot} sujets={sujets} />)))}
    </group>
  )
}

/** Le mur d'enceinte (`plan/enceinte.ts`) : brique et pierre du musée, grilles de fer ; et le belvédère. Quatre appels de dessin. */
function Enceinte({ parc, dallage }: { parc: Parc; dallage: THREE.Material }) {
  const mur = useMemo(() => enceinte(parc.terrain, parc.allees), [parc])
  // Les murs et le parapet du belvédère (`plan/belvedere.ts`) : la même pierre, le même lot ;
  // son dallage et ses marches, la pierre foulée du parvis.
  const [pierres, foulees] = useMemo(() => {
    const b = pierresDuBelvedere(hauteurDuParc)
    return [[...mur.pierre, ...b.filter((x) => x.kind === 'wall')], b.filter((x) => x.kind !== 'wall')]
  }, [mur])
  const mats = useMemo(() => {
    const m = { brique: creerBrique(), pierre: creerPierre(), fer: new THREE.MeshStandardMaterial({ color: '#1c1e1d', metalness: 0.7, roughness: 0.45 }) }
    // La mousse du chaperon d'abord : la neige tient par-dessus.
    mousserChaperon(m.pierre)
    for (const k of ['brique', 'pierre'] as const) intemperer(m[k])
    // Le musée garde sa brique neuve ; le mur du parc, dehors depuis toujours, a vécu.
    vieillirBrique(m.brique)
    return m
  }, [])
  useEffect(() => () => Object.values(mats).forEach((m) => { m.map?.dispose(); m.dispose() }), [mats])
  return (
    <>
      <Boites boites={mur.brique} material={mats.brique} />
      <Boites boites={pierres} material={mats.pierre} />
      <Boites boites={foulees} material={dallage} />
      <Boites boites={mur.fer} material={mats.fer} />
      <Lierre plaques={mur.plaques} />
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

/**
 * Écarter du rendu ce qui n'est pas dans le champ, seulement une fois le musée
 * prêt : la compilation anticipée (`chargement.tsx`) ne voit que le visible, et
 * un programme compilé au premier regard, c'est un à-coup.
 */
const pret = () => useChargement.getState().etape === 'pret'

/** Les brins d'herbe, repliés autour de la caméra (`gazon.ts`). */
function Gazon({ parc }: { parc: Parc }) {
  const sol = useMemo(() => carteDuSol(parc), [parc])
  const lots = useMemo(() => GAZONS.map((r, i) => ({ geometrie: brinsDeGazon(r, 7 + i), rayon: r.rayon, ...matiereGazon(sol, r) })), [sol])
  const parcelles = useMemo(() => parcellesDeGazon(sol, Math.max(...GAZONS.map((r) => r.hauteur[1])) + 0.2), [sol])
  const maillages = useRef<(THREE.Mesh | null)[]>([])
  const cone = useMemo(() => new THREE.Frustum(), [])
  useEffect(() => () => {
    sol.texture.dispose()
    for (const l of lots) {
      l.geometrie.dispose()
      l.material.dispose()
    }
  }, [sol, lots])
  useFrame(({ camera, clock }) => {
    const { x, z } = camera.position
    champDeVue(camera, cone)
    const trie = pret()
    lots.forEach((l, i) => {
      l.animer(x, z, clock.elapsedTime)
      const m = maillages.current[i]
      // Au-delà de `rayon`, plus un brin : seules comptent les parcelles du carré qui l'entoure.
      if (m) m.visible = !trie || uneEnVue(parcelles, cone, { x, z, rayon: l.rayon })
    })
  })
  // `frustumCulled={false}` : leur sphère ne dit rien (voir `parcellesDeGazon`), et
  // `OmbresLayer` ne fait porter d'ombre qu'à ce que le cône de vue trie.
  return (
    <>
      {lots.map((l, i) => (
        <mesh key={i} ref={(m) => { maillages.current[i] = m }} geometry={l.geometrie} material={l.material} frustumCulled={false} userData={{ zone: PARC }} />
      ))}
    </>
  )
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
  // Aux angles arrondis du parvis, la pelouse reprend les mailles que le dallage
  // découvre ; sous la pierre, elle reste 4 cm plus bas que son dessus.
  const { parvis: p } = parc
  const angle = (x: number, z: number) => x > p.x && x < p.x + p.width && z > p.z && z < p.z + p.depth &&
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].some(([u, w]) => distanceParvis(parc.parvis, x + u * PAS_PELOUSE, z + w * PAS_PELOUSE) > 1e-3)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      if (dans(terrain.x + (i + 0.5) * PAS_PELOUSE, terrain.z + (j + 0.5) * PAS_PELOUSE) || angle(terrain.x + (i + 0.5) * PAS_PELOUSE, terrain.z + (j + 0.5) * PAS_PELOUSE))
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

/**
 * Une bande du dallage, de 0 à `haut` : ceux de ses coins qui sont aussi des
 * coins du parvis s'arrondissent de `ARRONDI_PARVIS`, comme les allées.
 */
function pave(r: Rect, parvis: Rect, haut: number): THREE.BufferGeometry {
  const [x0, x1, z0, z1] = [r.x, r.x + r.width, r.z, r.z + r.depth]
  const coin = (x: number, z: number) =>
    (x === parvis.x || x === parvis.x + parvis.width) && (z === parvis.z || z === parvis.z + parvis.depth) ? ARRONDI_PARVIS : 0
  // Le contour dans le plan (x, −z) : `rotateX(−π/2)` le couche en (x, z), l'extrusion vers le haut.
  const f = new THREE.Shape()
  const coins: [number, number, number, number][] = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]]
  coins.forEach(([x, z, sx, sz], i) => {
    const e = coin(x, z)
    const [ax, az] = i % 2 === 0 ? [x, z + sz * e] : [x + sx * e, z]
    const [bx, bz] = i % 2 === 0 ? [x + sx * e, z] : [x, z + sz * e]
    if (i === 0) f.moveTo(ax, -az)
    else f.lineTo(ax, -az)
    if (e === 0) return
    // Un arc de cercle, le même que `distanceParvis` : la bordure et le gazon le suivent.
    const [cx, cz] = [x + sx * e, z + sz * e]
    const t0 = Math.atan2(az - cz, ax - cx)
    let dt = Math.atan2(bz - cz, bx - cx) - t0
    if (dt > Math.PI) dt -= 2 * Math.PI
    if (dt < -Math.PI) dt += 2 * Math.PI
    for (let k = 1; k <= 24; k++) f.lineTo(cx + e * Math.cos(t0 + (dt * k) / 24), -(cz + e * Math.sin(t0 + (dt * k) / 24)))
  })
  f.closePath()
  const g = new THREE.ExtrudeGeometry(f, { depth: haut, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
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

/**
 * Les érables par côté du musée — nord, sud (le tiers du terrain de chaque
 * bout), ouest et est. Un lot d'instances par essence, par matériau ET par
 * côté : chacun sa sphère englobante, que le cône de vue écarte d'un bloc. Un
 * lot pour tout le parc avait une sphère grande comme le parc, jamais écartée —
 * de la nef, face au nord, on dessinait les érables du parvis. Pas plus fin :
 * l'ombre du soleil couvre tout le parc, chaque lot y coûte un appel de dessin.
 */
function parParcelle<T extends { x: number; z: number }>(sujets: readonly T[], terrain: Rect): T[][] {
  const par = new Map<string, T[]>()
  for (const s of sujets) {
    const [u, v] = [(s.x - terrain.x) / terrain.width, (s.z - terrain.z) / terrain.depth]
    const cote = v < 1 / 3 ? 'nord' : v > 2 / 3 ? 'sud' : u < 0.5 ? 'ouest' : 'est'
    par.set(cote, [...(par.get(cote) ?? []), s])
  }
  return [...par.values()]
}

/**
 * L'échelle d'un sujet. Les touffes (buis, azalées) s'étirent en plus, un peu
 * plus larges ou plus hautes, d'un aléa tiré de leur place : un seul modèle,
 * pas deux silhouettes pareilles.
 */
function echelle(s: PlantPlacement): THREE.Vector3 {
  const e = new THREE.Vector3().setScalar(s.scale)
  if (s.espece !== 'buis' && s.espece !== 'azalee') return e
  const h = (k: number) => Math.abs(Math.sin(s.x * (12.9898 + k) + s.z * (78.233 - k)) * 43758.5453) % 1
  return e.multiply(new THREE.Vector3(0.85 + 0.35 * h(1), 0.75 + 0.5 * h(2), 0.85 + 0.35 * h(3)))
}

/** Au-delà, un érable prend sa géométrie de loin ; il ne reprend la proche qu'en deçà de `LOIN - 3`. */
const LOIN = 36

/**
 * Un lot, en deux maillages : les sujets proches avec la géométrie pleine, les
 * lointains avec celle de loin (`loin_*` de `vegetation.glb`), même matériau — donc même
 * saison, même vent, même arbre (`iArbre` est tiré de sa matrice). Chaque
 * sujet passe de l'un à l'autre selon SA distance ; les deux maillages
 * gardent la sphère de tout le lot.
 */
function Instances({ piece, sujets }: { piece: ParkPiece; sujets: PlantPlacement[] }) {
  const proche = useRef<THREE.InstancedMesh>(null)
  const lointain = useRef<THREE.InstancedMesh>(null)
  const loin = useRef<boolean[]>([])
  const matrices = useMemo(() => {
    const q = new THREE.Quaternion()
    const haut = new THREE.Vector3(0, 1, 0)
    return sujets.map((s) =>
      new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q.setFromAxisAngle(haut, s.rotation), echelle(s)))
  }, [sujets])
  const repartir = useCallback(() => {
    const n = [0, 0]
    const maillages = [proche.current, lointain.current]
    matrices.forEach((m, i) => {
      const k = loin.current[i] ? 1 : 0
      maillages[k]?.setMatrixAt(n[k]++, m)
    })
    maillages.forEach((mesh, k) => {
      if (mesh === null) return
      mesh.count = n[k]
      mesh.visible = n[k] > 0
      mesh.instanceMatrix.needsUpdate = true
    })
  }, [matrices])
  useEffect(() => {
    const [p, l] = [proche.current, lointain.current]
    if (p === null) return
    loin.current = matrices.map(() => false)
    repartir()
    // Sinon la sphère englobante est celle d'un arbre à l'origine. La géométrie
    // de loin partage celle de la proche (`parkAssets.ts`) : elle vaut pour les deux.
    p.computeBoundingSphere()
    if (l !== null) l.boundingSphere = p.boundingSphere!.clone()
  }, [matrices, repartir])
  useFrame(({ camera }) => {
    if (piece.loin === undefined) return
    const { x, z } = camera.position
    let change = false
    sujets.forEach((s, i) => {
      const d = Math.hypot(s.x - x, s.z - z)
      const l = loin.current[i] ? d > LOIN - 3 : d > LOIN
      change ||= l !== loin.current[i]
      loin.current[i] = l
    })
    if (change) repartir()
  })
  // Le tri des salles (`tri.ts`) n'a rien à compacter ici : tout le lot est au parc.
  return (
    <>
      <instancedMesh key={sujets.length} ref={proche} args={[piece.geometry, undefined, sujets.length]} material={piece.material} userData={{ zone: PARC }} />
      {piece.loin && (
        <instancedMesh key={`loin:${sujets.length}`} ref={lointain} args={[piece.loin, undefined, sujets.length]} material={piece.material} userData={{ zone: PARC }} />
      )}
    </>
  )
}

/**
 * Le décor fixe du jardin, tel que Blender l'a posé dans le repère du plan :
 * le sol creusé prend la pelouse du parc, l'eau et la cascade leurs matières
 * animées ; galets, pont et lanterne gardent les leurs.
 */
function Jardin({ objets, herbe, parc }: { objets: THREE.Object3D[]; herbe: THREE.Material; parc: Parc }) {
  // Les rochers posés dans le courant (`park.ts`) lèvent leur écume, comme souches et galets.
  const matieres = useMemo(() => creerMatieresJardin(remous(parc.plantations
    .filter((p) => p.espece.startsWith('rocher') && distanceRuisseau(p.x, p.z) < 0).map((p): [number, number, number] => [p.x, p.z, p.rayon * 0.6]))), [parc])
  useEffect(() => () => matieres.dispose(), [matieres])
  // Le ruisseau : un ruban continu, UV le long du courant (`rubanDuRuisseau`).
  const ruban = useMemo(() => {
    const r = rubanDuRuisseau()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(r.position, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2))
    g.setAttribute('aEau', new THREE.BufferAttribute(r.eau, 2))
    g.setIndex(r.index)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [])
  useEffect(() => () => ruban.dispose(), [ruban])
  // Le granit des pas japonais, de la lanterne et des culées : la roche des dalles des allées, pas du béton.
  const pierre = useMatiere('roche', repetitionMetrique(REGLAGE_MATIERE.roche.motif), { teinte: '#c4c6c2' })
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

  return (
    <>
      {objets.map((o) => <primitive key={o.uuid} object={o} />)}
      <mesh geometry={ruban} material={matieres.ruisseau} userData={{ zone: PARC }} />
    </>
  )
}

/**
 * Les feuilles mortes de l'automne, sous chaque érable : de petites cartes
 * lobées couchées sur le relief, aux couleurs de l'arbre qui les a perdues,
 * plus serrées sous le houppier. Un seul maillage, calculé une fois ; le shader
 * n'en montre qu'une part (`uFeuillesSol`) : chacune tombe et disparaît à son tour.
 */
function FeuillesMortes({ parc }: { parc: Parc }) {
  const { geometrie, boites } = useMemo(() => feuillesMortes(parc), [parc])
  const maillage = useRef<THREE.Mesh>(null)
  const cone = useMemo(() => new THREE.Frustum(), [])
  // Hors de l'automne, toutes repliées : rien à dessiner. Sinon, seulement si
  // le tapis d'un érable est dans le champ — un seul maillage pour tout le parc,
  // sa sphère englobante ne l'écarterait jamais.
  useFrame(({ camera }) => {
    if (maillage.current) maillage.current.visible = !pret() || (INTEMPERIES.uFeuillesSol.value > 0 && uneEnVue(boites, champDeVue(camera, cone)))
  })
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
  // Couchées sur le sol, elles ne portent pas d'ombre (`frustumCulled={false}`, `OmbresLayer`).
  return <mesh ref={maillage} geometry={geometrie} material={materiau} frustumCulled={false} userData={{ zone: PARC }} />
}

const AUTOMNE = {
  'erable-rouge': ['#8c1a12', '#a3230f', '#6e1410', '#5a2a18'].map((c) => new THREE.Color(c)),
  'erable-vert': ['#c8641a', '#d4861c', '#b03a14', '#c9a227', '#7a4a22'].map((c) => new THREE.Color(c)),
}

/** Le tapis de feuilles, et une boîte par érable qui borne le sien. */
function feuillesMortes(parc: Parc): { geometrie: THREE.BufferGeometry; boites: THREE.Box3[] } {
  const boites: THREE.Box3[] = []
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
    const boite = new THREE.Box3()
    boites.push(boite)
    for (let k = 0; k < 320 * p.scale; k++) {
      const [a, r] = [alea() * Math.PI * 2, rayon * Math.sqrt(alea()) * (0.35 + 0.65 * alea())]
      const [x, z] = [p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]
      if (presDeLEau(x, z, 0.2)) continue
      const y = hauteurDuParc(x, z) + 0.035 + alea() * 0.006
      const [t, l] = [alea() * Math.PI * 2, 0.06 + alea() * 0.05]
      const [c, s] = [Math.cos(t) * l, Math.sin(t) * l]
      const [rang, w] = [pos.length / 3, alea()]
      boite.expandByPoint(new THREE.Vector3(x, y, z))
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
  // Une feuille déborde de son centre de 11 cm au plus.
  return { geometrie: g, boites: boites.filter((b) => !b.isEmpty()).map((b) => b.expandByScalar(0.15)) }
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
