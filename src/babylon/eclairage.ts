/**
 * L'éclairage électrique (ProjecteursLayer, EveilLayer, EclairageLayer et le
 * dépoli des lanterneaux de PlanBuilding) :
 *
 * - le verre dépoli des lanterneaux : sous le toit il luit du ciel et s'éteint
 *   la nuit ; au rez-de-chaussée c'est un plafond électrique, plus chaud la nuit ;
 * - un projecteur sur rail par toile (`plan/projecteurs.ts`, `projecteur.glb`) :
 *   monture, tête inclinée et lentille en thin instances, rails en boîtes ;
 * - la toile regardée (`toileRegardee`) allume sa lentille et UNE SpotLight
 *   partie de son projecteur, toujours dans la scène (en ajouter ou en retirer
 *   une recompilerait toutes les matières), fondue 0 ↔ 9 ;
 * - chaque projecteur verse sa flaque chaude sur sa toile : 116 SpotLight hors
 *   scène, dans un ClusteredLightContainer (forward+, WebGPU et WebGL2 à
 *   tampons flottants mélangeables ; sans lui, pas de flaques). Une matière
 *   ne le voit que si elle l'accepte (`sousLesProjecteurs` : 6 lumières au lieu
 *   de 4, chute glTF pour que la portée coupe le pinceau avant le mur voisin,
 *   la lumière ne connaissant pas les murs) ;
 * - un halo doré autour de chaque toile poussée dans l'année (`eclat`), additif ;
 * - les disques des 25 spots sous les balcons et des 9 projecteurs de façade.
 *
 * La lumière versée par ces spots et projecteurs est déjà dans lueurs.ts.
 * Le jour suit l'heure (`auCiel` : dépolis, disques des projecteurs) ; la pluie
 * ruisselle sur le lanterneau sous le toit. Tout est tone mappé, comme
 * dans three où le ToneMapping final passe sur toute l'image (`toneMapped: false` n'y change rien).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer'
import { Light } from '@babylonjs/core/Lights/light'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import type { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Shaders/ShadersInclude/pbrClusteredLightingFunctions'
import '@babylonjs/core/ShadersWGSL/ShadersInclude/pbrClusteredLightingFunctions'
import type { Scene } from '@babylonjs/core/scene'

import { DEFAULT_ASPECT } from '../domain/hanging.ts'
import type { Artwork } from '../domain/types.ts'
import { PROJECTEURS_FACADE, SPOTS_BALCON } from '../plan/eclairage.ts'
import { eclat, toileRegardee, type Placement } from '../plan/eveil.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { projecteurs, rails, type Projecteur } from '../plan/projecteurs.ts'
import { solDuParc } from '../plan/relief.ts'
import { avecVitrines } from '../plan/vitrines.ts'
import { cubes, matiere } from './boites.ts'
import { auCielMatiere, partie, publier } from './etat.ts'
import { remplacer } from './postTraitement.ts'
import { chargerGlb } from './glb.ts'
import { ruisseler } from './intemperies.ts'
import { brancherLueurs, lin, lueursDuJour } from './lueurs.ts'

/** Le dépoli d'un niveau (PlanBuilding.tsx) : lerps en linéaire, comme `THREE.Color`. */
export function depoli(jour: number, sousLeToit: boolean): { albedo: Color3; emissive: Color3; force: number } {
  const nuit = 1 - jour
  return {
    albedo: lin('#f4f1ea').scale(sousLeToit ? 0.4 + 0.6 * jour : 1),
    emissive: Color3.Lerp(lin('#fff6e6'), lin('#ffd6a0'), sousLeToit ? 0 : nuit),
    force: sousLeToit ? 0.03 + 0.52 * jour : 0.55 - 0.3 * nuit,
  }
}

/**
 * La matrice d'une pièce (`matrice` de ProjecteursLayer) : au point d'accroche
 * abaissé du pivot, lacet puis inclinaison (Euler YXZ de three = yaw, pitch de Babylon).
 */
export function matriceDePiece(p: Projecteur, pivotY: number, incliner: boolean): Matrix {
  const q = Quaternion.RotationYawPitchRoll(p.lacet, incliner ? p.inclinaison : 0, 0)
  return Matrix.Compose(Vector3.One(), q, new Vector3(p.x, p.y + pivotY, p.z))
}

