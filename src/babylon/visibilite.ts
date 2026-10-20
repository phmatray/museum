/**
 * Le PARC caché depuis l'intérieur (VisibiliteLayer de three, réduit au jardin) :
 * dans le musée, le jardin ne se voit que par la porte d'entrée (`entrance` du
 * plan, seule ouverture sur l'extérieur au rez-de-chaussée). Un maillage du parc
 * seul (`zonesDuVolume` = [PARC] ; pour un lot à l'échelle du parc, aucune
 * instance ni aucun sommet dans l'emprise ; `metadata.zone === 'parc'` pour ceux
 * qui n'ont pas de boîte fiable : gazon, faune) n'est dessiné que si la porte est
 * dans le champ ET que sa boîte passe par le cône œil → porte. Dehors, c'est
 * l'inverse : un maillage de l'intérieur seul (sa boîte ne touche pas le PARC,
 * toits compris) ne se voit que par la porte (les vitres de la façade sont
 * opaques). Le reste, à cheval, est à Babylon (frustum). Masqué par `layerMask` (les couches pilotent déjà
 * `isVisible` et `setEnabled`) ; la carte d'ombre, qui a sa liste, n'en voit rien.
 *
 * Un lot de l'intérieur à l'échelle du musée (Lyrata, banquettes, têtes de
 * projecteurs…), vu du dehors par la porte, est COMPACTÉ en place comme dans
 * three : seules ses instances dont la sphère passe par le cône restent
 * dessinées ; il retrouve toutes les siennes dès qu'on rentre (la carte
 * d'ombre est alors redessinée, elle a pu être prise lots compactés).
 *
 * La carte d'ombre suit la même règle : un porteur de l'autre côté de la
 * façade (le parc vu de dedans, l'intérieur vu de dehors) n'y est dessiné que
 * si son ombre (sa boîte prolongée le long du soleil jusqu'au plan de sa base)
 * passe par le cône œil → porte ; quand ce choix change, la carte est redessinée.
 *
 * three dessine tout le parc depuis le hall (la nef « voit » le parc par la
 * porte) : c'est le premier poste de triangles au point d'arrivée.
 * ponytail : ni la verrière ni les baies hautes (cimes au-dessus du toit, vue
 * plongeante d'une butte dans la nef) ; pas de tri entre salles (galeries vues
 * du hall) ni de compactage des lots à cheval (bancs, lampadaires du parc).
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Plan } from '../plan/types.ts'
import { PARC, zonesDuVolume } from '../plan/visibilite.ts'

type Lieu = 'parc' | 'dedans' | 'mixte'
const VU = 0x0fffffff
const CACHE = 0x10000000
/** La hauteur de la baie d'entrée, large : on ne cache jamais trop. */
const HAUT_PORTE = 4.8
/** Au-delà (m), une boîte est celle d'un lot du parc entier : on regarde ses instances ou ses sommets. */
const GRAND = 20

/** Une instance ou un sommet dans l'emprise du musée (façades exclues) ? */
export function touche(m: AbstractMesh, plan: Pick<Plan, 'width' | 'depth'>): boolean {
  const dans = (x: number, z: number) => x > 0.5 && x < plan.width - 0.5 && z > 0.5 && z < plan.depth - 0.5
  const w = m.getWorldMatrix()
  const v = new Vector3()
  const mats = (m as Mesh).hasThinInstances ? (m as Mesh).thinInstanceGetWorldMatrices() : null
  if (mats) return mats.some((t) => (Vector3.TransformCoordinatesFromFloatsToRef(t.m[12], t.m[13], t.m[14], w, v), dans(v.x, v.z)))
  const pos = m.getVerticesData('position') ?? []
  for (let i = 0; i < pos.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v)
    if (dans(v.x, v.z)) return true
  }
  return false
}

