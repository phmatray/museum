/**
 * Les matières PBR ambientCG (`public/assets/materials`, gitignoré, rempli par
 * `node tools/fetch-assets.ts`) : l'équivalent de `useMatiere` / `creerMatiere`
 * (scene/materials.ts) et de `chargerMatiere` (io/textures.ts), sans three.
 *
 * Trois cartes par matière : Color (sRGB), NormalGL et Roughness (données,
 * rugosité lue sur le canal vert). Le `.ktx2` d'abord (KhronosTextureContainer2
 * de Babylon, décodeurs de `public/ktx2/` réglés par glb.ts), le `.jpg` s'il échoue. Les deux ont la même
 * orientation (KTX2 encodés `isYFlip`) : `invertY` par défaut dans les deux cas.
 * Une promesse par matière et par scène ; chaque matière PBR reçoit des CLONES
 * (même texture GPU), pour régler sa propre répétition.
 *
 * Les UV attendues sont en MÈTRES (`boitesFusionnees`, `geometrieCuite` de
 * boites.ts) : la répétition vaut 1/motif. La matière n'est prête qu'avec ses
 * cartes (même serveur, ~0,5 s) : sinon elle compilerait deux fois, aplat puis
 * cartes. Si elles manquent (ou au bout de 3 s), elle se rend en aplat (`repli`,
 * par défaut la teinte) ; three, lui, rend la teinte sans le gain, souvent du blanc.
 * ponytail : pas de délai de repli KTX2 → JPG comme three (un transcodeur muet
 * laisse l'aplat) ; pas de `peindreRebond` (rebond) ni de `retoucherCartes` :
 * ce sont des shaders, à la charge des couches qui en ont besoin (parement).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Scene } from '@babylonjs/core/scene'

import { matiere } from './boites.ts'
import { configurerDecodeurs } from './glb.ts'
import { lin } from './lueurs.ts'

export type MatiereId = 'beton' | 'platre' | 'platre-peint' | 'parquet' | 'marbre' | 'metal' | 'herbe' | 'gravier' | 'roche'

export interface Reglage {
  /** Multiplie la teinte quand les cartes sont là (calé sur la moyenne de la carte couleur). */
  gain: number
  /** Facteur de la carte de rugosité ; sans carte, la rugosité plafonnée à 1. */
  rugosite: number
  metal: number
  /** Rebond peint sous les faces tournées vers le bas (shader, non porté ici). */
  rebond: number
  /** Côté de la tuile, en mètres. */
  motif: number
  teinte?: string
}

/** REGLAGE_MATIERE de scene/materials.ts, recopié (l'importer tirerait three). */
export const REGLAGES: Record<MatiereId, Reglage> = {
  beton: { gain: 1.45, rugosite: 1, metal: 0, rebond: 0.24, motif: 2.6 },
  platre: { gain: 1.25, rugosite: 1, metal: 0, rebond: 0.14, motif: 3.2 },
  'platre-peint': { gain: 1.45, rugosite: 1, metal: 0, rebond: 0.14, motif: 3.2 },
  parquet: { gain: 1.2, rugosite: 0.9, metal: 0, rebond: 0.2, motif: 3 },
  marbre: { gain: 1.0, rugosite: 1.3, metal: 0, rebond: 0.24, motif: 0.9 },
  metal: { gain: 1.8, rugosite: 1.0, metal: 0.22, rebond: 0.3, motif: 0.5 },
  herbe: { gain: 1.1, rugosite: 3, metal: 0, rebond: 0, motif: 6, teinte: '#c8d6a4' },
  gravier: { gain: 0.95, rugosite: 1, metal: 0, rebond: 0, motif: 3.5, teinte: '#d8cfbd' },
  roche: { gain: 1.35, rugosite: 1, metal: 0, rebond: 0, motif: 1.6, teinte: '#d6d8da' },
}

/** SOURCE_AMBIENTCG de io/textures.ts. */
const SOURCES: Record<MatiereId, string> = {
  beton: 'Concrete034',
  platre: 'Plaster001',
  'platre-peint': 'PaintedPlaster017',
  parquet: 'WoodFloor007',
  marbre: 'Terrazzo005',
  metal: 'Metal032',
  herbe: 'Grass004',
  gravier: 'Gravel023',
  roche: 'Rock044',
}

export interface Cartes { couleur: Texture; normale: Texture; rugosite: Texture }