/** La SpotLight de l'éveil (EveilLayer) : three angle 0,42 (demi-angle), pénombre 0,65, distance 7, decay 1,2. */
const INTENSITE = 9
const FONDU = 6
const DEMI_ANGLE = 0.42
const PENOMBRE = 0.65
const PORTEE = 7
const DECAY = 1.2
const BLANC_CHAUD = lin('#ffd7a8').scale(3)
/**
 * La flaque d'un projecteur : demi-angle 0,5 rad (la toile et 40 cm autour), le cœur
 * plein sur 0,2 ; portée 5,2 m en chute glTF : la toile, à 3,2 m de sa lentille (3,7 en
 * salle d'honneur), en garde plus de la moitié ; le sol de la salle voisine, que le
 * pinceau atteint à travers le mur (la lumière ne connaît pas les murs), au-delà de
 * 5 m, 2 % au plus. Blanc chaud, plus doux que la toile regardée.
 */
export const FLAQUE = { intensite: 25, demiAngle: 0.5, coeur: 0.2, portee: 5.2, couleur: '#ffd9ae' }

/** Les spots des flaques, un par projecteur, de son étrier vers sa toile ; hors scène (le conteneur les prend). */
export function spotsDesFlaques(tous: readonly Projecteur[], scene: Scene): SpotLight[] {
  const couleur = lin(FLAQUE.couleur)
  return tous.map((p) => {
    const [x, y, z] = p.source
    const s = new SpotLight(`flaque:${p.key}`, new Vector3(x, y, z), new Vector3(p.cible[0] - x, p.cible[1] - y, p.cible[2] - z).normalize(),
      2 * FLAQUE.demiAngle, 1, scene, true)
    s.innerAngle = 2 * FLAQUE.coeur
    s.diffuse = couleur
    s.specular = couleur
    s.intensity = FLAQUE.intensite
    s.range = FLAQUE.portee
    s.shadowEnabled = false
    return s
  })
}

/**
 * Babylon 9.31 : dans `computeClusteredLighting`, le velours (SHEEN) lit `normalW`, une variable
 * du shader appelant, au lieu de sa normale `N` : toute matière à reflet de velours sous la grappe
 * ne compile plus, et disparaît (le tissu et les rideaux du cinéma). GLSL et WGSL.
 */
export function corrigerVeloursDesGrappes(): void {
  // Au démarrage (main.ts), pas à l'import : voir `reserverLeMiroir`.
  for (const store of [ShaderStore.IncludesShadersStore, ShaderStore.IncludesShadersStoreWGSL])
    remplacer(store, 'pbrClusteredLightingFunctions', 'computeSheenLighting(preInfo,normalW,', () => 'computeSheenLighting(preInfo,N,')
}

/**
 * Les flaques en grappes, ou null si le moteur ne sait pas (WebGL2 sans tampon
 * flottant mélangeable) : la visite garde alors la seule toile regardée.
 */
export function monterFlaques(tous: readonly Projecteur[], scene: Scene): ClusteredLightContainer | null {
  // Toutes d'un coup au constructeur (une à une, chaque ajout repasse les maillages de la scène).
  const grappe = new ClusteredLightContainer('flaques', spotsDesFlaques(tous, scene), scene)
  if (!grappe.isSupported) {
    grappe.dispose()
    return null
  }
  // Des tuiles carrées d'environ 25 px en 16:9.
  grappe.horizontalTiles = 64
  grappe.verticalTiles = 36
  return grappe
}

/**
 * Les matières qui reçoivent les flaques : la grappe vient en 5ᵉ lumière (soleil, ciel,
 * lampe d'honneur, toile regardée) ; les autres en restent à 4 et ne la compilent pas.
 * Chute glTF : seules les flaques suivent la chute de la matière (les autres lumières ont la leur).
 */
export function sousLesProjecteurs(matieres: Iterable<Material>): void {
  for (const m of matieres) {
    if (!(m instanceof PBRMaterial)) continue
    m.maxSimultaneousLights = Math.max(m.maxSimultaneousLights, 6)
    m.useGLTFLightFalloff = true
  }
}

