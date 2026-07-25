/**
 * LOT 3 — Tests du culling par étage (spec §9.3).
 *
 * Ce que ces tests protègent n'est pas le gain de draw calls — celui-là se
 * mesure dans le navigateur — mais les trois façons dont un culling peut être
 * FAUX sans qu'on le voie sur une capture d'écran :
 *
 *   1. il clignote. Le niveau courant oscille à la frontière d'un étage et tout
 *      le contenu de deux plateaux apparaît et disparaît au rythme du pas. Une
 *      photo ne le montre pas ; les tests d'hystérésis ci-dessous, si.
 *   2. il escamote. Une boîte englobante trop petite fait sauter un plateau
 *      encore visible, ou fait disparaître l'ombre qu'il projette dans l'atrium.
 *      On le vérifie en rejouant la géométrie réelle du bâtiment.
 *   3. il ne cache rien. Une portée trop large laisserait passer tout le musée,
 *      ce qui « marche » parfaitement et ne tient aucun budget.
 *
 * Le dernier bloc porte sur `public/data/museum.json`, les quatre niveaux et
 * les cent accrochages réels : c'est là que se prennent les cas de bord qu'un
 * bâtiment fabriqué à la main ne produira jamais.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CARTEL_MAX_DISTANCE } from '../cartels'
import {
  CONTENT_LEVEL_RANGE,
  FLOOR_BOX_MARGIN,
  LEVEL_HYSTERESIS,
  contentVisible,
  floorBox,
  landings,
  levelAt,
  shadowSweptBox,
  trackLevel,
} from '../culling'
import type { Box, Landing } from '../culling'
import type { Floor, Museum, Rect } from '../types'

// ── Bâtiment de laboratoire ──────────────────────────────────────────────

const HAUTEUR = 4.7
const DALLE = 0.4
const PAS = HAUTEUR + DALLE

/** Paliers réguliers, du niveau -1 au niveau 2, comme le musée réel. */
const PALIERS: Landing[] = [
  { level: -1, elevation: -PAS },
  { level: 0, elevation: 0 },
  { level: 1, elevation: PAS },
  { level: 2, elevation: 2 * PAS },
]

function rect(x: number, z: number, width: number, depth: number): Rect {
  return { x, z, width, depth }
}

function plateau(level: number, footprint: Rect): Floor {
  return {
    id: `n${level}`,
    name: `niveau ${level}`,
    level,
    elevation: level * PAS,
    ceilingHeight: HAUTEUR,
    rooms: [],
    slabHoles: [],
    footprint,
  }
}

// ── Le niveau courant ────────────────────────────────────────────────────

describe('levelAt', () => {
  it('rend le plancher le plus haut sous le point', () => {
    expect(levelAt(PALIERS, 0)).toBe(0)
    expect(levelAt(PALIERS, 1.6)).toBe(0)
    expect(levelAt(PALIERS, PAS + 1.6)).toBe(1)
    expect(levelAt(PALIERS, 2 * PAS + 4)).toBe(2)
  })

  it('rattache au niveau le plus bas ce qui est sous le bâtiment', () => {
    expect(levelAt(PALIERS, -100)).toBe(-1)
  })

  it('ne dépend pas de l’ordre d’écriture des paliers', () => {
    const melange = [PALIERS[2], PALIERS[0], PALIERS[3], PALIERS[1]]
    const trie = [...melange].sort((a, b) => a.elevation - b.elevation)
    expect(levelAt(trie, PAS + 2)).toBe(1)
  })
})