/** Les URL d'une matière, en `.jpg` (le `.ktx2` porte le même nom). */
export function cheminsDeCartes(id: MatiereId, base = import.meta.env.BASE_URL): Record<keyof Cartes, string> {
  const nom = SOURCES[id]
  const p = `${base}assets/materials/${nom}/${nom}_1K-JPG_`
  return { couleur: `${p}Color.jpg`, normale: `${p}NormalGL.jpg`, rugosite: `${p}Roughness.jpg` }
}

/** Une carte, KTX2 d'abord puis JPG ; rejette si les deux manquent. */
function carte(scene: Scene, url: string, srgb: boolean): Promise<Texture> {
  const essai = (u: string) => new Promise<Texture>((ok, ko) => {
    const t: Texture = new Texture(u, scene, { onLoad: () => ok(t), onError: (m) => { t.dispose(); ko(new Error(`${u} : ${m ?? 'échec'}`)) } })
    t.gammaSpace = srgb
  })
  return essai(url.replace(/\.jpg$/, '.ktx2')).catch(() => essai(url)).then((t) => {
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE
    t.anisotropicFilteringLevel = 8
    return t
  })
}

const enCours = new WeakMap<Scene, Map<MatiereId, Promise<Cartes>>>()

/** Les trois cartes d'une matière, chargées une fois par scène (un échec se retente à l'appel suivant). */
export function chargerCartes(scene: Scene, id: MatiereId): Promise<Cartes> {
  const cache = enCours.get(scene) ?? new Map<MatiereId, Promise<Cartes>>()
  enCours.set(scene, cache)
  const deja = cache.get(id)
  if (deja) return deja
  configurerDecodeurs()
  const c = cheminsDeCartes(id)
  const p = Promise.all([carte(scene, c.couleur, true), carte(scene, c.normale, false), carte(scene, c.rugosite, false)])
    .then(([couleur, normale, rugosite]) => ({ couleur, normale, rugosite }))
  p.catch(() => cache.delete(id))
  cache.set(id, p)
  return p
}

export interface Options {
  /** Teinte (avant gain), par défaut celle du réglage, sinon blanc. */
  teinte?: string
  /** L'aplat tant que les cartes manquent (par défaut la teinte). */
  repli?: string
  /** Côté de la tuile en mètres ; `null` : UV déjà à l'échelle de la carte (1 × 1, parquet de la salle d'honneur). */
  motif?: number | null
}

const habillages: Promise<void>[] = []
/** Quand toutes les matières PBR créées jusqu'ici ont leurs cartes (ou y ont renoncé). */
export const cartesChargees = (): Promise<unknown> => Promise.all(habillages)

/**
 * Une matière PBR Lambert (`matiere()` de boites.ts) qui reçoit ses cartes à
 * leur arrivée : albedo = teinte × gain, rugosité = facteur × carte (canal G),
 * métal constant, normale OpenGL. Pas prête (donc pas dessinée) avant elles.
 * À vérifier en lumière rasante (?heure=07:30) : en main droite, une carte
 * lue avec invertY ne devrait demander ni invertNormalMapX ni Y (le chargeur
 * glTF n'inverse Y que pour ses textures à v descendant).
 */
export function matierePBR(nom: string, id: MatiereId, scene: Scene, options: Options = {}): PBRMaterial {
  const r = REGLAGES[id]
  const teinte = options.teinte ?? r.teinte ?? '#ffffff'
  const m = matiere(nom, scene, options.repli ?? teinte, Math.min(1, r.rugosite))
  m.metallic = r.metal
  const echelle = options.motif === null ? 1 : 1 / (options.motif ?? r.motif)
  let habillee = false
  const pret = m.isReadyForSubMesh.bind(m)
  m.isReadyForSubMesh = (...a) => habillee && pret(...a)
  setTimeout(() => (habillee = true), 3000)
  const habillage = chargerCartes(scene, id).then((c) => {
    const clone = (t: Texture) => {
      const k = t.clone()
      k.uScale = k.vScale = echelle
      return k
    }
    m.albedoTexture = clone(c.couleur)
    m.bumpTexture = clone(c.normale)
    m.metallicTexture = clone(c.rugosite)
    m.useRoughnessFromMetallicTextureGreen = true
    m.useMetallnessFromMetallicTextureBlue = false
    m.useRoughnessFromMetallicTextureAlpha = false
    m.useAmbientOcclusionFromMetallicTextureRed = false
    m.roughness = r.rugosite
    m.albedoColor = lin(teinte).scale(r.gain)
  }).catch((e: unknown) => console.warn(`matière ${id} sans cartes`, e)).finally(() => (habillee = true))
  habillages.push(habillage)
  return m
}