/** Les halos (EveilLayer) : or × 0,45 × éclat, débord de 0,7 m sur le cadre. */
const OR = lin('#ffb54a')
const DEBORD = 0.7

/**
 * Les halos des toiles poussées dans l'année (éclat > 0,02) : une matrice
 * (plan unité mis à l'échelle du cadre + débord, tourné vers la salle, 4 mm
 * devant le mur) et une couleur par toile.
 */
export function halos(placements: readonly Placement[], pushes: ReadonlyMap<string, string>, maintenant: Date): { matrices: Float32Array; couleurs: Float32Array } {
  const allumees = placements.flatMap((p) => {
    const push = pushes.get(p.key)
    const e = push ? eclat(push, maintenant) : 0
    return e > 0.02 ? [{ p, e }] : []
  })
  const matrices = new Float32Array(16 * allumees.length)
  const couleurs = new Float32Array(4 * allumees.length)
  allumees.forEach(({ p, e }, i) => {
    const [nx, nz] = p.normal
    Matrix.Compose(
      new Vector3(p.width + DEBORD, p.width / DEFAULT_ASPECT + DEBORD, 1),
      Quaternion.RotationAxis(Vector3.Up(), Math.atan2(nx, nz)),
      new Vector3(p.x + nx * 0.004, p.y, p.z + nz * 0.004),
    ).copyToArray(matrices, 16 * i)
    const c = OR.scale(0.45 * e)
    couleurs.set([c.r, c.g, c.b, 1], 4 * i)
  })
  return { matrices, couleurs }
}

