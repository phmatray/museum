/**
 * LOT 4 — Tests de l'éclairage multi-sources (spec §9.4).
 *
 * Aucun canvas : toute la règle d'allocation est une fonction pure de
 * `lighting.ts`, et c'est délibéré — ce qu'elle décide ne se juge pas sur une
 * capture d'écran. Une lumière qui saute d'un créneau à l'autre en marchant est
 * invisible en photo et insupportable en marchant ; un plafond de douze
 * lumières dépassé d'une seule ne se voit nulle part et coûte une
 * recompilation de tous les shaders du bâtiment.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. LE PLAFOND DU §9.4. Douze lumières, quel que soit le nombre de salles.
 *     C'est la seule promesse que le lot fait au budget, et elle doit tenir
 *     aussi bien sur le musée réel que sur un bâtiment de cent salles ;
 *  2. LA STABILITÉ DES CRÉNEAUX. Une salle qui reste retenue ne change pas de
 *     créneau — sans quoi la lumière qu'elle libère saute à l'autre bout du
 *     bâtiment en une image ;
 *  3. LA PRIORITÉ DE LA SALLE COURANTE, qui ne doit jamais s'éteindre sous les
 *     pieds du visiteur au profit d'une petite salle voisine plus « proche » ;
 *  4. LA DÉCROISSANCE DU PUITS, qui est ce qui fait lire que le rez-de-chaussée
 *     est plus sombre que le dernier étage ;
 *  5. LE DÉTERMINISME : deux appels identiques rendent le même ordre.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Floor, Museum, Rect, Room, Vec3 } from '../../domain/types'
import {
  BUDGET_LUMIERES,
  BUDGET_OMBRES,
  BUDGET_PUITS,
  BUDGET_SALLES,
  ECLAIREMENT_SALLE,
  LUMIERES_PERMANENTES,
  PUITS_HAUT,
  RAYON_SALLE_MAX,
  RETRAIT_PLAFOND,
  affecterCreneaux,
  choisirLumieresDePuits,
  classerLumieresDeSalles,
  creneauxDeLumieres,
  intensiteDuPuits,
  lumiereDeSalle,
  lumieresDePuits,
  lumieresDeSalles,
  reaffectationNecessaire,
} from '../lighting'

// ── Fabriques ────────────────────────────────────────────────────────────

function rect(x: number, z: number, width: number, depth: number): Rect {
  return { x, z, width, depth }
}

function salle(id: string, footprint: Rect): Room {
  return {
    id,
    name: id,
    side: 'north',
    footprint,
    theme: 'classic',
    walls: [],
    topics: [],
    keys: [],
  }
}

function niveau(over: Partial<Floor> & { id: string; level: number }): Floor {
  return {
    name: over.id,
    elevation: over.level * 4.7,
    ceilingHeight: 4.3,
    rooms: [],
    slabHoles: [],
    footprint: rect(-15, -15, 30, 30),
    ...over,
  }
}

function musee(floors: Floor[]): Museum {
  // Seuls `floors` compte pour ce module ; le reste satisfait le type.
  return { floors } as unknown as Museum
}

function point(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

// ── Le plafond du §9.4 ───────────────────────────────────────────────────

describe('budget de lumières', () => {
  it('additionne exactement les douze du §9.4', () => {
    expect(LUMIERES_PERMANENTES + BUDGET_SALLES + BUDGET_PUITS).toBe(
      BUDGET_LUMIERES,
    )
  })

  it('plafonne à deux shadow maps', () => {
    expect(BUDGET_OMBRES).toBe(2)
  })

  it('ne dépasse jamais douze, même à cent salles', () => {
    const rooms = Array.from({ length: 100 }, (_, i) =>
      salle(`salle-${i}`, rect(i, 0, 6, 6)),
    )
    const grand = musee([
      niveau({ id: 'a', level: 0, rooms, slabHoles: [rect(-6, -6, 12, 12)] }),
      niveau({ id: 'b', level: 1, rooms, slabHoles: [rect(-6, -6, 12, 12)] }),
      niveau({ id: 'c', level: 2, rooms, slabHoles: [rect(-6, -6, 12, 12)] }),
      niveau({ id: 'd', level: 3, rooms, slabHoles: [rect(-6, -6, 12, 12)] }),
      niveau({ id: 'e', level: 4, rooms, slabHoles: [rect(-6, -6, 12, 12)] }),
    ])
    const creneaux = creneauxDeLumieres(grand)
    expect(creneaux.total).toBe(BUDGET_LUMIERES)
    expect(creneaux.salles).toBe(BUDGET_SALLES)
    expect(creneaux.puits).toBe(BUDGET_PUITS)
  })

  it('ne monte pas de créneau qu\'un petit bâtiment ne peut pas remplir', () => {
    const minuscule = musee([
      niveau({ id: 'a', level: 0, rooms: [salle('unique', rect(0, 0, 8, 8))] }),
    ])
    const creneaux = creneauxDeLumieres(minuscule)
    // Une salle, aucune trémie : une seule lumière allouée en tout.
    expect(creneaux.salles).toBe(1)
    expect(creneaux.puits).toBe(0)
    expect(creneaux.total).toBe(LUMIERES_PERMANENTES + 1)
  })
})

// ── Géométrie d'un plafonnier ────────────────────────────────────────────

describe('lumiereDeSalle', () => {
  it('se pose au centre de la salle, sous le plafond', () => {
    const lumiere = lumiereDeSalle(salle('s', rect(4, -10, 12, 6)), 4.7, 4.3)
    expect(lumiere.position[0]).toBe(10)
    expect(lumiere.position[2]).toBe(-7)
    expect(lumiere.position[1]).toBeCloseTo(4.7 + 4.3 - RETRAIT_PLAFOND, 6)
  })

  it('plafonne le rayon utile : une galerie de 30 m ne brûle pas son centre', () => {
    const galerie = lumiereDeSalle(salle('g', rect(-15, 6, 30, 9)), 0, 4.3)
    expect(galerie.intensity).toBeCloseTo(
      ECLAIREMENT_SALLE * RAYON_SALLE_MAX * RAYON_SALLE_MAX,
      6,
    )
  })

  it('est déterministe : deux appels rendent le même flottant', () => {
    const a = lumiereDeSalle(salle('s', rect(1, 2, 9, 7)), 4.7, 4.3)
    const b = lumiereDeSalle(salle('s', rect(1, 2, 9, 7)), 4.7, 4.3)
    expect(a).toEqual(b)
  })
})

// ── Classement ───────────────────────────────────────────────────────────

describe('classerLumieresDeSalles', () => {
  const bati = musee([
    niveau({
      id: 'rdc',
      level: 0,
      rooms: [
        salle('grande', rect(-15, -15, 30, 9)),
        salle('petite', rect(6, -6, 6, 6)),
      ],
    }),
    niveau({
      id: 'etage',
      level: 1,
      rooms: [salle('haut', rect(-15, -15, 12, 9))],
    }),
  ])
  const toutes = lumieresDeSalles(bati)

  it('sert la salle courante avant toute autre, même plus lointaine', () => {
    // L'œil est dans « grande », mais collé à la cloison de « petite » : le
    // centre de la petite salle est plus près que celui de la grande.
    const oeil = point(9, 1.7, -6.5)
    const classees = classerLumieresDeSalles(toutes, oeil, 'grande', 0)
    expect(classees[0].roomId).toBe('grande')
  })

  it('sans salle courante, classe par distance', () => {
    const oeil = point(9, 1.7, -3)
    const classees = classerLumieresDeSalles(toutes, oeil, null, 0)
    expect(classees[0].roomId).toBe('petite')
  })

  it('pénalise les salles d\'un autre niveau, sans les exclure', () => {
    // Presque à l'aplomb de « haut », donc très proche en distance brute.
    const oeil = point(-9, 1.7, -10)
    const sansNiveau = classerLumieresDeSalles(toutes, oeil, null, null)
    const avecNiveau = classerLumieresDeSalles(toutes, oeil, null, 0)
    expect(sansNiveau[0].roomId).toBe('haut')
    expect(avecNiveau[0].roomId).toBe('grande')
    // Pénalisée, pas exclue : elle reste dans la liste.
    expect(avecNiveau.map((l) => l.roomId)).toContain('haut')
  })

  it('est déterministe', () => {
    const oeil = point(0, 1.7, 0)
    const a = classerLumieresDeSalles(toutes, oeil, null, 0).map((l) => l.roomId)
    const b = classerLumieresDeSalles(toutes, oeil, null, 0).map((l) => l.roomId)
    expect(a).toEqual(b)
  })

  it('ne modifie pas le catalogue qu\'on lui passe', () => {
    const copie = toutes.map((l) => l.roomId)
    classerLumieresDeSalles(toutes, point(5, 1, 5), 'petite', 0)
    expect(toutes.map((l) => l.roomId)).toEqual(copie)
  })
})

// ── Stabilité des créneaux ───────────────────────────────────────────────

describe('affecterCreneaux', () => {
  it('garde chaque salle dans le créneau qu\'elle occupait', () => {
    const precedent = ['a', 'b', 'c']
    const creneaux = affecterCreneaux(precedent, [
      { roomId: 'c' },
      { roomId: 'a' },
      { roomId: 'b' },
    ])
    expect(creneaux.map((c) => c?.roomId)).toEqual(['a', 'b', 'c'])
  })

  it('ne réutilise qu\'un créneau réellement libéré', () => {
    const creneaux = affecterCreneaux(
      ['a', 'b', 'c'],
      [{ roomId: 'a' }, { roomId: 'z' }, { roomId: 'c' }],
    )
    // « b » est partie : « z » prend SA place, et personne d'autre ne bouge.
    expect(creneaux.map((c) => c?.roomId)).toEqual(['a', 'z', 'c'])
  })

  it('rend toujours autant de créneaux qu\'il en existe, éteints compris', () => {
    const creneaux = affecterCreneaux([null, null, null, null], [{ roomId: 'a' }])
    expect(creneaux).toHaveLength(4)
    expect(creneaux.filter((c) => c !== null)).toHaveLength(1)
  })

  it('ignore les salles surnuméraires plutôt que d\'allonger la liste', () => {
    const creneaux = affecterCreneaux(
      [null, null],
      [{ roomId: 'a' }, { roomId: 'b' }, { roomId: 'c' }],
    )
    expect(creneaux).toHaveLength(2)
  })
})

// ── Puits de lumière ─────────────────────────────────────────────────────

describe('puits de lumière', () => {
  const bati = musee([
    niveau({ id: 'reserve', level: -1 }),
    niveau({ id: 'rdc', level: 0, slabHoles: [rect(-6, -6, 12, 12)] }),
    niveau({ id: 'e1', level: 1, slabHoles: [rect(-6, -6, 12, 12)] }),
    niveau({ id: 'e2', level: 2, slabHoles: [rect(-6, -6, 12, 12)] }),
  ])

  it('n\'allume rien dans un niveau sans trémie', () => {
    const puits = lumieresDePuits(bati)
    expect(puits.map((p) => p.level)).toEqual([0, 1, 2])
  })

  it('se centre sur la trémie', () => {
    const [premier] = lumieresDePuits(bati)
    expect(premier.position[0]).toBe(0)
    expect(premier.position[2]).toBe(0)
  })

  it('décroît franchement avec la profondeur', () => {
    const puits = lumieresDePuits(bati)
    for (let i = 1; i < puits.length; i++) {
      expect(puits[i].intensity).toBeGreaterThan(puits[i - 1].intensity)
    }
    // Le rez-de-chaussée doit être NETTEMENT plus sombre que le dernier étage :
    // c'est la lecture que le §9.4 demande, pas une nuance.
    expect(puits[0].intensity).toBeLessThan(puits[2].intensity * 0.6)
  })

  it('ne descend jamais à zéro : sombre est une ambiance, éteint est un bug', () => {
    expect(intensiteDuPuits(-40)).toBeGreaterThan(0)
  })

  it('plafonne au-dessus de la toiture', () => {
    expect(intensiteDuPuits(PUITS_HAUT + 50)).toBe(intensiteDuPuits(PUITS_HAUT))
  })

  it('retient une fenêtre CONTIGUË de niveaux autour du visiteur', () => {
    const toutes = Array.from({ length: 6 }, (_, i) => ({
      level: i,
      position: [0, i * 4.7, 0] as [number, number, number],
      intensity: 1,
      distance: 17,
    }))
    const choisis = choisirLumieresDePuits(toutes, 4.7 * 3, 3).map((p) => p.level)
    expect(choisis).toEqual([2, 3, 4])
  })

  it('recale la fenêtre dans les bornes plutôt que de rendre moins de sources', () => {
    const toutes = Array.from({ length: 6 }, (_, i) => ({
      level: i,
      position: [0, i * 4.7, 0] as [number, number, number],
      intensity: 1,
      distance: 17,
    }))
    expect(choisirLumieresDePuits(toutes, -100, 3).map((p) => p.level)).toEqual([
      0, 1, 2,
    ])
    expect(choisirLumieresDePuits(toutes, 1000, 3).map((p) => p.level)).toEqual([
      3, 4, 5,
    ])
  })
})

// ── Réaffectation ────────────────────────────────────────────────────────

describe('reaffectationNecessaire', () => {
  const etat = (
    oeil: Vec3,
    salle: string | null = 'a',
    niveau: number | null = 0,
  ) => ({ oeil, salle, niveau })

  it('refait le calcul à la première image', () => {
    expect(reaffectationNecessaire(null, etat(point(0, 0, 0)))).toBe(true)
  })

  it('ne le refait pas pour un pas de quelques centimètres', () => {
    expect(
      reaffectationNecessaire(etat(point(0, 0, 0)), etat(point(0.1, 0, 0.1))),
    ).toBe(false)
  })

  it('le refait dès que le visiteur change de salle, même sans bouger', () => {
    expect(
      reaffectationNecessaire(etat(point(0, 0, 0)), etat(point(0, 0, 0), 'b')),
    ).toBe(true)
  })

  it('le refait quand le niveau du registre change, même sans bouger', () => {
    // Le registre de culling a UNE IMAGE DE RETARD sur une téléportation : sans
    // ce déclencheur, l'allocation resterait figée sur le niveau d'avant.
    expect(
      reaffectationNecessaire(
        etat(point(0, 0, 0), 'a', 0),
        etat(point(0, 0, 0), 'a', 1),
      ),
    ).toBe(true)
  })

  it('le refait après un déplacement franc', () => {
    expect(
      reaffectationNecessaire(etat(point(0, 0, 0)), etat(point(0, 0, 3))),
    ).toBe(true)
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

describe('musée réel', () => {
  const museum: Museum = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/data/museum.json'), 'utf-8'),
  )

  it('tient le plafond de douze lumières', () => {
    expect(creneauxDeLumieres(museum).total).toBeLessThanOrEqual(BUDGET_LUMIERES)
  })

  it('éclaire une salle par créneau, sans doublon, où que soit le visiteur', () => {
    const creneaux = creneauxDeLumieres(museum)
    const toutes = lumieresDeSalles(museum)
    for (const floor of museum.floors) {
      for (const room of floor.rooms) {
        const oeil = point(
          room.footprint.x + room.footprint.width / 2,
          floor.elevation + 1.7,
          room.footprint.z + room.footprint.depth / 2,
        )
        const retenues = affecterCreneaux(
          Array.from({ length: creneaux.salles }, () => null),
          classerLumieresDeSalles(toutes, oeil, room.id, floor.level).slice(
            0,
            creneaux.salles,
          ),
        )
        const ids = retenues.map((r) => r?.roomId).filter((id) => id !== undefined)
        expect(ids).toContain(room.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('rend une position et une intensité finies pour chaque salle', () => {
    for (const lumiere of lumieresDeSalles(museum)) {
      expect(Number.isFinite(lumiere.intensity)).toBe(true)
      expect(lumiere.intensity).toBeGreaterThan(0)
      for (const c of lumiere.position) expect(Number.isFinite(c)).toBe(true)
    }
  })
})
