/**
 * Ne dessiner que ce qu'on peut voir (VisibiliteLayer + scene/tri.ts de three,
 * zones de `plan/visibilite.ts`), sans qu'aucune couche n'ait à le savoir.
 *
 * - Les SALLES : quand l'œil a fait quelques pas, les zones visibles de là où
 *   il est sont recalculées (`zonesVisibles`). Un maillage n'est dessiné que si
 *   l'une de ses zones est vue : `metadata.zone` prime ('ciel' jamais caché),
 *   aucune zone s'il suit la caméra (`alwaysSelectAsActiveMesh`), sinon celles
 *   de sa boîte (`zonesDuVolume` ; un maillage fusionné à l'échelle du bâtiment
 *   les touche toutes : toujours dessiné).
 * - La FAÇADE, plus finement que three : de dedans, le parc (`zonesDuVolume` =
 *   [PARC] ; un lot à l'échelle du parc sans instance ni sommet dans l'emprise ;
 *   `metadata.zone === 'parc'` : gazon, faune) ne se voit que si la porte
 *   d'entrée est dans le champ ET que sa boîte passe par le cône œil → porte ;
 *   dehors, l'intérieur de même (les vitres de la façade sont opaques).
 * - Les LOTS de thin instances immobiles du bâtiment (cadres, têtes de
 *   projecteurs, mobilier, cartels…) sont COMPACTÉS en place : seules leurs
 *   instances des zones vues et du champ de la caméra (de l'autre côté de la
 *   façade, du cône d'une porte) restent dessinées. Un lot qu'une couche
 *   réécrit ensuite (tampon remplacé, nombre changé) lui est rendu ; ceux du
 *   parc (sauf `metadata.immobile` de lots.ts : lampadaires, bancs, vélos…),
 *   animés ou qui suivent la caméra ne sont jamais pris. `toutMontrer` (sondes) les rend entiers.
 *
 * Masqué par `layerMask` (les couches pilotent déjà `isVisible` et
 * `setEnabled`). La carte d'ombre, qui a sa liste, n'applique pas les masques :
 * son `getCustomRenderList` (chaîné sur celui de soleil.ts) en retire ce qui est
 * caché, sauf un porteur de l'autre côté de la façade, à moins de 30 m, dont l'ombre (sa boîte
 * prolongée le long du soleil, relu à chaque image, jusqu'au plan de sa base)
 * passe par le cône ; quand ce choix ou les zones vues changent, elle est redessinée.
 * Le champ de la caméra n'y entre pas : tourner la tête ne la redessine pas.
 *
 * ponytail : ni la verrière ni les baies hautes (cimes au-dessus du toit, vue
 * plongeante d'une butte dans la nef) ; les maillages fusionnés ne sont pas découpés par zone.
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
import { PARC, RAYON_OEIL, zonesDuVolume, zonesVisibles, type Zone } from '../plan/visibilite.ts'

type Lieu = 'parc' | 'dedans' | 'mixte'
const VU = 0x0fffffff
const CACHE = 0x10000000
/** La hauteur de la baie d'entrée, large : on ne cache jamais trop. */
const HAUT_PORTE = 4.8
/**
 * Au-delà (m) de l'œil, un porteur de l'autre côté de la façade ne pose plus d'ombre vue par la porte
 * (quelques pixels) : la passe d'ombre du jardin ne redessine pas toute la nef (≤ 300 appels en (30, 80)).
 */