/** Le plan des halos : dégradé radial blanc sur alpha, additif, non éclairé, sans écriture de profondeur. */
function monterHalos(scene: Scene, h: ReturnType<typeof halos>): void {
  if (h.couleurs.length === 0) return
  const dt = new DynamicTexture('halo', { width: 128, height: 128 }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  const d = g.createRadialGradient(64, 64, 8, 64, 64, 64)
  d.addColorStop(0, 'rgba(255,255,255,1)')
  d.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  d.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = d
  g.fillRect(0, 0, 128, 128)
  dt.hasAlpha = true
  dt.update()
  const plan = CreatePlane('halos', { size: 1 }, scene)
  plan.thinInstanceSetBuffer('matrix', h.matrices, 16, true)
  plan.thinInstanceSetBuffer('color', h.couleurs, 4, true)
  const mat = new PBRMaterial('halos', scene)
  mat.unlit = true
  mat.albedoTexture = dt
  mat.useAlphaFromAlbedoTexture = true
  mat.alphaMode = Constants.ALPHA_ADD
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  mat.disableDepthWrite = true
  mat.backFaceCulling = false
  plan.material = mat
  plan.isPickable = false
}

/** Rapproche `v` de `cible` d'une part `k`, et s'y pose au millième : sinon la valeur n'y arrive jamais et chaque image la réécrit. */
const approcher = (v: number, cible: number, k: number) => (Math.abs(cible - v) < 1e-3 ? cible : v + (cible - v) * k)

/**
 * Des disques (EclairageLayer), une thin instance par point ; `bas` tourne la face vers le sol. Une couleur :
 * un PBR non éclairé, qui luit ; une matière : la sienne.
 */
function disques(nom: string, points: [number, number, number][], rayon: number, bas: boolean, couleur: Color3 | PBRMaterial, scene: Scene, facettes = 16): Mesh {
  const d = CreateDisc(nom, { radius: rayon, tessellation: facettes }, scene)
  // CreateDisc regarde −z : −π/2 autour de x le tourne vers le bas, +π/2 vers le haut.
  d.bakeTransformIntoVertices(Matrix.RotationX(bas ? -Math.PI / 2 : Math.PI / 2))
  const m = new Float32Array(16 * points.length)
  points.forEach(([x, y, z], i) => Matrix.Translation(x, y, z).copyToArray(m, 16 * i))
  d.thinInstanceSetBuffer('matrix', m, 16)
  let mat = couleur
  if (!(mat instanceof PBRMaterial)) {
    mat = new PBRMaterial(nom, scene)
    mat.unlit = true
    mat.albedoColor = couleur as Color3
  }
  mat.backFaceCulling = false
  d.material = mat
  d.isPickable = false
  return d
}

/**
 * Des spots encastrés dans un plafond, vus d'en dessous : une collerette de métal ronde, éclairée par
 * la pièce, et 2 mm plus bas la lentille, non éclairée, vive au centre et plus sourde au bord (couleurs
 * aux sommets). Deux lots de thin instances. `points` : le centre de la collerette, sous le plafond.
 */
export function spotsEncastres(nom: string, points: [number, number, number][], rayon: number, couleur: Color3, scene: Scene): { collerette: Mesh; lentille: Mesh; verre: PBRMaterial } {
  const metal = matiere(`${nom}:collerette`, scene, '#d9d3c8', 0.5)
  metal.metallic = 0.3
  const collerette = disques(`${nom}:collerette`, points, rayon, true, metal, scene, 24)
  const r = rayon * 0.62
  const lentille = disques(`${nom}:lentille`, points.map(([x, y, z]) => [x, y - 0.002, z]), r, true, couleur, scene, 24)
  const verre = lentille.material as PBRMaterial
  // La lentille passe devant la collerette, même de loin (2 mm ne suffisent pas au tampon de profondeur).
  verre.zOffset = -2
  const pos = lentille.getVerticesData('position')!
  const teintes = new Float32Array((pos.length / 3) * 4)
  for (let i = 0; i < pos.length / 3; i++) {
    const k = 1 - 0.6 * Math.min(1, Math.hypot(pos[3 * i], pos[3 * i + 2]) / r)
    teintes.set([k, k, k, 1], 4 * i)
  }
  lentille.setVerticesData(VertexBuffer.ColorKind, teintes)
  return { collerette, lentille, verre }
}

export async function monterEclairage(
  scene: Scene,
  accrochage: Accrochage | null,
  lanterneaux: Mesh[],
  visiteur: () => { x: number; y: number; z: number; yaw: number },
): Promise<void> {
  // Les lanterneaux, un dépoli par niveau (le dernier est sous le toit).
  const ancien = lanterneaux[0]?.material
  lanterneaux.forEach((l, i) => {
    const sousLeToit = i === lanterneaux.length - 1
    const mat = matiere(`lanterneau-${i}`, scene, '#f4f1ea', 0.9)
    auCielMatiere(mat, (c) => {
      const r = depoli(c.jour, sousLeToit)
      mat.albedoColor = r.albedo
      mat.emissiveColor = r.emissive
      mat.emissiveIntensity = r.force
    })
    // Sous le toit, la pluie ruisselle sur le verre.
    if (sousLeToit) ruisseler(mat)
    l.material = mat
  })
  ancien?.dispose()
  brancherLueurs(lanterneaux.map((l) => l.material!))

  // Les disques : spots 5 mm sous la dalle des balcons, projecteurs au ras du dallage (gris éteints).
  spotsEncastres('spots-balcons', SPOTS_BALCON.map(([x, y, z]) => [x, y + 0.016, z]), 0.08, BLANC_CHAUD, scene)
  const pf = disques('projecteurs-facade', PROJECTEURS_FACADE.map(([x, , z]) => [x, solDuParc(x, z) + 0.006, z]), 0.08, false, BLANC_CHAUD, scene)
  const verre = pf.material as PBRMaterial
  auCielMatiere(verre, (c) => (verre.albedoColor = BLANC_CHAUD.scale(Math.min(1, lueursDuJour(c.jour).facade / 5)).add(new Color3(0.04, 0.04, 0.04))))

  if (!accrochage) return
  // La lumière de l'éveil, posée AVANT le chargement : elle entre dans les matières dès leur première compilation.
  const spot = new SpotLight('eveil', Vector3.Zero(), new Vector3(0, -1, 0), 2 * DEMI_ANGLE, 1, scene)
  // three : smoothstep(cos ext, cos int, cos θ) ; Babylon : saturate(linéaire)². Le cône intérieur
  // resserré de √2 en cosinus accorde les deux à mi-pénombre (sinon Babylon s'éteint deux fois plus vite).
  const [ext, int] = [Math.cos(DEMI_ANGLE), Math.cos(DEMI_ANGLE * (1 - PENOMBRE))]
  spot.innerAngle = 2 * Math.acos(ext + (int - ext) / Math.SQRT2)
  spot.diffuse = spot.specular = lin('#fff1d6')
  spot.falloffType = Light.FALLOFF_GLTF
  spot.range = PORTEE
  spot.intensity = 0

  const tous = projecteurs(MUSEE, avecVitrines(accrochage))
  // Les flaques aussi avant le chargement (la grappe est une lumière : elle entre dans la première compilation).
  monterFlaques(tous, scene)
  const c = await chargerGlb(scene, 'assets/architecture/projecteur.glb')
  c.addAllToScene()
  const piece = (nom: string) => c.meshes.find((m) => m.name === nom) as Mesh
  const [monture, tete, lentille] = [piece('Monture'), piece('Tete'), piece('Lentille')]
  // La lentille allumée : la géométrie de la lentille, clonée avant ses instances.
  const allumee = lentille.clone('lentille-allumee', null, true)
  const lentilleAllumee = matiere('lentille-allumee', scene, '#fff1d6')
  lentilleAllumee.emissiveColor = lin('#ffe2b0')
  lentilleAllumee.emissiveIntensity = 0
  allumee.material = lentilleAllumee
  allumee.setEnabled(false)

  const pivots = new Map<Mesh, number>()
  for (const [m, incliner] of [[monture, false], [tete, true], [lentille, true], [allumee, true]] as const) {
    // Le pivot (y −0,17 de la tête et de la lentille) passe dans la matrice, comme three.
    pivots.set(m, m.position.y)
    m.position.setAll(0)
    m.parent = null
    m.isPickable = false
    if (m === allumee) continue
    const buf = new Float32Array(16 * tous.length)
    tous.forEach((p, i) => matriceDePiece(p, pivots.get(m)!, incliner).copyToArray(buf, 16 * i))
    m.thinInstanceSetBuffer('matrix', buf, 16)
  }
  const alu = monture.material!
  cubes('rails', rails(MUSEE, avecVitrines(accrochage)), scene, alu).isPickable = false
  brancherLueurs([alu, lentille.material!])

  // L'éveil : la toile regardée (sans les vitrines, comme EveilLayer), sa lentille et sa lumière en fondu.
  const placements = accrochage.rooms.flatMap((r) => r.placements)
  // Les halos, sans catalogue rien (la visite continue).
  const catalogue = await fetch(`${import.meta.env.BASE_URL}data/catalogue.json`)
    .then((r) => r.json() as Promise<{ artworks: Artwork[] }>)
    .catch(() => ({ artworks: [] }))
  monterHalos(scene, halos(placements, new Map(catalogue.artworks.map((a) => [a.key, a.pushedAt])), new Date()))
  const parCle = new Map(tous.map((p) => [p.key, p]))
  let actif: Projecteur | null = null
  /** three décroît en 1/d^1,2, Babylon en 1/d² : accordés sur la toile visée. */
  let gain = 1
  scene.onBeforeRenderObservable.add(() => {
    const vue = toileRegardee(placements, visiteur())?.key ?? null
    // La carte de l'œuvre (ui/oeuvre.ts) suit la même toile.
    publier(partie, { toile: vue })
    const p = parCle.get(vue ?? '') ?? null
    if (p && p !== actif) {
      spot.position.set(...p.source)
      spot.direction.set(p.cible[0] - p.source[0], p.cible[1] - p.source[1], p.cible[2] - p.source[2])
      gain = spot.direction.length() ** (2 - DECAY)
      // Un cheveu (2 mm) devant la lentille éteinte, pour ne pas se battre avec elle.
      allumee.thinInstanceSetBuffer('matrix', Float32Array.from(Matrix.Translation(0, 0, 0.002).multiply(matriceDePiece(p, pivots.get(allumee)!, true)).asArray()), 16)
      allumee.setEnabled(true)
    }
    actif = p
    const k = 1 - Math.exp((-FONDU * scene.getEngine().getDeltaTime()) / 1000)
    const vise = actif ? 1 : 0
    lentilleAllumee.emissiveIntensity = approcher(lentilleAllumee.emissiveIntensity, 4 * vise, k)
    spot.intensity = approcher(spot.intensity, INTENSITE * gain * vise, k)
  })
}
