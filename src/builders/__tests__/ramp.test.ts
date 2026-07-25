/**
 * Tests de la rampe hélicoïdale (spec §7.5, §8).
 *
 * Ce que ces tests cherchent à empêcher, dans l'ordre de gravité :
 *
 *  1. Une rampe que le contrôleur cinématique ne peut pas monter — pente au
 *     delà de 40°, sur N'IMPORTE QUELLE configuration, pas seulement la vraie.
 *  2. Un trou dans la collision : le joueur traverse le tablier ou tombe entre
 *     deux boîtes. On l'attaque en échantillonnant la surface de marche et en
 *     exigeant qu'elle soit dans une boîte — pas en comptant les boîtes.
 *  3. Les deux pièges silencieux du spec §8 : le chanfrein qui gonfle
 *     l'emprise (visible seulement en *bounding box* 3D) et la géométrie non
 *     indexée qui donne un collider vide.
 *
 * Le dernier bloc rejoue tout ça sur les trois VRAIES rampes de
 * `public/data/museum.json` : c'est la seule preuve qui vaille.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { planBuilding, rampSlopeDegrees } from '../../domain/layout'
import type { Cluster } from '../../domain/clustering'
import type { Museum, MuseumConfig, Ramp } from '../../domain/types'
import {
  buildRamp,
  rampSlopeRadians,
  rampSurfacePoint,
  COLLIDER_OVERLAP,
  COLLIDER_STEP,
  RAILING_HEIGHT,
  RAILING_THICKNESS,
  RAMP_DECK_THICKNESS,
  RAMP_MAX_SLOPE_DEG,
  type OrientedBox,
} from '../ramp'

// ── Fixtures ─────────────────────────────────────────────────────────────

/** La rampe de référence du musée réel : atrium 20 m, demi-tour, 4,7 m de montée. */
function ramp(overrides: Partial<Ramp> = {}): Ramp {
  return {
    id: 'ramp-test',
    fromFloor: 'rdc',
    toFloor: 'etage-1',
    centre: { x: 0, z: 0 },
    radius: 8.8,
    startAngle: 0,
    sweep: Math.PI,
    width: 2.2,
    rise: 4.7,
    baseElevation: 0,
    ...overrides,
  }
}

function config(overrides: Partial<MuseumConfig['building']> = {}): MuseumConfig {
  return {
    schemaVersion: 1,
    name: 'Test',
    owners: ['acme'],
    filters: { excludeForks: true, excludeArchived: false },
    building: {
      roomDepth: 9,
      ceilingHeight: 4.3,
      slabThickness: 0.4,
      minAtriumSize: 12,
      minRoomWidth: 6,
      roomsPerFloor: 6,
      ...overrides,
    },
    clustering: { minClusterSize: 4, maxClusterSize: 14 },
  }
}

function clusters(...tailles: number[]): Cluster[] {
  return tailles.map((t, i) => ({
    id: `c${String(i).padStart(2, '0')}`,
    name: `C${i}`,
    topics: ['t'],
    keys: Array.from({ length: t }, (_, j) => `acme/c${i}-${j}`),
  }))
}

// ── Aides géométriques ───────────────────────────────────────────────────

function positionsOf(geometry: THREE.BufferGeometry): Float32Array {
  return geometry.getAttribute('position').array as Float32Array
}

/** Coordonnées d'un point monde dans le repère propre d'une boîte orientée. */
function toLocal(box: OrientedBox, p: { x: number; y: number; z: number }): THREE.Vector3 {
  const inverse = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(box.rotation[0], box.rotation[1], box.rotation[2], 'XYZ'))
    .invert()
  return new THREE.Vector3(p.x - box.position.x, p.y - box.position.y, p.z - box.position.z).applyQuaternion(
    inverse,
  )
}

/**
 * Marge de pénétration d'un point dans une boîte : positive s'il est dedans,
 * égale à la plus petite distance à une face. Négative = dehors.
 *
 * Attention à l'interprétation : un point de la SURFACE DE MARCHE est par
 * construction sur la face du dessus, donc sa pénétration vaut ~0. C'est
 * `margeTangentielle` qui mesure le recouvrement entre boîtes voisines.
 */
function penetration(box: OrientedBox, p: { x: number; y: number; z: number }): number {
  const l = toLocal(box, p)
  return Math.min(
    box.halfExtents.x - Math.abs(l.x),
    box.halfExtents.y - Math.abs(l.y),
    box.halfExtents.z - Math.abs(l.z),
  )
}

