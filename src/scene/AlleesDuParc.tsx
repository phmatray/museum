/**
 * Les allées du parc à l'écran (`plan/allees.ts` a tout décidé) : le gravier
 * et les dalles de l'axe drapés sur le relief, la bordure de pierre, le lit de
 * galets, puis, instanciés, les dalles irrégulières près de l'eau, les piquets
 * et leur corde, les touffes d'herbe des courbes. Dix appels de dessin pour
 * tout le réseau.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { BORDURE, GALETS, amenagerAllees, type Pose, type Surface } from '../plan/allees'
import type { Parc } from '../plan/park'
import { COTE_DALLAGE, hauteurDuParc } from '../plan/relief'
import { PARC } from '../plan/visibilite'
import { intemperer } from './intemperies'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'

/** Le sol des allées, 3 cm au-dessus de la pelouse : assez pour ne pas scintiller avec elle. */
const RELIEF_ALLEE = 0.03
/** Le profil de la bordure (décalage vers le gazon, hauteur sur le sol), arête du dessus arrondie. */
const PROFIL: [number, number][] = [
  [BORDURE.dedans, -0.05], [BORDURE.dedans, 0.06], [BORDURE.dedans + 0.012, 0.08], [BORDURE.dedans + 0.035, 0.09],
  [BORDURE.dehors - 0.035, 0.09], [BORDURE.dehors - 0.012, 0.08], [BORDURE.dehors, 0.06], [BORDURE.dehors, -0.05],
]
/**
 * La bordure arasée, là où l'axe dallé traverse le gravier : une pierre de 13 cm,
 * 1 cm au-dessus des dalles, qui mord sur elles (décalage négatif) et tient le gravier.
 */
const ARASE: [number, number][] = [
  [-0.03, 0], [-0.03, RELIEF_ALLEE + 0.017], [-0.02, RELIEF_ALLEE + 0.02],
  [0.09, RELIEF_ALLEE + 0.02], [0.1, RELIEF_ALLEE + 0.017], [0.1, -0.03],
]
const PIQUET = { haut: 0.62, corde: 0.46 }

