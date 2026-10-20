/**
 * Le soleil réel (ou la lune) : DirectionalLight, ambiance hémisphérique, fond
 * du ciel et carte d'ombre dessinée à la demande.
 *
 * Mêmes valeurs que three (Ciel.tsx, lighting.ts), couleurs en linéaire, pour
 * des matières PBR Lambert (boites.ts) : le soleil y vaut albedo/π × éclairement
 * comme dans three ; l'hémisphérique, elle, n'y passe pas par le BRDF
 * (albedo × éclairement), on la divise donc par π. Sous un ciel couvert ou dans
 * le brouillard (météo CIBLE, comme three), le soleil s'efface. Tout suit l'état
 * vivant : l'heure qui avance et la météo (`monterSoleil`).
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Light } from '@babylonjs/core/Lights/light'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import { type Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { cadrerOmbre, ecartDeMatrice, redessinerOmbre } from '../domain/ombres.ts'
import type { Meteo } from '../domain/meteo.ts'
import { directionDuSoleil, type Ciel } from '../domain/soleil.ts'
import { vivant } from './etat.ts'
import { reglerLueurs } from './lueurs.ts'

export interface Reglages {
  /** Sens de PROPAGATION (= −directionDuSoleil), la lune quand le soleil est couché. */
  direction: [number, number, number]
  couleur: string
  intensite: number
  /** L'hémisphérique : ciel, sol, intensité. */
  ciel: string
  sol: string
  ambiant: number
  /** clearColor. */
  fond: string
}

// Ciel.tsx et lighting.ts : SOLEIL, LUNE, OR_BAS, AMBIANCE, AMBIANCE_NUIT.
const SOLEIL = { couleur: '#fff3e0', intensite: 3.4 }
const LUNE = { couleur: '#a9bcff', intensite: 0.35 }
const OR_BAS = '#ffb070'
const AMBIANCE = { ciel: '#dbe6f5', nuit: '#8a7358', sol: '#dcd8d0', jour: 1.9, minuit: 1.1 }
const FOND = { nuit: '#0b1224', jour: '#dbe6f5' }

/**
 * La boîte d'ombre de Ciel.tsx : ±`demi` m vu du soleil, centrée `avance` m
 * devant le visiteur et recalée par pas de `pas` m, la lumière reculée de
 * `recul` le long du rayon. 4096 texels : 2,7 cm par texel.
 */
const OMBRE = { demi: 55, carte: 4096, avance: 25, recul: 150, pas: 3 }

/** Mélange deux couleurs hex en espace linéaire, comme `THREE.Color.lerp`. */
const melange = (a: string, b: string, t: number) =>
  Color3.Lerp(Color3.FromHexString(a).toLinearSpace(), Color3.FromHexString(b).toLinearSpace(), t).toGammaSpace().toHexString()

type Temps = Pick<Meteo, 'nuages' | 'brouillard'>

export function reglagesDuCiel(c: Ciel, meteo?: Temps): Reglages {
  // La nuit, une lune fixe à 35° prend le relais, à l'opposé du soleil.
  const d = c.elevation > 0 ? directionDuSoleil(c) : directionDuSoleil({ elevation: 35, azimut: (c.azimut + 180) % 360 })
  return {
    direction: [-d[0], -d[1], -d[2]],
    couleur: melange(LUNE.couleur, melange(SOLEIL.couleur, OR_BAS, c.crepuscule), c.jour),
    // Le voile de Ciel.tsx : sous un ciel couvert, plus d'ombre franche.
    intensite: (SOLEIL.intensite * c.jour + LUNE.intensite * (1 - c.jour)) * (1 - Math.min(0.85, meteo ? meteo.nuages * 0.75 + meteo.brouillard * 0.4 : 0)),
    ciel: melange(AMBIANCE.nuit, AMBIANCE.ciel, c.jour),
    sol: AMBIANCE.sol,
    ambiant: (AMBIANCE.minuit + (AMBIANCE.jour - AMBIANCE.minuit) * c.jour) / Math.PI,
    fond: melange(FOND.nuit, FOND.jour, c.jour),
  }
}

