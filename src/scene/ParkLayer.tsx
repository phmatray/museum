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

import type { Allee, Parc, PlantPlacement, EspeceParc } from '../plan/park'
import { hauteurDuParc, masqueDuRelief } from '../plan/relief'
import type { Rect } from '../plan/types'
import { REGLAGE_MATIERE, repetitionMetrique, useCartes, useMatiere } from './materials'
import { parkAssetsResource, type ParkAssets, type ParkPiece } from './parkAssets'
import { creerMatieresJardin, preparerSol, uvBoite } from './jardinMatieres'
import { brinsDeGazon, carteDuSol, matiereGazon, type ReglageGazon } from './gazon'
import { useGameStore } from '../stores/gameStore'

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
  const herbe = useMemo(
    () => new THREE.MeshLambertMaterial({ name: 'parc:pelouse', map: cartes?.couleur ?? null, color: TEINTE_PELOUSE, vertexColors: true }),
    [cartes],
  )
  const gravier = useMatiere('gravier', repetitionMetrique(REGLAGE_MATIERE.gravier.motif))

  const sol = useMemo(() => pelouse(placements), [placements])
  const allees = useMemo(() => dalles([
    ...placements.dalles.map((r) => pave(r, 0, RELIEF_ALLEE)),
    ...placements.allees.map(allee),
  ]), [placements])
  useEffect(() => () => {
    sol.dispose()
    allees.dispose()
  }, [sol, allees])
  useEffect(() => () => herbe.dispose(), [herbe])

  const parEspece = useMemo(() => {
    const par = new Map<EspeceParc, PlantPlacement[]>()
    for (const p of placements.plantations) par.set(p.espece, [...(par.get(p.espece) ?? []), p])
    return par
  }, [placements])

  return (
    <group name="parc">
      <mesh geometry={sol} material={herbe} />
      <mesh geometry={allees} material={gravier} />
      <Gazon parc={placements} />
      {assets !== null && <Jardin objets={assets.jardin} herbe={herbe} />}
      {assets !== null &&
        [...parEspece].map(([espece, sujets]) =>
          (assets.especes.get(espece) ?? []).map((lot, i) => <Instances key={`${espece}:${i}`} piece={lot} sujets={sujets} />))}
    </group>
  )
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
  return <>{lots.map((l, i) => <mesh key={i} geometry={l.geometrie} material={l.material} frustumCulled={false} />)}</>
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

/** Une allée drapée sur le relief : une bande subdivisée au mètre, rallongée d'une largeur en tout. */
function allee(a: Allee): THREE.BufferGeometry {
  const [dx, dz] = [a.b.x - a.a.x, a.b.z - a.a.z]
  const l = Math.hypot(dx, dz)
  const [ux, uz] = [dx / l, dz / l]
  const n = Math.max(1, Math.ceil(l + a.largeur))
  const pos: number[] = []
  const index: number[] = []
  for (let i = 0; i <= n; i++) {
    const s = -a.largeur / 2 + ((l + a.largeur) * i) / n
    for (let j = 0; j < 3; j++) {
      const t = ((j - 1) * a.largeur) / 2
      const [x, z] = [a.a.x + ux * s - uz * t, a.a.z + uz * s + ux * t]
      pos.push(x, hauteurDuParc(x, z) + RELIEF_ALLEE, z)
      if (i > 0 && j > 0) {
        const k = 3 * i + j
        index.push(k - 4, k - 3, k - 1, k - 1, k - 3, k)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
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
  useFrame(({ clock }) => matieres.animer(clock.elapsedTime, useGameStore.getState().ciel.jour))
  const pierre = useMatiere('beton', repetitionMetrique(REGLAGE_MATIERE.beton.motif), { teinte: '#b9b6ad' })
  const bois = useMatiere('parquet', repetitionMetrique(REGLAGE_MATIERE.parquet.motif), { teinte: '#6b4a34' })

  useMemo(() => {
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
      })
    }
  }, [objets, matieres, herbe, pierre, bois])

  return <>{objets.map((o) => <primitive key={o.uuid} object={o} />)}</>
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