/** Marge restante le long de l'axe de parcours de la boîte, en mètres. */
function margeTangentielle(box: OrientedBox, p: { x: number; y: number; z: number }): number {
  return box.halfExtents.x - Math.abs(toLocal(box, p).x)
}

/**
 * Volume signé d'un maillage fermé. Positif ⇒ les faces sont orientées vers
 * l'extérieur ; nul ou négatif ⇒ le solide est retourné ou ouvert.
 */
function signedVolume(geometry: THREE.BufferGeometry): number {
  const pos = positionsOf(geometry)
  const index = geometry.getIndex()
  expect(index).not.toBeNull()
  const idx = index!.array
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let volume = 0
  for (let i = 0; i < idx.length; i += 3) {
    a.fromArray(pos, idx[i] * 3)
    b.fromArray(pos, idx[i + 1] * 3)
    c.fromArray(pos, idx[i + 2] * 3)
    volume += a.dot(b.clone().cross(c)) / 6
  }
  return volume
}

function aucunNaN(geometry: THREE.BufferGeometry): boolean {
  return Array.from(positionsOf(geometry)).every((v) => Number.isFinite(v))
}

// ── Les deux pièges du spec §8 ───────────────────────────────────────────

describe('piège ExtrudeGeometry — le chanfrein qui gonfle', () => {
  it("n'ajoute pas un millimètre à l'emprise horizontale", () => {
    const r = ramp()
    const box = buildRamp(r).geometry.boundingBox!
    const rayonExterieur = r.radius + r.width / 2 // 9.9

    // Le balayage va de 0 à π : les extrema en x sont atteints exactement aux
    // deux stations extrêmes. Un chanfrein par défaut ajouterait 0,1 m ici.
    expect(box.max.x).toBeCloseTo(rayonExterieur, 6)
    expect(box.min.x).toBeCloseTo(-rayonExterieur, 6)
    // Aucun point ne sort du rayon extérieur, dans aucune direction.
    for (const v of [box.max.x, box.max.z, -box.min.x, -box.min.z]) {
      expect(v).toBeLessThanOrEqual(rayonExterieur + 1e-6)
    }
  })

  it("n'épaissit pas le tablier — c'est la bounding box 3D qui le dit, pas une aire 2D", () => {
    const r = ramp()
    const box = buildRamp(r).geometry.boundingBox!
    // Hauteur totale = montée + UNE épaisseur. Avec le chanfrein par défaut,
    // l'épaisseur double (0,4 m au lieu de 0,2) sans qu'aucune aire ne bouge.
    expect(box.max.y - box.min.y).toBeCloseTo(r.rise + RAMP_DECK_THICKNESS, 6)
    expect(box.min.y).toBeCloseTo(r.baseElevation - RAMP_DECK_THICKNESS, 6)
  })

  it('produit un volume conforme au calcul analytique (pas de solide retourné)', () => {
    const r = ramp()
    const { geometry } = buildRamp(r)
    const ri = r.radius - r.width / 2
    const ro = r.radius + r.width / 2
    // Le tablier est un prisme d'épaisseur verticale constante posé sur un
    // secteur annulaire : V = e · balayage · (ro² − ri²)/2.
    const attendu = (RAMP_DECK_THICKNESS * r.sweep * (ro * ro - ri * ri)) / 2
    const obtenu = signedVolume(geometry)
    expect(obtenu).toBeGreaterThan(0)
    // La discrétisation par cordes sous-estime de sinc(pas) ≈ 0,08 % à 4°, et
    // ne SURESTIME jamais : un volume supérieur signalerait des faces dessus et
    // dessous découpées selon des diagonales opposées, donc un tablier qui
    // n'a plus l'épaisseur demandée.
    expect(obtenu).toBeGreaterThan(attendu * 0.998)
    expect(obtenu).toBeLessThan(attendu * 1.0001)
  })
})

/**
 * Une géométrie SANS attribut `uv` n'échantillonne pas « rien » : elle
 * échantillonne le texel (0, 0). Toute matière texturée posée dessus sort donc
 * en aplat, silencieusement. C'est ce qui faisait du garde-corps de la rampe la
 * dernière masse noire du musée.
 */