/** Direction, couleur, intensité du soleil (ou de la lune), hémisphérique et fond linéaire. */
export function reglerSoleil(soleil: DirectionalLight, hemi: HemisphericLight, scene: Scene, c: Ciel, meteo?: Temps): void {
  const r = reglagesDuCiel(c, meteo)
  soleil.direction = new Vector3(...r.direction)
  soleil.diffuse = Color3.FromHexString(r.couleur).toLinearSpace()
  soleil.intensity = r.intensite
  hemi.diffuse = Color3.FromHexString(r.ciel).toLinearSpace()
  hemi.groundColor = Color3.FromHexString(r.sol).toLinearSpace()
  hemi.intensity = r.ambiant
  // Linéaire : le fond passe par la cible HDR puis le rendu des tons (postTraitement.ts), comme celui de three.
  scene.clearColor = Color4.FromHexString(r.fond + 'ff').toLinearSpace()
}

/** Un porteur qui bouge, suivi par la veille : le maillage (et ses os), leurs matrices au dernier dessin. */
interface Mobile { m: AbstractMesh; suivis: { getWorldMatrix(): Matrix }[]; rayon: number; dessine: Float32Array }
/** Les porteurs qui bougent, relevés par `fondrePorteurs` (tous les autres sont immobiles). */
const MOBILES: Mobile[] = []
const lire = (p: Mobile) => p.suivis.forEach((s, i) => p.dessine.set(s.getWorldMatrix().m, 16 * i))

/**
 * La veille des porteurs (VeilleDesPorteurs de three, porteurs.ts) : la distance
 * au visiteur du plus proche porteur qui s'est écarté de plus d'un demi-texel
 * de sa place sur la carte, si lui ou son ombre (vers `d`, jusqu'au sol) est
 * dans le champ ; `Infinity` sinon.
 */
function bouge(scene: Scene, d: Vector3, seuil: number): number {
  const cam = scene.activeCamera
  if (!cam || MOBILES.length === 0) return Infinity
  const champ = scene.frustumPlanes
  let min = Infinity
  for (const p of MOBILES) {
    if (!p.m.isEnabled() || !p.m.isVisible) continue
    let e = 0
    p.suivis.forEach((s, i) => (e = Math.max(e, ecartDeMatrice(p.dessine, 16 * i, s.getWorldMatrix().m, p.rayon))))
    if (e <= seuil) continue
    const s = p.m.getBoundingInfo().boundingSphere
    // La sphère qui tient le porteur et son ombre (60 m au plus, jusqu'à 2 m sous le zéro).
    const t = Math.min(60, (s.centerWorld.y + s.radiusWorld + 2) / Math.max(-d.y, 1e-3)) / 2
    const c = s.centerWorld.add(d.scale(t))
    if (champ?.some((pl) => pl.dotCoordinate(c) < -(s.radiusWorld + t))) continue
    min = Math.min(min, Math.max(0, Vector3.Distance(c, cam.globalPosition) - s.radiusWorld - t))
  }
  return min
}

/**
 * Pose le soleil, l'hémisphérique et le fond. Avec `ombres`, la carte n'est
 * dessinée qu'à la demande (RENDER_ONCE) : quand la boîte, qui suit la caméra
 * active, glisse d'un pas, quand la direction du soleil change, ou quand un
 * porteur qui bouge s'écarte de sa place (`bouge`, `redessinerOmbre` : à
 * chaque image à moins de 25 m, 15 fois par seconde jusqu'à 110 m). Les
 * porteurs s'ajoutent par `generateur.addShadowCaster` (main.ts) ; seuls ceux
 * dont la boîte touche le volume de la lumière sont dessinés (Babylon ne trie
 * pas une liste de porteurs : sans ce tri, tout le parc à chaque redessin).
 */