/** Le cône œil → rectangle (4 coins dans l'ordre du tour) : 4 plans latéraux et celui du rectangle, normales vers l'intérieur. */
export function plansDuPortail(oeil: Vector3, coins: readonly Vector3[]): Plane[] {
  const centre = coins.reduce((a, c) => a.addInPlace(c), Vector3.Zero()).scaleInPlace(1 / coins.length)
  const au = centre.add(centre.subtract(oeil).normalize())
  const oriente = (p: Plane) => (p.dotCoordinate(au) < 0 ? new Plane(-p.normal.x, -p.normal.y, -p.normal.z, -p.d) : p)
  const plans = coins.map((c, i) => oriente(Plane.FromPoints(oeil, c, coins[(i + 1) % coins.length])))
  plans.push(oriente(Plane.FromPoints(coins[0], coins[1], coins[2])))
  return plans
}

/** Des points (coins d'une boîte, d'une porte) dans un cône : faux seulement s'ils sont tous derrière un même plan. */
export const dansLeCone = (points: readonly Vector3[], plans: readonly Plane[]): boolean => plans.every((pl) => points.some((q) => pl.dotCoordinate(q) >= 0))

/**
 * Un lot d'instances à compacter : la sphère monde de chaque instance, ses
 * buffers (`kind`, tampon vivant, copie d'origine, pas), qui est dessinée.
 */
export interface Lot { spheres: Float32Array; tampons: [string, Float32Array, Float32Array, number][]; vus: Uint8Array; n: number }

/** Le lot d'un maillage de thin instances (immobiles) : sphères calculées une fois, buffers copiés. */
export function lotDe(m: Mesh): Lot {
  const mats = m._thinInstanceDataStorage.matrixData!
  const n = m.thinInstanceCount
  const s = m.getRawBoundingInfo().boundingSphere
  const [t, v] = [new Matrix(), new Vector3()]
  const spheres = new Float32Array(4 * n)
  for (let i = 0; i < n; i++) {
    Matrix.FromArrayToRef(mats, 16 * i, t)
    t.multiplyToRef(m.getWorldMatrix(), t)
    Vector3.TransformCoordinatesToRef(s.center, t, v)
    const e = (k: number) => Math.hypot(t.m[k], t.m[k + 1], t.m[k + 2])
    spheres.set([v.x, v.y, v.z, s.radius * Math.max(e(0), e(4), e(8))], 4 * i)
  }
  const u = m._userThinInstanceBuffersStorage
  const tampons: Lot['tampons'] = [['matrix', mats, mats.slice(), 16], ...Object.entries(u?.data ?? {}).map(([k, d]): Lot['tampons'][number] => [k, d, d.slice(), u.strides[k]])]
  // Les buffers posés statiques (défaut de thinInstanceSetBuffer) refaits modifiables au premier compactage.
  m.thinInstanceAllowAutomaticStaticBufferRecreation = true
  return { spheres, tampons, vus: new Uint8Array(n).fill(1), n }
}

/** Ne garde du lot que les instances dont la sphère passe par l'un des `cones` (toutes sans cône) ; rend leur nombre. */
export function compacter(m: Mesh, lot: Lot, cones: readonly Plane[][] | null): number {
  const { spheres: s, vus } = lot
  if (!cones && lot.n === vus.length) return lot.n
  let change = false
  for (let i = 0; i < vus.length; i++) {
    let vu = !cones
    for (let c = 0; !vu && c < cones!.length; c++) {
      vu = true
      for (const { normal: q, d } of cones![c]) if (q.x * s[4 * i] + q.y * s[4 * i + 1] + q.z * s[4 * i + 2] + d < -s[4 * i + 3]) vu = false
    }
    change ||= +vu !== vus[i]
    vus[i] = +vu
  }
  if (!change) return lot.n
  let n = 0
  for (let i = 0; i < vus.length; i++) {
    if (!vus[i]) continue
    for (const [, vivant, orig, pas] of lot.tampons) vivant.set(orig.subarray(pas * i, pas * i + pas), pas * n)
    n++
  }
  m.thinInstanceCount = n
  for (const [k] of lot.tampons) m.thinInstanceBufferUpdated(k)
  return (lot.n = n)
}