describe('coordonnées de texture', () => {
  it('le tablier et le garde-corps portent tous deux un attribut uv', () => {
    const build = buildRamp(ramp())
    for (const g of [build.geometry, build.railingGeometry]) {
      const uv = g.getAttribute('uv')
      expect(uv).toBeDefined()
      expect(uv.count).toBe(g.getAttribute('position').count)
      expect(uv.itemSize).toBe(2)
    }
  })

  it('les uv sont MÉTRIQUES : ils suivent la taille réelle, pas un carré unité', () => {
    // Un carré unité sortirait avec une étendue de 1 quelle que soit la rampe.
    // Ici la projection est en mètres, donc l'étendue vaut l'emprise : ~19,8 m
    // pour une rampe de rayon extérieur 9,9.
    const r = ramp()
    const uv = buildRamp(r).geometry.getAttribute('uv')
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < uv.count; i++) {
      min = Math.min(min, uv.getX(i))
      max = Math.max(max, uv.getX(i))
    }
    expect(max - min).toBeGreaterThan(2 * (r.radius + r.width / 2) - 1)
  })

  it('aucun uv n’est NaN : un seul contaminerait toute la matrice de texture', () => {
    const build = buildRamp(ramp())
    for (const g of [build.geometry, build.railingGeometry]) {
      const uv = g.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        expect(Number.isFinite(uv.getX(i))).toBe(true)
        expect(Number.isFinite(uv.getY(i))).toBe(true)
      }
    }
  })

  it('la hauteur reste en V sur les faces verticales du garde-corps', () => {
    // Sinon un motif directionnel — béton banché, métal brossé — part en
    // travers sur un garde-corps qui est justement ce qu'on voit de plus près.
    const g = buildRamp(ramp()).railingGeometry
    const position = g.getAttribute('position')
    const normal = g.getAttribute('normal')
    const uv = g.getAttribute('uv')
    let verticales = 0
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) continue
      verticales++
      expect(uv.getY(i)).toBeCloseTo(position.getY(i), 6)
    }
    expect(verticales).toBeGreaterThan(0)
  })
})

describe('piège ExtrudeGeometry — la géométrie non indexée', () => {
  it('indexe explicitement en Uint32Array, le format exigé par ColliderDesc.trimesh', () => {
    const { geometry, railingGeometry } = buildRamp(ramp())
    for (const g of [geometry, railingGeometry]) {
      const index = g.getIndex()
      expect(index).not.toBeNull()
      // `geometry.index === null` (ce que renvoie ExtrudeGeometry) donne un
      // collider vide : le joueur traverse le sol sans le moindre message.
      expect(index!.array).toBeInstanceOf(Uint32Array)
      expect(index!.count % 3).toBe(0)
      expect(index!.count).toBeGreaterThan(0)

      const sommets = g.getAttribute('position').count
      for (let i = 0; i < index!.count; i++) {
        expect(index!.array[i]).toBeLessThan(sommets)
      }
    }
  })
})

// ── Pente ────────────────────────────────────────────────────────────────