export function monterSoleil(
  scene: Scene,
  c: Ciel,
  ombres: boolean,
): { soleil: DirectionalLight; hemi: HemisphericLight; generateur: ShadowGenerator | null } {
  const soleil = new DirectionalLight('soleil', new Vector3(0, -1, 0), scene)
  soleil.specular = Color3.Black()
  const hemi = new HemisphericLight('ciel', new Vector3(0, 1, 0), scene)
  hemi.specular = Color3.Black()
  // Sur une surface cuite, la lightmap (qui porte f × cette hémisphérique, boites.ts) la remplace ; le soleil reste en temps réel.
  hemi.lightmapMode = Light.LIGHTMAP_SHADOWSONLY
  reglerSoleil(soleil, hemi, scene, c, vivant.getState().meteo)
  // L'heure qui avance et le temps qui change : la clé d'ombre suit la direction, la carte se redessine seule.
  vivant.subscribe((s, avant) => {
    if (s.ciel === avant.ciel && s.meteo === avant.meteo) return
    reglerSoleil(soleil, hemi, scene, s.ciel, s.meteo)
    reglerLueurs(s.ciel.jour, hemi)
  })

  if (!ombres) return { soleil, hemi, generateur: null }

  soleil.autoUpdateExtends = false
  soleil.orthoLeft = soleil.orthoBottom = -OMBRE.demi
  soleil.orthoRight = soleil.orthoTop = OMBRE.demi
  soleil.shadowMinZ = 1
  soleil.shadowMaxZ = 2 * OMBRE.recul
  const generateur = new ShadowGenerator(OMBRE.carte, soleil)
  generateur.usePercentageCloserFiltering = true
  generateur.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
  generateur.bias = 5e-4
  generateur.normalBias = 0.02
  const carte = generateur.getShadowMap()!
  carte.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
  const plans = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))
  carte.getCustomRenderList = (_, liste, n) => {
    Frustum.GetPlanesToRef(generateur.getTransformMatrix(), plans)
    const dans: AbstractMesh[] = []
    for (let i = 0; i < n; i++) if (liste![i].isInFrustum(plans)) dans.push(liste![i])
    return dans
  }

  let cle = ''
  let depuis = 0
  let enAttente = false
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera
    if (!cam) return
    depuis += scene.getEngine().getDeltaTime() / 1000
    // Le point `avance` m devant le visiteur, à l'horizontale, arrondi au pas.
    const avant = cam.getDirection(Vector3.Forward(scene.useRightHandedSystem))
    const h = Math.hypot(avant.x, avant.z) || 1
    const p = [cam.position.x + (avant.x / h) * OMBRE.avance, cam.position.y, cam.position.z + (avant.z / h) * OMBRE.avance]
      .map((v) => Math.round(v / OMBRE.pas) * OMBRE.pas) as [number, number, number]
    const l = soleil.direction
    const nouvelle = `${p.join()}|${l.x},${l.y},${l.z}`
    // Sans la garde de deux secondes de three : chaque couche qui arrive redessine déjà la carte (main.ts).
    const r = redessinerOmbre(nouvelle !== cle, bouge(scene, l, OMBRE.demi / OMBRE.carte), enAttente, Math.min(depuis, 1))
    enAttente = r.enAttente
    if (!r.dessiner) return
    depuis = 0
    for (const m of MOBILES) lire(m)
    cle = nouvelle
    // Recalée au texel près vue du soleil, sans quoi chaque pas ferait scintiller le bord des ombres.
    const [x, y, z] = cadrerOmbre(p, [-l.x, -l.y, -l.z], (2 * OMBRE.demi) / OMBRE.carte)
    soleil.position.set(x - l.x * OMBRE.recul, y - l.y * OMBRE.recul, z - l.z * OMBRE.recul)
    carte.resetRefreshCounter()
  })
  return { soleil, hemi, generateur }
}

/** Les greffes qui ne touchent que la couleur : leur porteur peut être fondu (les autres plient les sommets : vent, lierre). */
const COULEUR_SEULE = /^(PBR|Sheen|DetailMap|Lueurs|Brume|Intemperies|Parement|Chaperon|VieuxMur|Caustiques|GaletMouille|SoucheMoussue|Vegetal-mousse$)/
/** Les porteurs qui bougent sans squelette : les aiguilles de l'horloge (nef.ts), la cloche et son marteau (cloche.ts). */
const BOUGE = /Aiguille|^cloche:/
/** Le côté (m) d'une case de fonte : la carte d'ombre garde son tri par le volume de la lumière, case par case. */
const CASE = 32