export function monterVisibilite(scene: Scene, camera: Camera, plan: Plan): void {
  const sur = plan.levels.flatMap((l) => l.openings.filter((o) => o.kind === 'entrance' && o.b === null).map((o) => ({ o, y: l.elevation })))
  const portes = sur.map(({ o, y }) => {
    // L'entrée est sur la façade sud ou nord (z constant) si son centre y est, sinon est ou ouest.
    const surZ = o.z <= 0 || o.z >= plan.depth
    const [dx, dz] = surZ ? [o.width / 2, 0] : [0, o.width / 2]
    return [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([s, h]) => new Vector3(o.x + s * dx, y + h * HAUT_PORTE, o.z + s * dz))
  })
  const toit = Math.max(...plan.levels.map((l) => l.elevation)) + plan.storey - 2 * plan.slab
  const lieux = new Map<AbstractMesh, Lieu>()
  const statiques = new WeakMap<AbstractMesh, boolean>()
  // Les lots de l'intérieur à compacter vus du dehors (null : un maillage ordinaire).
  const lots = new WeakMap<AbstractMesh, Lot | null>()
  const champ = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))
  let relu = 0
  let avant = -1
  let estDedans = true
  // La carte d'ombre : seuls les porteurs du côté du visiteur, et ceux de l'autre côté dont l'ombre passe la porte.
  const traverse = new WeakMap<AbstractMesh, boolean>()
  const ombres = new WeakMap<AbstractMesh, Vector3[]>()
  const ombreDe = (m: AbstractMesh, d: Vector3) => {
    let pts = ombres.get(m)
    if (!pts) {
      // Chaque coin projeté le long du soleil sur le plan de la base de la boîte (le sol qui la porte).
      const b = m.getBoundingInfo().boundingBox
      const pente = Math.max(0.1, -d.y)
      ombres.set(m, (pts = [...b.vectorsWorld, ...b.vectorsWorld.map((q) => q.add(d.scale((q.y - b.minimumWorld.y) / pente)))]))
    }
    return pts
  }
  // Le soleil est fixe pendant la visite : sa direction lue une fois.
  const generateurs = scene.lights.flatMap((l) => {
    const g = l.getShadowGenerator()
    return g ? [{ g, d: ((l as { direction?: Vector3 }).direction ?? Vector3.Down()).normalizeToNew() }] : []
  })
  for (const { g } of generateurs) {
    const carte = g.getShadowMap()
    if (!carte) continue
    const filtre = carte.getCustomRenderList
    carte.getCustomRenderList = (i, liste, n) => {
      const ms = filtre?.(i, liste, n) ?? liste?.slice(0, n) ?? []
      return ms.filter((m) => {
        const lieu = lieux.get(m)
        return !lieu || lieu === 'mixte' || (lieu === 'parc') !== estDedans || traverse.get(m) === true
      })
    }
  }
  scene.onBeforeRenderObservable.add(() => {
    const p = camera.globalPosition
    const dedans = p.x > 0 && p.x < plan.width && p.z > 0 && p.z < plan.depth
    const t = performance.now()
    if (t > relu) {
      // Chaque seconde : les couches qui arrivent, les maillages libérés qui partent (toiles proches), les petites boîtes qui bougent (Bavette).
      relu = t + 1000
      lieux.clear()
      for (const m of scene.meshes) lieux.set(m, lieuDe(m))
    }
    Frustum.GetPlanesToRef(camera.getTransformationMatrix(), champ)
    const cones = portes.filter((c) => dansLeCone(c, champ)).map((c) => plansDuPortail(p, c))
    // Les porteurs d'ombre de l'autre côté qui passent par la porte ; rentré, sorti ou ce choix changé : la carte est redessinée.
    let empreinte = dedans ? 1 : 0
    for (const { g, d } of generateurs) {
      for (const m of g.getShadowMap()?.renderList ?? []) {
        const lieu = lieux.get(m)
        if (!lieu || lieu === 'mixte' || (lieu === 'parc') !== dedans) continue
        const passe = cones.some((c) => dansLeCone(ombreDe(m, d), c))
        traverse.set(m, passe)
        if (passe) empreinte = (empreinte * 31 + m.uniqueId) % 1e9
      }
    }
    if (empreinte !== avant) for (const { g } of generateurs) g.getShadowMap()?.resetRefreshCounter()
    avant = empreinte
    estDedans = dedans
    // `window.__TOUT_VOIR__` (DEV) : plus rien de caché, comme dans three.
    const tout = import.meta.env.DEV && (window as { __TOUT_VOIR__?: boolean }).__TOUT_VOIR__
    for (const [m, lieu] of lieux) {
      if (m.isDisposed()) continue
      const lot = lieu === 'dedans' ? lotDuLieu(m) : null
      // Dedans (ou tout voir), un lot reprend toutes ses instances ; dehors, celles du cône.
      if (lot && (dedans || tout)) compacter(m as Mesh, lot, null)
      const vu = tout || lieu === 'mixte' || (lieu === 'parc') !== dedans
        || (lot ? cones.length > 0 && compacter(m as Mesh, lot, cones) > 0
          : cones.some((c) => m.alwaysSelectAsActiveMesh || dansLeCone(m.getBoundingInfo().boundingBox.vectorsWorld, c)))
      m.layerMask = vu ? VU : CACHE
    }
  })

  /** Un lot d'instances immobiles à l'échelle du musée (les lots animés, petits, n'en sont pas). */
  function lotDuLieu(m: AbstractMesh): Lot | null {
    let lot = lots.get(m)
    if (lot === undefined) {
      const b = m.getBoundingInfo().boundingBox
      const grand = Math.max(b.maximumWorld.x - b.minimumWorld.x, b.maximumWorld.z - b.minimumWorld.z) > GRAND
      lot = grand && (m as Mesh).hasThinInstances && (m as Mesh).thinInstanceCount > 1 ? lotDe(m as Mesh) : null
      lots.set(m, lot)
    }
    return lot
  }

  function lieuDe(m: AbstractMesh): Lieu {
    if (m.metadata?.zone === PARC) return 'parc'
    if (m.alwaysSelectAsActiveMesh || m.getTotalVertices() === 0) return 'mixte'
    const b = m.getBoundingInfo().boundingBox
    const z = zonesDuVolume(plan, b.minimumWorld, b.maximumWorld)
    if (!z.includes(PARC)) return 'dedans'
    // Sous le toit, dans l'emprise : `zonesDuVolume` compte au parc tout ce qui touche le toit
    // (une butte le voit) ; sous la verrière, ce qui ne dépasse pas le toit des galeries (9,6 m) de
    // plus de 40 cm reste caché derrière les façades (projecteurs, nervures, baie Batlló).
    const [mn, mx] = [b.minimumWorld, b.maximumWorld]
    if (mn.x > 0 && mn.z > 0 && mx.x < plan.width && mx.z < plan.depth && mx.y < toit + 1) return 'dedans'
    if (z.length === 1) return 'parc'
    if (Math.max(b.maximumWorld.x - b.minimumWorld.x, b.maximumWorld.z - b.minimumWorld.z) <= GRAND) return 'mixte'
    // Un lot ou un maillage fusionné à l'échelle du parc (immobile) : sa boîte couvre le musée, on lit ses instances ou ses sommets.
    const seul = statiques.get(m) ?? !touche(m, plan)
    statiques.set(m, seul)
    return seul ? 'parc' : 'mixte'
  }
}