describe('pente', () => {
  it('vaut 9,6° sur la configuration réelle du spec §7.5', () => {
    const build = buildRamp(ramp())
    expect(build.slopeDegrees).toBeCloseTo(9.6, 1)
    expect(build.warnings).toEqual([])
  })

  it("ne diverge pas de la formule du domaine, qui est l'unique définition", () => {
    for (const r of [ramp(), ramp({ radius: 4.8, rise: 8.4 }), ramp({ sweep: 3 * Math.PI })]) {
      expect((rampSlopeRadians(r) * 180) / Math.PI).toBeCloseTo(rampSlopeDegrees(r), 9)
    }
  })

  it('ne dépend pas du sens de parcours', () => {
    expect(buildRamp(ramp({ sweep: -Math.PI })).slopeDegrees).toBeCloseTo(
      buildRamp(ramp()).slopeDegrees,
      9,
    )
  })

  it('reste sous 40° sur toute la matrice des configurations, extrêmes compris', () => {
    // La règle du domaine (spec §7.5) : rayon = atriumW/2 − 1,2 (plancher à
    // 1,5), montée = plafond + dalle, balayage = k·π avec k choisi pour rester
    // sous la pente cible. On la rejoue ici sans dépendre de `layout.ts`, pour
    // que le garde-fou tienne même si l'atrium tombe au minimum de 12 m et que
    // le plafond monte à 8 m — les deux extrêmes nommés par le spec.
    let rampesVues = 0
    for (const atriumW of [12, 14, 20, 38, 60]) {
      for (const ceilingHeight of [2.5, 4.3, 8, 20]) {
        for (const slabThickness of [0.2, 0.4, 1.5]) {
          const radius = Math.max(1.5, atriumW / 2 - 1.2)
          const rise = ceilingHeight + slabThickness
          let demiTours = 1
          while (demiTours < 64 && Math.atan(rise / (radius * demiTours * Math.PI)) >= (32 * Math.PI) / 180) {
            demiTours++
          }
          const build = buildRamp(ramp({ radius, rise, sweep: demiTours * Math.PI }))
          rampesVues++
          expect(Math.abs(build.slopeDegrees)).toBeLessThan(RAMP_MAX_SLOPE_DEG)
          expect(build.warnings).toEqual([])
          expect(aucunNaN(build.geometry)).toBe(true)
          expect(build.colliders.length).toBeGreaterThan(0)
        }
      }
    }
    expect(rampesVues).toBe(60)

    // L'extrême nommé par le spec, vérifié nominativement : atrium 12 m,
    // rayon 4,8, plafond 8 m. 8,4 m de montée sur un demi-tour à 4,8 m.
    expect(buildRamp(ramp({ radius: 4.8, rise: 8.4 })).slopeDegrees).toBeLessThan(RAMP_MAX_SLOPE_DEG)
  })

  it('reste sous 40° sur les rampes réellement produites par le domaine', () => {
    // Le contre-champ du test précédent : ce n'est plus la règle rejouée, mais
    // `planBuilding` lui-même qui fournit les rampes.
    let rampesVues = 0
    for (const cfg of [
      config(),
      config({ minAtriumSize: 12, ceilingHeight: 8 }),
      config({ minAtriumSize: 12, ceilingHeight: 20, slabThickness: 1.5 }),
      config({ minAtriumSize: 40, ceilingHeight: 2.5 }),
    ] as MuseumConfig[]) {
      const plan = planBuilding({
        clusters: clusters(8, 7, 6, 5, 4, 4, 4, 4, 4, 4),
        featured: ['acme/c0-0'],
        vault: ['acme/vault-0'],
        config: cfg,
      })
      for (const r of plan.ramps) {
        const build = buildRamp(r)
        rampesVues++
        expect(Math.abs(build.slopeDegrees)).toBeLessThan(RAMP_MAX_SLOPE_DEG)
        expect(build.warnings).toEqual([])
      }
    }
    expect(rampesVues).toBeGreaterThan(4)
  })

  it('signale — sans lever — une rampe trop raide écrite à la main', () => {
    // Balayage réduit sur l'atrium minimal : 4,7 m de montée en 0,3 rad de
    // balayage à 4,8 m de rayon, soit 73°. Injouable, mais construit et dit.
    const raide = ramp({ radius: 4.8, sweep: 0.3 })
    const build = buildRamp(raide)

    expect(build.slopeDegrees).toBeGreaterThan(RAMP_MAX_SLOPE_DEG)
    expect(build.warnings).toHaveLength(1)
    expect(build.warnings[0]).toContain('pente')
    expect(build.warnings[0]).toContain(raide.id)
    // Signalée n'est pas bâclée : la géométrie reste exploitable.
    expect(aucunNaN(build.geometry)).toBe(true)
    expect(build.colliders.length).toBeGreaterThan(0)
  })
})

// ── Continuité ───────────────────────────────────────────────────────────

describe('continuité', () => {
  it('part de baseElevation et arrive à baseElevation + rise', () => {
    const r = ramp({ baseElevation: -4.7 })
    expect(rampSurfacePoint(r, 0).y).toBeCloseTo(r.baseElevation, 9)
    expect(rampSurfacePoint(r, 1).y).toBeCloseTo(r.baseElevation + r.rise, 9)

    const box = buildRamp(r).geometry.boundingBox!
    expect(box.max.y).toBeCloseTo(r.baseElevation + r.rise, 6)
    expect(box.min.y).toBeCloseTo(r.baseElevation - RAMP_DECK_THICKNESS, 6)
  })

  it('monte strictement, sans palier ni marche', () => {
    const r = ramp()
    let precedent = -Infinity
    for (let i = 0; i <= 200; i++) {
      const y = rampSurfacePoint(r, i / 200).y
      expect(y).toBeGreaterThan(precedent)
      precedent = y
    }
  })

  it("chaîne les volées d'un niveau à l'autre sans saut d'altitude", () => {
    const plan = planBuilding({
      clusters: clusters(8, 7, 6, 5, 4, 4, 4),
      featured: [],
      vault: ['acme/v-0'],
      config: config(),
    })
    expect(plan.ramps.length).toBeGreaterThan(1)
    for (let i = 1; i < plan.ramps.length; i++) {
      const bas = plan.ramps[i - 1]
      const haut = plan.ramps[i]
      // L'arrivée de la volée précédente est le départ de la suivante.
      expect(rampSurfacePoint(bas, 1).y).toBeCloseTo(rampSurfacePoint(haut, 0).y, 6)
    }
  })
})