/**
 * Les porteurs immobiles et opaques fondus en quelques maillages d'ombre seule
 * (un par case de `CASE` m), hors de `scene.meshes` : la caméra ne les voit
 * pas, la carte d'ombre en fait un appel par case au lieu d'un par porteur
 * (≤ 300 appels à l'image de redessin). Une case par côté de la façade
 * (`lieuDe` de visibilite.ts : parc, dedans, à cheval) : la carte d'ombre garde
 * ce tri-là (le parc caché du dedans, et l'inverse), pas celui des salles.
 * Immobile : sans squelette ni cible de morphose, hors de `BOUGE` ; les autres
 * passent à la veille (`bouge`), os compris pour un maillage animé.
 * À appeler tout arrivé, après `toutMontrer()` (les lots complets).
 * ponytail : un nouveau porteur animé sans squelette doit entrer dans `BOUGE`, sinon son ombre reste figée.
 */
export function fondrePorteurs(scene: Scene, generateur: ShadowGenerator, lieuDe: (m: AbstractMesh) => string): number {
  const carte = generateur.getShadowMap()!
  const cases = new Map<string, Mesh[]>()
  for (const m of [...(carte.renderList ?? [])] as Mesh[]) {
    const mat = m.material
    const fixe = !m.skeleton && !m.morphTargetManager && !BOUGE.test(m.name)
    if (!fixe) {
      const suivis = [m, ...(m.skeleton?.bones.map((b) => b.getTransformNode() ?? b) ?? [])]
      const p = { m, suivis, rayon: m.getBoundingInfo().boundingSphere.radiusWorld, dessine: new Float32Array(16 * suivis.length) }
      lire(p)
      MOBILES.push(p)
    }
    const opaque = !!mat && !mat.needAlphaBlending() && !mat.needAlphaTesting() && (mat.pluginManager?._plugins ?? []).every((p) => COULEUR_SEULE.test(p.name))
    if (!fixe || !opaque || !m.isEnabled() || m.getTotalVertices() === 0 || (m.hasThinInstances && m.thinInstanceCount === 0)) continue
    const c = m.getBoundingInfo().boundingSphere.centerWorld
    const cle = `${Math.floor(c.x / CASE)}:${Math.floor(c.z / CASE)}:${lieuDe(m)}`
    cases.set(cle, [...(cases.get(cle) ?? []), m])
  }
  // Double face : un panneau, une toile de drapeau portent leur ombre quel que soit le côté du soleil.
  const nue = new StandardMaterial('ombres', scene)
  nue.backFaceCulling = false
  for (const [cle, ms] of cases) {
    if (ms.length < 2) continue
    const positions: number[] = []
    const normales: number[] = []
    const indices: number[] = []
    const v = new Vector3()
    const n = new Vector3()
    for (const m of ms) {
      const pos = m.getVerticesData('position')!
      const nor = m.getVerticesData('normal') ?? new Float32Array(pos.length)
      const idx = m.getIndices() ?? Array.from({ length: pos.length / 3 }, (_, i) => i)
      const monde = m.computeWorldMatrix(true)
      const poses = m.hasThinInstances ? m.thinInstanceGetWorldMatrices().slice(0, m.thinInstanceCount).map((t) => t.multiply(monde)) : [monde]
      for (const w of poses) {
        const base = positions.length / 3
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v)
          Vector3.TransformNormalFromFloatsToRef(nor[i], nor[i + 1], nor[i + 2], w, n)
          n.normalize()
          positions.push(v.x, v.y, v.z)
          normales.push(n.x, n.y, n.z)
        }
        for (const i of idx) indices.push(base + i)
      }
      generateur.removeShadowCaster(m, false)
    }
    const fonte = new Mesh(`ombres:${cle}`, scene)
    Object.assign(new VertexData(), { positions, normals: normales, indices }).applyToMesh(fonte)
    fonte.material = nue
    // Le côté de la façade de ses porteurs : le tri de la carte (visibilite.ts) le lit comme le leur.
    fonte.metadata = { lieu: cle.slice(cle.lastIndexOf(':') + 1) }
    // Hors de la liste de la scène : ni la caméra, ni les sondes, ni le tri des salles ne le voient.
    scene.removeMesh(fonte)
    generateur.addShadowCaster(fonte, false)
  }
  carte.resetRefreshCounter()
  return cases.size
}