export function AlleesDuParc({ parc, dallage }: { parc: Parc; dallage: THREE.Material }) {
  const a = useMemo(() => amenagerAllees(parc), [parc])
  const geos = useMemo(() => ({
    gravier: draper(a.gravier, RELIEF_ALLEE),
    // À la cote du parvis (`ParkLayer`), 1 cm au-dessus du gravier qui file dessous.
    dalles: draper(a.dalles, COTE_DALLAGE),
    bordure: mergeGeometries([bande(a.bordures, () => PROFIL), bande(a.listels, () => ARASE)], false),
    galets: galets(a.bordures),
    pierres: semisDePierres(a.pierres),
  }), [a])
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos])

  const gravier = useMatiere('gravier', repetitionMetrique(REGLAGE_MATIERE.gravier.motif))
  // Des galets de rivière, sombres : le gravier des allées, en plus gros et en ardoise.
  const cailloux = useMatiere('gravier', repetitionMetrique(REGLAGE_MATIERE.gravier.motif * 2.2), { teinte: '#5b5d5e' })
  const pierre = useMatiere('beton', repetitionMetrique(REGLAGE_MATIERE.beton.motif), { teinte: '#d6d1c6' })
  // Un granit patiné (Rock044), UV lues sur le plan : chaque pierre montre son propre morceau de la carte.
  const dalle = useMatiere('roche', repetitionMetrique(REGLAGE_MATIERE.roche.motif))
  // Mouillé sous la pluie, blanc sous la neige (`intemperies.ts`) : greffé sur chaque matière neuve.
  useMemo(() => {
    for (const m of [cailloux, pierre, dalle]) intemperer(m)
    intemperer(gravier, { flaques: true })
    /* eslint-disable react-hooks/immutability -- la matière des dalles lit la patine de leurs sommets */
    dalle.vertexColors = true
    /* eslint-enable react-hooks/immutability */
  }, [gravier, cailloux, pierre, dalle])

  const decor = useMemo(() => {
    const m = {
      bois: new THREE.MeshStandardMaterial({ name: 'allees:piquet', color: '#3b2b1f', roughness: 0.85 }),
      corde: new THREE.MeshStandardMaterial({ name: 'allees:corde', color: '#a48a5c', roughness: 1 }),
      // Normales tirées vers le haut (`touffe`) : l'herbe s'éclaire comme le sol, le revers n'est pas noir.
      touffe: new THREE.MeshLambertMaterial({ name: 'allees:touffe', vertexColors: true, side: THREE.DoubleSide }),
    }
    for (const x of [m.bois, m.touffe]) intemperer(x)
    return m
  }, [])
  const formes = useMemo(() => ({ piquet: piquet(), corde: corde(), touffe: touffe() }), [])
  useEffect(() => () => {
    Object.values(decor).forEach((m) => m.dispose())
    Object.values(formes).forEach((g) => g.dispose())
  }, [decor, formes])

  const piquets = useMemo(() => a.poteaux.map((p) => new THREE.Matrix4().makeTranslation(p.x, hauteurDuParc(p.x, p.z), p.z)), [a])
  const cordes = useMemo(() => a.cordes.map(([i, j]) => {
    const [p, q] = [a.poteaux[i], a.poteaux[j]]
    const [y0, y1] = [hauteurDuParc(p.x, p.z) + PIQUET.corde, hauteurDuParc(q.x, q.z) + PIQUET.corde]
    // L'axe x de la corde va d'un piquet à l'autre ; son creux reste vertical.
    const x = new THREE.Vector3(q.x - p.x, y1 - y0, q.z - p.z)
    const z = new THREE.Vector3(-x.z, 0, x.x).normalize()
    return new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), z).setPosition(p.x, y0, p.z)
  }), [a])
  // Un seul lot : l'herbe du Japon telle quelle, l'ophiopogon teinté d'un vert noir.
  const touffes = useMemo(() => ({
    matrices: poses([...a.touffes, ...a.couvreSol], -0.02),
    teintes: [...a.touffes.map(() => new THREE.Color(1, 1, 1)), ...a.couvreSol.map((_, i) => new THREE.Color(0.3, 0.42, 0.3).multiplyScalar(0.8 + 0.3 * frac(i * 0.618)))],
  }), [a])

  return (
    <>
      <mesh geometry={geos.gravier} material={gravier} userData={{ zone: PARC }} />
      <mesh geometry={geos.dalles} material={dallage} userData={{ zone: PARC }} />
      <mesh geometry={geos.bordure} material={pierre} userData={{ zone: PARC }} />
      <mesh geometry={geos.galets} material={cailloux} userData={{ zone: PARC }} />
      <mesh geometry={geos.pierres} material={dalle} userData={{ zone: PARC }} />
      <Lot geometrie={formes.piquet} material={decor.bois} matrices={piquets} />
      <Lot geometrie={formes.corde} material={decor.corde} matrices={cordes} />
      <Lot geometrie={formes.touffe} material={decor.touffe} matrices={touffes.matrices} teintes={touffes.teintes} />
    </>
  )
}

const frac = (x: number) => x - Math.floor(x)

function poses(liste: Pose[], dy: number): THREE.Matrix4[] {
  const q = new THREE.Quaternion()
  const haut = new THREE.Vector3(0, 1, 0)
  return liste.map((p) => new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, hauteurDuParc(p.x, p.z) + dy, p.z), q.setFromAxisAngle(haut, p.rotation), new THREE.Vector3(p.sx, p.sy, p.sz)))
}

function Lot({ geometrie, material, matrices, teintes }: { geometrie: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; teintes?: THREE.Color[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    teintes?.forEach((t, i) => mesh.setColorAt(i, t))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices, teintes])
  return <instancedMesh key={matrices.length} ref={ref} args={[geometrie, undefined, matrices.length]} material={material} />
}

/** Une surface des allées, posée sur le relief ; UV en mètres, lues sur le plan : la même maille dans les courbes. */
function draper(s: Surface, dy: number): THREE.BufferGeometry {
  const pos: number[] = []
  for (let i = 0; i < s.xz.length; i += 2) pos.push(s.xz[i], hauteurDuParc(s.xz[i], s.xz[i + 1]) + dy, s.xz[i + 1])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(s.xz, 2))
  g.setIndex(s.index)
  g.computeVertexNormals()
  return g
}

/**
 * Une bande le long de chaque bord : `profil` donne, pour chaque rang de la
 * bande, son décalage vers le gazon et sa hauteur sur le sol. UV en mètres :
 * u le long du bord, v en travers.
 */