// ── Colliders convexes ───────────────────────────────────────────────────

describe('colliders convexes du tablier', () => {
  it('découpe le balayage par pas de 10°', () => {
    // π rad = 180° ⇒ 18 boîtes. Ni 19 (epsilon de bord), ni un trimesh.
    expect(buildRamp(ramp()).colliders).toHaveLength(18)
    expect(buildRamp(ramp({ sweep: 2 * Math.PI })).colliders).toHaveLength(36)
    expect(buildRamp(ramp({ sweep: 0.05 })).colliders).toHaveLength(1)
  })

  it('ne produit aucune valeur non finie', () => {
    for (const box of buildRamp(ramp({ sweep: -Math.PI, baseElevation: -4.7 })).colliders) {
      for (const v of [
        box.position.x,
        box.position.y,
        box.position.z,
        box.rotation[0],
        box.rotation[1],
        box.rotation[2],
        box.halfExtents.x,
        box.halfExtents.y,
        box.halfExtents.z,
      ]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(box.halfExtents.x).toBeGreaterThan(0)
      expect(box.halfExtents.y).toBeGreaterThan(0)
      expect(box.halfExtents.z).toBeGreaterThan(0)
    }
  })

  it('couvre toute la surface de marche, sans le moindre intervalle à découvert', () => {
    for (const r of [ramp(), ramp({ sweep: -Math.PI }), ramp({ startAngle: 2.4, sweep: 2 * Math.PI })]) {
      const { colliders } = buildRamp(r)
      // 400 pas le long du balayage × 5 positions en travers : bien plus fin
      // que le pas de 10° des boîtes, donc chaque jonction est traversée.
      for (let i = 0; i <= 400; i++) {
        for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) {
          const p = rampSurfacePoint(r, i / 400, k * r.width)
          const meilleure = Math.max(...colliders.map((c) => penetration(c, p)))
          expect(meilleure).toBeGreaterThan(-0.03)
        }
      }
    }
  })

  it('pose la face SUPÉRIEURE des boîtes sur la surface de marche', () => {
    const r = ramp()
    const { colliders } = buildRamp(r)
    for (let i = 0; i <= 200; i++) {
      const p = rampSurfacePoint(r, i / 200)
      // La boîte qui contient le point le plus franchement est celle du
      // segment courant : le point doit y être sur la face du dessus, à
      // quelques millimètres près (le tablier est vrillé, la boîte est plane).
      const box = colliders.reduce((a, b) => (penetration(a, p) >= penetration(b, p) ? a : b))
      expect(Math.abs(toLocal(box, p).y - box.halfExtents.y)).toBeLessThan(0.02)
    }
  })

  it('fait se recouvrir les boîtes voisines, sinon le personnage accroche', () => {
    const r = ramp()
    const { colliders } = buildRamp(r)
    for (let k = 1; k < colliders.length; k++) {
      // Le point exactement à la frontière angulaire des segments k−1 et k.
      // Deux boîtes jointives y auraient une marge nulle, et le personnage
      // accrocherait sur cette arête au flottant près.
      const p = rampSurfacePoint(r, k / colliders.length)
      expect(margeTangentielle(colliders[k - 1], p)).toBeGreaterThan(COLLIDER_OVERLAP)
      expect(margeTangentielle(colliders[k], p)).toBeGreaterThan(COLLIDER_OVERLAP)
    }
  })

  it('recouvre aussi le bord extérieur, le plus exposé aux jonctions', () => {
    const r = ramp()
    const { colliders } = buildRamp(r)
    for (let k = 1; k < colliders.length; k++) {
      const p = rampSurfacePoint(r, k / colliders.length, r.width / 2)
      expect(margeTangentielle(colliders[k - 1], p)).toBeGreaterThan(0)
      expect(margeTangentielle(colliders[k], p)).toBeGreaterThan(0)
    }
  })
})