const PORTEE_OMBRE = 30
/** De même pour ce qu'on voit par la porte (la nef depuis le fond du jardin) : ≤ 300 appels et 1,5 M triangles en (30, 80). */
const PORTEE_VUE = 45
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
 * Un lot d'instances à compacter : la sphère monde et les zones de chaque
 * instance, ses buffers (`kind`, tampon vivant, copie d'origine, pas), qui est
 * dessinée, et le filtre des zones (`cle` : les zones vues qui l'ont posé).
 */
export interface Lot {
  spheres: Float32Array
  zones: Zone[][]
  zonal: Uint8Array
  cle: string
  tampons: [string, Float32Array, Float32Array, number][]
  vus: Uint8Array
  n: number
  /** Le dernier filtre posé par le tri (zones vues, leur clé, cônes), pour `retrier`. */
  filtre?: [ReadonlySet<Zone> | null, string, readonly Plane[][] | null]
}

/** Le lot d'un maillage de thin instances (immobiles) : sphères et zones calculées une fois, buffers copiés. */
export function lotDe(m: Mesh, plan: Plan): Lot {
  const mats = m._thinInstanceDataStorage.matrixData!
  const n = m.thinInstanceCount
  const { boundingSphere: s, boundingBox: b } = m.getRawBoundingInfo()
  const [t, v, mn, mx] = [new Matrix(), new Vector3(), new Vector3(), new Vector3()]
  const spheres = new Float32Array(4 * n)
  const zones: Zone[][] = []
  for (let i = 0; i < n; i++) {
    Matrix.FromArrayToRef(mats, 16 * i, t)
    t.multiplyToRef(m.getWorldMatrix(), t)
    Vector3.TransformCoordinatesToRef(s.center, t, v)
    const e = (k: number) => Math.hypot(t.m[k], t.m[k + 1], t.m[k + 2])
    spheres.set([v.x, v.y, v.z, s.radius * Math.max(e(0), e(4), e(8))], 4 * i)
    // La boîte monde de l'instance (ses 8 coins), comme tri.ts.
    mn.setAll(Infinity)
    mx.setAll(-Infinity)
    for (const c of b.vectors) {
      Vector3.TransformCoordinatesToRef(c, t, v)
      mn.minimizeInPlace(v)
      mx.maximizeInPlace(v)
    }
    zones.push(zonesDuVolume(plan, mn, mx))
  }
  const u = m._userThinInstanceBuffersStorage
  const tampons: Lot['tampons'] = [['matrix', mats, mats.slice(), 16], ...Object.entries(u?.data ?? {}).map(([k, d]): Lot['tampons'][number] => [k, d, d.slice(), u.strides[k]])]
  // Les buffers posés statiques (défaut de thinInstanceSetBuffer) refaits modifiables au premier compactage.
  m.thinInstanceAllowAutomaticStaticBufferRecreation = true
  return { spheres, zones, zonal: new Uint8Array(n).fill(1), cle: 'tout', tampons, vus: new Uint8Array(n).fill(1), n }
}

/** Une couche a remplacé un tampon ou changé le nombre d'instances depuis notre dernier passage : le lot est à elle. */
export function reecrit(m: Mesh, lot: Lot): boolean {
  const u = m._userThinInstanceBuffersStorage?.data ?? {}
  return m.thinInstanceCount !== lot.n || lot.tampons.some(([k, vivant]) => (k === 'matrix' ? m._thinInstanceDataStorage.matrixData : u[k]) !== vivant)
}

/**
 * Ne garde du lot que les instances des zones `vues` (toutes avec `null`) dont
 * la sphère passe par l'un des `cones` (sans filtre avec `null`) ; rend leur nombre.
 */
export function compacter(m: Mesh, lot: Lot, vues: ReadonlySet<Zone> | null, cle: string, cones: readonly Plane[][] | null): number {
  const { spheres: s, vus, zonal } = lot
  if (lot.cle !== cle) {
    lot.cle = cle
    for (let i = 0; i < zonal.length; i++) zonal[i] = +vu(lot.zones[i], vues)
  }
  let change = false
  for (let i = 0; i < vus.length; i++) {
    let garde = zonal[i] === 1 && !cones
    for (let c = 0; zonal[i] && !garde && c < cones!.length; c++) {
      garde = true
      for (const { normal: q, d } of cones![c]) if (q.x * s[4 * i] + q.y * s[4 * i + 1] + q.z * s[4 * i + 2] + d < -s[4 * i + 3]) garde = false
    }
    change ||= +garde !== vus[i]
    vus[i] = +garde
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

/** Le prédicat de tri.ts : pas de zone (le ciel, la pluie), tout voir, ou une zone vue. */
const vu = (zones: readonly Zone[], vues: ReadonlySet<Zone> | null) => vues === null || zones.length === 0 || zones.some((z) => vues.has(z))

/** Les lots compactables connus, pour `toutMontrer`. */
const LOTS = new Map<Mesh, Lot>()
/**
 * Toutes les instances de tous les lots, le temps d'une capture de sonde (le
 * `sansTri` de three) : à appeler avant le rendu de la cible, et `retrier`
 * après, pour que la caméra ne dessine pas les lots entiers. Les masques, eux,
 * ne gênent pas : une cible à renderList explicite n'applique pas `layerMask`.
 */
export function toutMontrer(): void {
  for (const [m, lot] of LOTS) if (!m.isDisposed()) compacter(m, lot, null, 'tout', null)
}

/** Remet chaque lot au dernier filtre du tri (après `toutMontrer`). */
export function retrier(): void {
  for (const [m, lot] of LOTS) if (!m.isDisposed() && lot.filtre) compacter(m, lot, ...lot.filtre)
}

/** Monte le tri ; rend `lieuDe` (parc, dedans ou à cheval de la façade), pour les porteurs fondus de soleil.ts. */
export function monterVisibilite(scene: Scene, camera: Camera, plan: Plan): { lieuDe: (m: AbstractMesh) => Lieu } {
  const sur = plan.levels.flatMap((l) => l.openings.filter((o) => o.kind === 'entrance' && o.b === null).map((o) => ({ o, y: l.elevation })))
  const portes = sur.map(({ o, y }) => {
    // L'entrée est sur la façade sud ou nord (z constant) si son centre y est, sinon est ou ouest.
    const surZ = o.z <= 0 || o.z >= plan.depth
    const [dx, dz] = surZ ? [o.width / 2, 0] : [0, o.width / 2]
    return [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([s, h]) => new Vector3(o.x + s * dx, y + h * HAUT_PORTE, o.z + s * dz))
  })
  const toit = Math.max(...plan.levels.map((l) => l.elevation)) + plan.storey - 2 * plan.slab
  const lieux = new Map<AbstractMesh, Lieu>()
  // Un porteur fondu (soleil.ts) n'est pas dans la scène : son lieu est dans ses métadonnées.
  const lieuDuPorteur = (m: AbstractMesh): Lieu | undefined => lieux.get(m) ?? m.metadata?.lieu
  const zonesDe = new Map<AbstractMesh, Zone[]>()
  const statiques = new WeakMap<AbstractMesh, boolean>()
  const lieuxFixes = new WeakMap<AbstractMesh, Lieu>()
  // Les lots à compacter (null : un maillage ordinaire, ou un lot qu'une couche réécrit).
  const lots = new WeakMap<AbstractMesh, Lot | null>()
  const champ = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))
  let cones: Plane[][] = []
  let drapeau = [-1, -1]
  const tmp = new Vector3()
  const BAS = Vector3.Down()
  let relu = 0
  let avant = -1
  let estDedans = true
  // Les zones vues de l'œil (VisibiliteLayer) : recalculées quand il a fait quelques pas.
  const oeil = new Vector3(NaN, NaN, NaN)
  let vues: Set<Zone> = new Set()
  let cle = ''
  // La carte d'ombre : seuls les porteurs vus, et ceux de l'autre côté de la façade dont l'ombre passe la porte.
  const traverse = new WeakMap<AbstractMesh, boolean>()
  let ombres = new WeakMap<AbstractMesh, Vector3[]>()
  const ombreDe = (m: AbstractMesh, d: Vector3) => {
    let pts = ombres.get(m)
    if (!pts) {
      // Chaque coin projeté le long du soleil sur le plan de la base de la boîte (le sol qui la porte).
      const b = m.getBoundingInfo().boundingBox
      const pente = Math.max(0.1, -d.y)
      // Un mètre plus bas que sa base : un talus, une marche qui descend.
      ombres.set(m, (pts = [...b.vectorsWorld, ...b.vectorsWorld.map((q) => q.add(d.scale((q.y - b.minimumWorld.y + 1) / pente)))]))
    }
    return pts
  }
  // Le soleil (ou la lune) suit l'heure : sa direction relue à chaque image (soleil.ts la remplace).
  const generateurs = scene.lights.flatMap((l) => {
    const g = l.getShadowGenerator()
    return g ? [{ g, l: l as unknown as { direction?: Vector3 }, d: new Vector3(0, -1, 0) }] : []
  })
  for (const { g } of generateurs) {
    const carte = g.getShadowMap()
    if (!carte) continue
    const filtre = carte.getCustomRenderList
    carte.getCustomRenderList = (i, liste, n) => {
      const ms = filtre?.(i, liste, n) ?? liste?.slice(0, n) ?? []
      // Une liste explicite ignore `layerMask` : ce qui est caché (une salle derrière un mur, un lot vidé) en sort ici.
      return ms.filter((m) => {
        // Babylon dessinerait le modèle seul d'un lot vidé.
        if ((m as Mesh).hasThinInstances && (m as Mesh).thinInstanceCount === 0) return false
        if (traverse.get(m)) return true
        const lieu = lieuDuPorteur(m)
        return m.layerMask !== CACHE && (!lieu || lieu === 'mixte' || (lieu === 'parc') !== estDedans)
      })
    }
  }
  scene.onBeforeRenderObservable.add(() => {
    // La vue d'abord : elle recale `globalPosition` sur la caméra déplacée (sinon la place de l'image
    // d'avant, puis la nouvelle au milieu du tri : sur le seuil, dedans d'un côté, cône de l'autre).
    const [v, pr] = [camera.getViewMatrix(), camera.getProjectionMatrix()]
    const p = camera.globalPosition
    const dedans = p.x > 0 && p.x < plan.width && p.z > 0 && p.z < plan.depth
    const t = performance.now()
    if (!(Math.hypot(p.x - oeil.x, p.z - oeil.z) < RAYON_OEIL / 2 && Math.abs(p.y - oeil.y) < 0.5)) {
      oeil.copyFrom(p)
      vues = zonesVisibles(plan, zonesDuVolume(plan, p, p, RAYON_OEIL), p)
      cle = [...vues].sort().join()
    }
    if (t > relu) {
      // Chaque seconde : les couches qui arrivent, les maillages libérés qui partent (toiles proches), les petites boîtes qui bougent (Bavette).
      relu = t + 1000
      lieux.clear()
      zonesDe.clear()
      for (const m of scene.meshes) {
        // Un lot garde le lieu de ses instances d'origine : compacté, sa boîte rétrécit.
        const lieu = (m as Mesh).hasThinInstances ? (lieuxFixes.get(m) ?? lieuDe(m)) : lieuDe(m)
        if ((m as Mesh).hasThinInstances) lieuxFixes.set(m, lieu)
        lieux.set(m, lieu)
        zonesDe.set(m, zonesDuMaillage(m, lieu))
      }
    }
    // Le champ et les cônes des portes, refaits seulement quand la caméra a bougé.
    if (v.updateFlag !== drapeau[0] || pr.updateFlag !== drapeau[1]) {
      drapeau = [v.updateFlag, pr.updateFlag]
      Frustum.GetPlanesToRef(camera.getTransformationMatrix(), champ)
      cones = portes.filter((c) => dansLeCone(c, champ)).map((c) => plansDuPortail(p, c))
    }
    // Les porteurs d'ombre de l'autre côté qui passent par la porte ; rentré, sorti, autres zones ou ce choix changé : la carte est redessinée.
    let empreinte = dedans ? 1 : 0
    for (const s of cle) empreinte = (empreinte * 31 + s.charCodeAt(0)) % 1e9
    for (const x of generateurs) {
      const d = x.l.direction ?? BAS
      if (!tmp.copyFrom(d).normalize().equalsWithEpsilon(x.d, 1e-4)) {
        x.d.copyFrom(tmp)
        ombres = new WeakMap()
      }
      for (const m of x.g.getShadowMap()?.renderList ?? []) {
        const lieu = lieuDuPorteur(m)
        const passe = !!lieu && lieu !== 'mixte' && (lieu === 'parc') === dedans && Vector3.Distance(p, m.getBoundingInfo().boundingSphere.centerWorld) < PORTEE_OMBRE && cones.some((c) => dansLeCone(ombreDe(m, x.d), c))
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
      const zones = zonesDe.get(m)!
      // Un maillage de l'autre côté de la façade ne se voit que par la porte.
      const autre = !tout && lieu !== 'mixte' && (lieu === 'parc') === dedans
      const lot = lotDuLieu(m, lieu)
      let montre: boolean
      if (lot) {
        // Un lot reprend les instances des zones vues, dans le champ de la caméra (sa boîte couvre
        // souvent tout le musée : Babylon ne trierait rien) ; de l'autre côté de la façade, dans le cône d'une porte.
        lot.filtre = [tout ? null : vues, tout ? 'tout' : cle, tout ? null : autre ? cones : [champ]]
        montre = compacter(m as Mesh, lot, ...lot.filtre) > 0
      } else {
        // Par la porte, de loin (le centre à plus de PORTEE_VUE), l'autre côté n'est plus que quelques pixels : les murs (lots) restent, le reste part.
        const loin = autre && Vector3.Distance(p, m.getBoundingInfo().boundingSphere.centerWorld) > PORTEE_VUE
        montre = tout || (vu(zones, vues) && (!autre || (!loin && cones.some((c) => m.alwaysSelectAsActiveMesh || dansLeCone(m.getBoundingInfo().boundingBox.vectorsWorld, c)))))
      }
      m.layerMask = montre ? VU : CACHE
    }
  })

  return { lieuDe }

  /** Les zones d'un maillage : déclarées (`metadata.zone`, 'ciel' jamais caché), aucune s'il suit la caméra, sinon sa boîte. */
  function zonesDuMaillage(m: AbstractMesh, lieu: Lieu): Zone[] {
    const z = m.metadata?.zone
    if (typeof z === 'string') return z === 'ciel' ? [] : [z]
    if (m.alwaysSelectAsActiveMesh || m.getTotalVertices() === 0) return []
    if (lieu === 'parc') return [PARC]
    const b = m.getBoundingInfo().boundingBox
    return zonesDuVolume(plan, b.minimumWorld, b.maximumWorld)
  }

  /**
   * Un lot d'instances immobiles du bâtiment (dedans ou à cheval) : les lots du
   * parc, ceux qui suivent la caméra et ceux qu'une couche anime n'en sont pas ;
   * celui qu'une couche réécrit après coup lui est rendu.
   */
  function lotDuLieu(m: AbstractMesh, lieu: Lieu): Lot | null {
    let lot = lots.get(m)
    if (lot === undefined) {
      const ok = (lieu !== 'parc' || m.metadata?.immobile === true) && !m.alwaysSelectAsActiveMesh && m.metadata?.zone === undefined && (m as Mesh).hasThinInstances && (m as Mesh).thinInstanceCount > 1
      lot = ok ? lotDe(m as Mesh, plan) : null
      lots.set(m, lot)
      if (lot) LOTS.set(m as Mesh, lot)
    } else if (lot && reecrit(m as Mesh, lot)) {
      lots.set(m, (lot = null))
      LOTS.delete(m as Mesh)
    }
    return lot
  }

  function lieuDe(m: AbstractMesh): Lieu {
    const z0 = m.metadata?.zone
    if (z0 === PARC) return 'parc'
    // Une salle déclarée : dedans.
    if (typeof z0 === 'string' && z0 !== 'ciel') return 'dedans'
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