function bande(bords: ReturnType<typeof amenagerAllees>['bordures'], profil: (p: { galets: number }) => [number, number][]): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (const ligne of bords) {
    let u = 0
    const base = pos.length / 3
    let n = 0
    ligne.forEach((p, i) => {
      if (i > 0) u += Math.hypot(p.x - ligne[i - 1].x, p.z - ligne[i - 1].z)
      const rangs = profil(p)
      n = rangs.length
      let v = 0
      rangs.forEach(([d, h], k) => {
        const [x, z] = [p.x + p.nx * d, p.z + p.nz * d]
        if (k > 0) v += Math.hypot(d - rangs[k - 1][0], h - rangs[k - 1][1])
        pos.push(x, hauteurDuParc(p.x, p.z) + h, z)
        uv.push(u, v)
      })
    })
    // Le bord court dans un sens ou dans l'autre : on tourne les faces pour qu'elles regardent le ciel.
    const [p, q] = ligne
    const sens = p.nz * (q.x - p.x) - p.nx * (q.z - p.z) > 0
    for (let i = 0; i + 1 < ligne.length; i++)
      for (let k = 0; k + 1 < n; k++) {
        const [a, b] = [base + i * n + k, base + (i + 1) * n + k]
        if (sens) index.push(a, a + 1, b, b, a + 1, b + 1)
        else index.push(a, b, a + 1, b, b + 1, a + 1)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/**
 * Le lit de galets : un léger bourrelet entre la bordure et le gazon, qui s'efface
 * le long des dalles. En s'effaçant, il s'ENFONCE sous la pelouse : réduit à
 * rien mais hors du sol, il se couchait sur la face de la bordure et s'y battait
 * avec elle (un pointillé sombre au pied de la bordure du parvis).
 */
const galets = (bords: ReturnType<typeof amenagerAllees>['bordures']) => bande(bords, (p) => {
  const l = GALETS * p.galets
  const [k, bas] = [Math.min(1, p.galets * 5), -0.03]
  const h = (y: number) => bas + (y - bas) * k
  return [[BORDURE.dehors - 0.01, h(0.025)], [BORDURE.dehors + l * 0.45, h(0.035)], [BORDURE.dehors + l, h(0.008)]]
})

/** Un piquet de bois, fiché dans le sol, la tête chanfreinée. */
function piquet(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.035, 0.045, PIQUET.haut + 0.2, 8)
  g.translate(0, (PIQUET.haut - 0.2) / 2, 0)
  return g
}

/** Une travée de corde, de x = 0 à x = 1, qui pend de 7 cm au milieu. */
function corde(): THREE.BufferGeometry {
  const pts = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(i / 8, -0.07 * 4 * (i / 8) * (1 - i / 8), 0))
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.012, 5, false)
}

/**
 * Les dalles irrégulières près de l'eau, fusionnées en un seul maillage : une
 * pierre plate à peine bombée, l'arête abattue en trois rangs, dont le pied
 * s'enfonce dans le gravier au lieu d'y être posé. Chaque pierre a son contour,
 * sa teinte et son morceau de granit (UV lues sur le plan, tournées d'un angle
 * propre) : instanciées sur trois formes, on les reconnaissait d'une pierre à l'autre.
 */