// ── Garde-corps ──────────────────────────────────────────────────────────

describe('garde-corps', () => {
  it("s'élève de 1,1 m au-dessus de la surface de marche, sur toute la montée", () => {
    const r = ramp({ baseElevation: 4.7 })
    const box = buildRamp(r).railingGeometry.boundingBox!
    expect(box.min.y).toBeCloseTo(r.baseElevation, 6)
    expect(box.max.y).toBeCloseTo(r.baseElevation + r.rise + RAILING_HEIGHT, 6)
  })

  it('borde les DEUX rives : le vide de l\'atrium est des deux côtés', () => {
    // L'hélice est inscrite dans une trémie carrée : le bord intérieur
    // surplombe le vide central, et le bord extérieur ne longe le mur qu'en
    // quatre points. Une seule lisse laisserait une chute possible.
    const r = ramp()
    const { railingGeometry } = buildRamp(r)
    const pos = positionsOf(railingGeometry)
    const rayons = new Set<number>()
    for (let i = 0; i < pos.length; i += 3) {
      rayons.add(Math.round(Math.hypot(pos[i] - r.centre.x, pos[i + 2] - r.centre.z) * 100) / 100)
    }
    const ri = r.radius - r.width / 2
    const ro = r.radius + r.width / 2
    expect(rayons.has(Math.round(ri * 100) / 100)).toBe(true)
    expect(rayons.has(Math.round((ri + RAILING_THICKNESS) * 100) / 100)).toBe(true)
    expect(rayons.has(Math.round((ro - RAILING_THICKNESS) * 100) / 100)).toBe(true)
    expect(rayons.has(Math.round(ro * 100) / 100)).toBe(true)
  })

  it('est solide : deux boîtes par segment, couvrant tout le balayage', () => {
    const r = ramp()
    const { colliders, railingColliders } = buildRamp(r)
    expect(railingColliders).toHaveLength(colliders.length * 2)

    // Un joueur qui longe une rive à hauteur de poitrine rencontre la lisse.
    for (const rive of [-1, 1]) {
      for (let i = 0; i <= 300; i++) {
        const t = i / 300
        const bord = rampSurfacePoint(r, t, (rive * (r.width - RAILING_THICKNESS)) / 2)
        const p = { x: bord.x, y: bord.y + RAILING_HEIGHT / 2, z: bord.z }
        const meilleure = Math.max(...railingColliders.map((c) => penetration(c, p)))
        expect(meilleure).toBeGreaterThan(0)
      }
    }
  })

  it('reste vertical : aucune boîte de lisse n\'est inclinée', () => {
    for (const box of buildRamp(ramp()).railingColliders) {
      expect(box.rotation[0]).toBe(0)
      expect(box.rotation[2]).toBe(0)
    }
  })
})

// ── Entrées aberrantes ───────────────────────────────────────────────────