describe('trackLevel', () => {
  it('sans précédent, rend le niveau brut', () => {
    expect(trackLevel(PALIERS, PAS + 1.6, null)).toBe(1)
  })

  it('ne monte qu’après avoir franchi la marge', () => {
    // Juste au-dessus du plancher de l'étage : brut = 1, mais on n'y est pas.
    expect(trackLevel(PALIERS, PAS + 0.1, 0)).toBe(0)
    expect(trackLevel(PALIERS, PAS + LEVEL_HYSTERESIS - 1e-6, 0)).toBe(0)
    expect(trackLevel(PALIERS, PAS + LEVEL_HYSTERESIS, 0)).toBe(1)
  })

  it('ne descend qu’après être franchement passé sous le plancher quitté', () => {
    expect(trackLevel(PALIERS, -0.1, 0)).toBe(0)
    expect(trackLevel(PALIERS, -LEVEL_HYSTERESIS + 1e-6, 0)).toBe(0)
    expect(trackLevel(PALIERS, -LEVEL_HYSTERESIS, 0)).toBe(-1)
  })

  it('ne peut pas osciller : les deux seuils sont disjoints', () => {
    // Une rampe parcourue lentement, avec le bruit du contrôleur cinématique.
    // Sans hystérésis, chaque aller-retour de deux centimètres autour du
    // plancher changerait de niveau — et ferait clignoter deux plateaux.
    let niveau: number | null = 0
    let basculements = 0
    for (let i = 0; i < 400; i++) {
      const y = PAS + 0.02 * Math.sin(i)
      const suivant = trackLevel(PALIERS, y, niveau)
      if (suivant !== niveau) basculements++
      niveau = suivant
    }
    expect(basculements).toBe(0)
    expect(niveau).toBe(0)
  })

  it('bascule une seule fois sur une montée franche puis une redescente', () => {
    let niveau: number | null = 0
    const vus: number[] = []
    // Montée continue jusqu'à l'étage, puis retour au rez-de-chaussée.
    for (let y = 0; y <= PAS + 2; y += 0.05) {
      niveau = trackLevel(PALIERS, y, niveau)
      vus.push(niveau)
    }
    for (let y = PAS + 2; y >= -0.5; y -= 0.05) {
      niveau = trackLevel(PALIERS, y, niveau)
      vus.push(niveau)
    }
    const transitions = vus.filter((n, i) => i > 0 && n !== vus[i - 1])
    expect(transitions).toEqual([1, 0])
  })

  it('accepte un saut de plusieurs niveaux d’un coup', () => {
    // La visite guidée téléporte la caméra ; `survol()` la sort du bâtiment.
    expect(trackLevel(PALIERS, 2 * PAS + 1.6, -1)).toBe(2)
    expect(trackLevel(PALIERS, -PAS + 1.6, 2)).toBe(-1)
  })

  it('est déterministe : même altitude et même précédent, même réponse', () => {
    for (let i = 0; i < 50; i++) {
      expect(trackLevel(PALIERS, PAS + 0.3, 0)).toBe(0)
      expect(trackLevel(PALIERS, PAS + 1.2, 0)).toBe(1)
    }
  })
})

describe('contentVisible', () => {
  it('garde le contenu jusqu’à deux niveaux d’écart, dans les deux sens', () => {
    expect(contentVisible(0, 0)).toBe(true)
    expect(contentVisible(0, 2)).toBe(true)
    expect(contentVisible(0, -2)).toBe(true)
    expect(contentVisible(2, 0)).toBe(true)
  })

  it('coupe au-delà', () => {
    expect(contentVisible(0, 3)).toBe(false)
    expect(contentVisible(3, 0)).toBe(false)
    expect(contentVisible(-1, 3)).toBe(false)
  })

  it('respecte une portée explicite', () => {
    expect(contentVisible(0, 1, 0)).toBe(false)
    expect(contentVisible(0, 0, 0)).toBe(true)
  })
})

// ── Boîtes ───────────────────────────────────────────────────────────────

function contient(box: Box, x: number, y: number, z: number): boolean {
  return (
    x >= box.minX &&
    x <= box.maxX &&
    y >= box.minY &&
    y <= box.maxY &&
    z >= box.minZ &&
    z <= box.maxZ
  )
}

describe('floorBox', () => {
  const etage = plateau(1, rect(-20, -15, 40, 30))

  it('descend sous la dalle et monte jusqu’au plafond', () => {
    const box = floorBox(etage, { slabThickness: DALLE })
    expect(box.minY).toBeCloseTo(PAS - DALLE - FLOOR_BOX_MARGIN, 6)
    expect(box.maxY).toBeCloseTo(PAS + HAUTEUR + FLOOR_BOX_MARGIN, 6)
  })

  it('couvre l’emprise, marge comprise', () => {
    const box = floorBox(etage, { slabThickness: DALLE })
    expect(box.minX).toBeCloseTo(-20 - FLOOR_BOX_MARGIN, 6)
    expect(box.maxX).toBeCloseTo(20 + FLOOR_BOX_MARGIN, 6)
    expect(box.minZ).toBeCloseTo(-15 - FLOOR_BOX_MARGIN, 6)
    expect(box.maxZ).toBeCloseTo(15 + FLOOR_BOX_MARGIN, 6)
  })

  it('monte de l’épaisseur de la toiture au dernier niveau', () => {
    const nu = floorBox(etage, { slabThickness: DALLE })
    const couvert = floorBox(etage, { slabThickness: DALLE, roofThickness: 0.3 })
    expect(couvert.maxY - nu.maxY).toBeCloseTo(0.3, 6)
  })
})