function semisDePierres(liste: Pose[]): THREE.BufferGeometry {
  const n = 20
  // [rayon relatif, hauteur sur le gravier, patine] du centre vers le bord :
  // le dessus bombé, l'arête arrondie, puis le pied noyé dans le gravier, verdi.
  const anneaux: [number, number, number][] = [
    [0.45, 0.017, 1], [0.8, 0.015, 0.97], [0.92, 0.012, 0.9], [0.975, 0.007, 0.84], [1, -0.001, 0.72], [1.01, -0.03, 0.6],
  ]
  const pos: number[] = []
  const uv: number[] = []
  const couleur: number[] = []
  const index: number[] = []
  const mousse = new THREE.Color(0.84, 0.9, 0.76)
  const c = new THREE.Color()
  const m = new THREE.Color()
  liste.forEach((p, s) => {
    const alea = (k: number) => frac(Math.sin(k * 12.9898 + s * 78.233) * 43758.5453)
    const r = Array.from({ length: n }, (_, i) => {
      const t = (2 * Math.PI * i) / n
      return 0.9 + 0.1 * Math.sin(2 * t + alea(1) * 6.3) + 0.07 * Math.sin(3 * t + alea(2) * 6.3) + 0.05 * alea(10 + i)
    })
    // Des pierres de la même carrière, plus ou moins chaudes, plus ou moins claires.
    const [clair, chaud] = [0.78 + 0.32 * alea(3), alea(4) - 0.5]
    const teinte = new THREE.Color(clair * (1 + 0.07 * chaud), clair, clair * (1 - 0.09 * chaud))
    m.copy(mousse).multiply(teinte)
    const [cos, sin] = [Math.cos(p.rotation), Math.sin(p.rotation)]
    const [tu, ou, ov] = [alea(5) * Math.PI * 2, alea(6) * 50, alea(7) * 50]
    const [cu, su] = [Math.cos(tu), Math.sin(tu)]
    const y0 = hauteurDuParc(p.x, p.z) + RELIEF_ALLEE
    // Le dessus n'est pas plan : un léger voile, propre à chaque pierre.
    const bosse = (x: number, z: number) => 0.004 * Math.sin(x * 4.1 + alea(8) * 6) * Math.sin(z * 3.7 + alea(9) * 6)
    const base = pos.length / 3
    const sommet = (lx: number, lz: number, h: number, patine: number) => {
      const [x, z] = [p.x + lx * p.sx * cos + lz * p.sz * sin, p.z - lx * p.sx * sin + lz * p.sz * cos]
      pos.push(x, y0 + h + (h > 0 ? bosse(lx, lz) : 0), z)
      uv.push(x * cu - z * su + ou, x * su + z * cu + ov)
      c.copy(teinte).lerp(m, 1 - patine).multiplyScalar(0.65 + 0.35 * patine)
      couleur.push(c.r, c.g, c.b)
    }
    sommet(0, 0, 0.018, 1)
    for (const [k, h, patine] of anneaux)
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n
        sommet(Math.cos(t) * r[i] * k, Math.sin(t) * r[i] * k, h, patine)
      }
    for (let i = 0; i < n; i++) index.push(base, base + 1 + ((i + 1) % n), base + 1 + i)
    for (let a = 0; a + 1 < anneaux.length; a++)
      for (let i = 0; i < n; i++) {
        const [q, w] = [base + 1 + a * n + i, base + 1 + a * n + ((i + 1) % n)]
        index.push(q, w, q + n, w, w + n, q + n)
      }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(couleur, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/**
 * Une touffe d'herbe du Japon (hakonechloa) : trente brins effilés qui
 * jaillissent du pied et retombent en fontaine, verts au cœur, dorés au bout.
 */
function touffe(): THREE.BufferGeometry {
  const pos: number[] = []
  const couleur: number[] = []
  const index: number[] = []
  const [pied, milieu, pointe] = [new THREE.Color('#2f3d17'), new THREE.Color('#7d8f32'), new THREE.Color('#c9ad52')]
  const c = new THREE.Color()
  const NIV = 5
  for (let b = 0; b < 44; b++) {
    const h = frac(Math.sin(b * 78.233) * 43758.5453)
    const t0 = b * 2.39996 // l'angle d'or : les brins se répartissent sans rangée
    const [dx, dz] = [Math.cos(t0), Math.sin(t0)]
    const [ox, oz] = [dx * 0.05 * h, dz * 0.05 * h]
    const [haut, portee] = [0.32 + 0.22 * h, 0.22 + 0.25 * frac(h * 7.1)]
    const base = pos.length / 3
    for (let k = 0; k <= NIV; k++) {
      const t = k / NIV
      const [x, z, y] = [ox + dx * portee * t ** 1.4, oz + dz * portee * t ** 1.4, haut * (1.7 * t - 0.95 * t * t)]
      const w = 0.022 * (1 - t) + 0.003
      pos.push(x - dz * w, y, z + dx * w, x + dz * w, y, z - dx * w)
      c.copy(pied).lerp(milieu, Math.min(1, t * 1.8)).lerp(pointe, Math.max(0, t - 0.5) * 2 * (0.6 + 0.4 * h))
      couleur.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (k > 0) {
        const q = base + 2 * k
        index.push(q - 2, q - 1, q, q, q - 1, q + 1)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(couleur, 3))
  g.setIndex(index)
  return g
}