describe('entrées aberrantes', () => {
  it('ne lève jamais et ne renvoie jamais de NaN', () => {
    const cas: Ramp[] = [
      ramp({ sweep: 0 }),
      ramp({ radius: 0 }),
      ramp({ radius: -3 }),
      ramp({ width: 0 }),
      ramp({ rise: 0 }),
      ramp({ rise: -4.7 }),
      ramp({ radius: 1, width: 4 }), // bord intérieur négatif
      ramp({ sweep: Number.NaN }),
      ramp({ baseElevation: Number.POSITIVE_INFINITY }),
    ]
    for (const r of cas) {
      const build = buildRamp(r)
      expect(aucunNaN(build.geometry)).toBe(true)
      expect(aucunNaN(build.railingGeometry)).toBe(true)
      expect(Number.isFinite(build.slopeDegrees)).toBe(true)
      for (const box of [...build.colliders, ...build.railingColliders]) {
        expect(Number.isFinite(box.position.y)).toBe(true)
        expect(Number.isFinite(box.rotation[1])).toBe(true)
      }
    }
  })

  it('rend une construction vide et un avertissement sur une rampe dégénérée', () => {
    for (const r of [ramp({ sweep: 0 }), ramp({ radius: 0 }), ramp({ sweep: Number.NaN })]) {
      const build = buildRamp(r)
      // Vide, mais pas nu : les attributs existent, de longueur nulle. Un
      // `BufferGeometry` sans position ferait planter le rendu au lieu de
      // sauter une rampe.
      expect(build.geometry.getAttribute('position').count).toBe(0)
      expect(build.geometry.getIndex()!.array).toBeInstanceOf(Uint32Array)
      expect(build.colliders).toEqual([])
      expect(build.railingColliders).toEqual([])
      expect(build.warnings).toHaveLength(1)
    }
  })

  it('ramène le bord intérieur au-dessus de zéro plutôt que de replier la surface', () => {
    const build = buildRamp(ramp({ radius: 1, width: 4 }))
    expect(build.warnings.some((w) => w.includes('bord intérieur'))).toBe(true)
    expect(signedVolume(build.geometry)).toBeGreaterThan(0)
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

const MUSEUM: Museum = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/museum.json'), 'utf8'),
)

/**
 * Rien ici n'est écrit en dur : ni le rayon, ni la pente, ni le nombre de
 * boîtes. `museum.json` est REGÉNÉRÉ à chaque `npm run derive` et son atrium
 * change avec le corpus GitHub — un test qui attendrait « 9,6° » deviendrait
 * rouge sans qu'aucun code ne bouge. Ce sont les invariants qu'on vérifie.
 */
describe('les rampes réelles de public/data/museum.json', () => {
  const museum = MUSEUM

  it('en compte une par paire de niveaux consécutifs', () => {
    expect(museum.ramps.length).toBeGreaterThan(0)
    expect(museum.ramps).toHaveLength(museum.floors.length - 1)
  })

  it.each(MUSEUM.ramps.map((r) => [r.id, r] as const))(
    '%s : géométrie pleine, pente tenable, collision continue',
    (_id: string, r: Ramp) => {
    const build = buildRamp(r)

    expect(build.warnings).toEqual([])
    expect(build.slopeDegrees).toBeLessThan(RAMP_MAX_SLOPE_DEG)
    expect(build.slopeDegrees).toBeGreaterThan(0)

    // Géométrie non vide, sans NaN, indexée.
    expect(build.geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(build.railingGeometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(aucunNaN(build.geometry)).toBe(true)
    expect(aucunNaN(build.railingGeometry)).toBe(true)
    expect(build.geometry.getIndex()!.array).toBeInstanceOf(Uint32Array)
    expect(signedVolume(build.geometry)).toBeGreaterThan(0)

    // La volée relie bien les deux dalles qu'elle annonce.
    const depart = museum.floors.find((f) => f.id === r.fromFloor)!
    const arrivee = museum.floors.find((f) => f.id === r.toFloor)!
    expect(rampSurfacePoint(r, 0).y).toBeCloseTo(depart.elevation, 6)
    expect(rampSurfacePoint(r, 1).y).toBeCloseTo(arrivee.elevation, 6)

    // L'hélice tient dans le vide de l'atrium.
    const box = build.geometry.boundingBox!
    expect(box.min.x).toBeGreaterThanOrEqual(museum.atrium.x)
    expect(box.max.x).toBeLessThanOrEqual(museum.atrium.x + museum.atrium.width)
    expect(box.min.z).toBeGreaterThanOrEqual(museum.atrium.z)
    expect(box.max.z).toBeLessThanOrEqual(museum.atrium.z + museum.atrium.depth)

    // Collision : un cuboid par pas de 10° de balayage, et aucun point de
    // marche à découvert sur toute la largeur du tablier.
    expect(build.colliders).toHaveLength(Math.round(Math.abs(r.sweep) / COLLIDER_STEP))
    for (let i = 0; i <= 300; i++) {
      for (const k of [-0.5, 0, 0.5]) {
        const p = rampSurfacePoint(r, i / 300, k * r.width)
        expect(Math.max(...build.colliders.map((c) => penetration(c, p)))).toBeGreaterThan(-0.03)
      }
    }

    // Garde-corps : solide des deux côtés, à hauteur de poitrine.
    expect(build.railingColliders).toHaveLength(build.colliders.length * 2)
    for (const rive of [-1, 1]) {
      for (let i = 0; i <= 200; i++) {
        const bord = rampSurfacePoint(r, i / 200, (rive * (r.width - RAILING_THICKNESS)) / 2)
        const p = { x: bord.x, y: bord.y + RAILING_HEIGHT / 2, z: bord.z }
        expect(Math.max(...build.railingColliders.map((c) => penetration(c, p)))).toBeGreaterThan(0)
      }
    }
    },
  )
})