describe('shadowSweptBox', () => {
  // Soleil en +x/+z : les ombres partent vers -x/-z.
  const drift = { x: 0.25, z: 0.4 }
  const box: Box = { minX: -5, minY: 10, minZ: -5, maxX: 5, maxY: 14, maxZ: 5 }

  it('descend jusqu’au sol du bâtiment', () => {
    expect(shadowSweptBox(box, 0, drift).minY).toBe(0)
  })

  it('contient l’ombre du coin le plus haut', () => {
    const balayee = shadowSweptBox(box, 0, drift)
    // Ombre du sommet (minX, maxY, minZ) projetée sur y = 0.
    const chute = box.maxY
    expect(contient(balayee, box.minX - drift.x * chute, 0, box.minZ - drift.z * chute)).toBe(
      true,
    )
  })

  it('ne rogne jamais la boîte d’origine', () => {
    const balayee = shadowSweptBox(box, 0, drift)
    expect(balayee.minX).toBeLessThanOrEqual(box.minX)
    expect(balayee.maxX).toBeGreaterThanOrEqual(box.maxX)
    expect(balayee.minZ).toBeLessThanOrEqual(box.minZ)
    expect(balayee.maxZ).toBeGreaterThanOrEqual(box.maxZ)
  })

  it('s’étend du bon côté quand le soleil change de quadrant', () => {
    const autre = shadowSweptBox(box, 0, { x: -0.25, z: -0.4 })
    expect(autre.maxX).toBeGreaterThan(box.maxX)
    expect(autre.minX).toBe(box.minX)
    expect(autre.maxZ).toBeGreaterThan(box.maxZ)
  })

  it('ne fait rien pour un plateau déjà au sol', () => {
    const auSol: Box = { ...box, minY: 0, maxY: 0 }
    expect(shadowSweptBox(auSol, 0, drift)).toEqual(auSol)
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

describe('sur le musée réel (public/data/museum.json)', () => {
  const museum = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/data/museum.json'), 'utf8'),
  ) as Museum

  const paliers = landings(museum)
  const epaisseur = museum.config.building.slabThickness

  it('a des paliers triés et distincts', () => {
    for (let i = 1; i < paliers.length; i++) {
      expect(paliers[i].elevation).toBeGreaterThan(paliers[i - 1].elevation)
      expect(paliers[i].level).toBeGreaterThan(paliers[i - 1].level)
    }
  })

  it('rattache chaque niveau à lui-même à hauteur d’œil', () => {
    for (const floor of museum.floors) {
      expect(trackLevel(paliers, floor.elevation + 1.6, null)).toBe(floor.level)
    }
  })

  it('la marge d’hystérésis reste bien en deçà d’une hauteur d’étage', () => {
    for (let i = 1; i < paliers.length; i++) {
      const marche = paliers[i].elevation - paliers[i - 1].elevation
      expect(LEVEL_HYSTERESIS).toBeLessThan(marche / 2)
    }
  })

  it('la boîte d’un plateau contient tous ses murs et tous ses accrochages', () => {
    for (const floor of museum.floors) {
      const box = floorBox(floor, { slabThickness: epaisseur })
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          expect(contient(box, wall.a.x, floor.elevation, wall.a.z)).toBe(true)
          expect(contient(box, wall.b.x, floor.elevation + wall.height, wall.b.z)).toBe(true)
          for (const placement of wall.placements) {
            // Le haut du cadre, le point le plus élevé d'un accrochage.
            const sommet = floor.elevation + placement.centerHeight + placement.height / 2
            expect(sommet).toBeLessThanOrEqual(box.maxY)
          }
        }
      }
    }
  })

  it('les boîtes de deux plateaux ne se recouvrent qu’à la marge', () => {
    // Deux plateaux qui se chevauchent verticalement rendraient le test de
    // frustum inutile : ils entreraient et sortiraient du champ ensemble.
    const boites = museum.floors
      .map((floor) => floorBox(floor, { slabThickness: epaisseur }))
      .sort((a, b) => a.minY - b.minY)
    for (let i = 1; i < boites.length; i++) {
      const recouvrement = boites[i - 1].maxY - boites[i].minY
      expect(recouvrement).toBeLessThanOrEqual(2 * FLOOR_BOX_MARGIN + 1e-9)
    }
  })

  it('les cartels sont déjà hors de portée au-delà de deux niveaux (§9.3)', () => {
    // La couche de cartels n'est pas découpée par étage : elle est UNE pour
    // tout le bâtiment, et sa sélection coupe à six mètres. Ce test vérifie que
    // ce seuil est STRICTEMENT plus sévère que la règle des deux niveaux —
    // sinon il faudrait un pool par plateau.
    for (const ici of museum.floors) {
      // Tant que le suivi le déclare à ce niveau, l'œil du visiteur reste dans
      // cette fourchette : de la marge sous son plancher au plancher suivant
      // plus la même marge.
      const suivant = museum.floors.find((f) => f.level === ici.level + 1)
      const oeilBas = ici.elevation - LEVEL_HYSTERESIS
      const oeilHaut = (suivant?.elevation ?? ici.elevation + ici.ceilingHeight) + LEVEL_HYSTERESIS

      for (const ailleurs of museum.floors) {
        if (Math.abs(ailleurs.level - ici.level) <= CONTENT_LEVEL_RANGE) continue
        const basCartel = ailleurs.elevation
        const hautCartel = ailleurs.elevation + ailleurs.ceilingHeight
        const ecart =
          basCartel > oeilHaut ? basCartel - oeilHaut : oeilBas - hautCartel
        expect(ecart).toBeGreaterThan(CARTEL_MAX_DISTANCE)
      }
    }
  })
})
