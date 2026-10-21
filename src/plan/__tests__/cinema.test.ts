/**
 * Le cinéma du sous-sol : ses gradins tombent juste sur les marches des allées,
 * ses fauteuils tiennent dans leur bloc, l'écran, les rideaux, les lumières et
 * la cabine sont dans la salle, sous le plafond.
 */
import { describe, expect, it } from 'vitest'

import {
  AFFICHES, APPLIQUES, dansLeFaisceau, MEUBLES_CABINE, PORTE_CABINE, SALLE_CABINE, BLOC_GRADINS, COMPTOIR, FOYER, CABINE, TETE_ASSISE, solLeLongDesMurs, siegeVise, COTE_PROMENOIR, ECRAN, ENCEINTES, FAUTEUIL, GRADINS, LUMIERES_MARCHES, PLAFOND, PROMENOIR, RIDEAUX,
  SALLE, SCENE, SIEGES, SIEGES_LIBRES, SOL, SPECTATEURS, SPOTS, TRAVERSE, VOLEES_CINEMA,
} from '../cinema'
import { guardrails } from '../geometry'
import { MUSEE } from '../musee'
import { contains, flightElevation } from '../rules'

const cinema = MUSEE.levels.find((l) => l.id === -1)!.rooms.find((r) => r.id === 'cinema')!

describe('le cinéma', () => {
  it('est la salle du plan, ses volées et son promenoir aussi', () => {
    expect(cinema).toMatchObject(SALLE)
    for (const f of VOLEES_CINEMA) expect(MUSEE.flights).toContainEqual(f)
    expect(MUSEE.landings).toContainEqual(PROMENOIR)
    expect(COTE_PROMENOIR).toBeCloseTo(-2.55, 6)
    // 2,25 m sous la dalle du rez-de-chaussée : la règle de hauteur libre en demande 2,20.
    expect(PLAFOND - COTE_PROMENOIR).toBeGreaterThanOrEqual(2.2)
  })

  it('meuble le foyer sans couper le chemin de l’escalier à la porte de la salle', () => {
    const porte = MUSEE.levels.find((l) => l.id === -1)!.openings.find((o) => o.b === 'cinema')!
    // Le chemin de l'arrivée (17,5 ; 12) à la porte (16 ; 7) longe le mur ouest : rien n'y empiète.
    expect(contains(COMPTOIR, 17.5, 9)).toBe(false)
    expect(COMPTOIR.x).toBeGreaterThan(porte.x + 6)
    expect(COMPTOIR.x + COMPTOIR.width).toBeLessThanOrEqual(FOYER.x + FOYER.width - 0.15 + 1e-9)
    for (const a of AFFICHES) expect(a.x - a.largeur / 2).toBeGreaterThan(FOYER.x + 0.15)
  })

  it('assied neuf spectateurs, jamais au bord d’une allée ni côte à côte, et laisse les autres fauteuils libres', () => {
    expect(SPECTATEURS).toHaveLength(9)
    expect(SIEGES_LIBRES).toHaveLength(SIEGES.length - 9)
    const parRang = SIEGES.filter((s) => s.rang === 0).length
    const idx = SPECTATEURS.map((s) => SIEGES.indexOf(s))
    for (const i of idx) {
      expect([0, parRang - 1]).not.toContain(i % parRang)
      expect(idx).not.toContain(i + 1)
    }
  })

  it('dansLeFaisceau : dehors 0, sur l’axe objectif → toile 1, et un fondu au bord', () => {
    const l = CABINE.find((f) => f.projection)!
    const s = { x: l.x, y: (l.y0 + l.y1) / 2, z: l.z - 0.05 }
    const c = { x: ECRAN.x, y: ECRAN.bas + ECRAN.hauteur / 2, z: ECRAN.z }
    const sur = (t: number) => ({ x: s.x + (c.x - s.x) * t, y: s.y + (c.y - s.y) * t, z: s.z + (c.z - s.z) * t })
    expect(dansLeFaisceau(sur(0.5))).toBe(1)
    // Assis au rang 1, la tête bien sous le faisceau.
    expect(dansLeFaisceau({ x: 9.5, y: GRADINS[0].dessus + TETE_ASSISE, z: GRADINS[0].z1 - 0.3 })).toBe(0)
    // Un pas de côté à travers le bord : la valeur monte sans sauter.
    const y = sur(0.8).y
    const z = sur(0.8).z
    let avant = 0
    for (let x = 0; x <= 9.5; x += 0.05) {
      const v = dansLeFaisceau({ x, y, z })
      expect(v - avant).toBeLessThan(0.2)
      avant = v
    }
  })

  it('meuble la cabine contre ses murs, en laissant libre le chemin de la porte aux lucarnes', () => {
    for (const m of MEUBLES_CABINE) {
      expect(m.x).toBeGreaterThanOrEqual(SALLE_CABINE.x + 0.15 - 1e-9)
      expect(m.x + m.width).toBeLessThanOrEqual(SALLE_CABINE.x + SALLE_CABINE.width - 0.15 + 1e-9)
      expect(m.z + m.depth).toBeLessThanOrEqual(SALLE_CABINE.z + SALLE_CABINE.depth - 0.15 + 1e-9)
      // Ni devant la porte (1 m dedans), ni devant la lucarne du projectionniste.
      expect(contains(m, PORTE_CABINE.x, SALLE_CABINE.z + 0.6)).toBe(false)
      expect(contains(m, CABINE[1].x, SALLE_CABINE.z + 0.5)).toBe(false)
    }
  })

  it('ouvre les allées sur les rangs : pas de garde-corps entre une allée et ses fauteuils', () => {
    const bords = guardrails(MUSEE, -1).filter((g) => g.x1 === g.x2 && (Math.abs(g.x1 - BLOC_GRADINS.x) < 1e-9 || Math.abs(g.x1 - BLOC_GRADINS.x - BLOC_GRADINS.width) < 1e-9))
    expect(bords).toEqual([])
    // Ni devant la traverse : une marche de rang, et l'écran derrière.
    expect(guardrails(MUSEE, -1).filter((g) => g.z1 === g.z2 && Math.abs(g.z1 - TRAVERSE.z) < 1e-9)).toEqual([])
  })

  it('pose chaque rang au niveau de la marche des allées qui le borde au fond', () => {
    expect(GRADINS).toHaveLength(5)
    for (const g of GRADINS)
      for (const f of VOLEES_CINEMA) expect(flightElevation(f, f.x + 0.1, g.z1)).toBeCloseTo(g.dessus, 6)
    expect(GRADINS[0].z0).toBe(BLOC_GRADINS.z)
    expect(GRADINS[4].z1).toBeCloseTo(PROMENOIR.z, 6)
    expect(GRADINS[4].dessus).toBeCloseTo(PROMENOIR.elevation, 6)
  })

  it('aligne dix-huit fauteuils par rang dans le bloc, tournés vers l’écran', () => {
    expect(SIEGES).toHaveLength(4 * 18)
    for (const s of SIEGES) {
      const g = GRADINS[s.rang]
      expect(s.y).toBe(g.dessus)
      expect(s.z - FAUTEUIL.profondeur / 2).toBeGreaterThan(g.z0)
      expect(s.z + FAUTEUIL.profondeur / 2).toBeLessThan(g.z1)
      expect(s.x - FAUTEUIL.largeur / 2).toBeGreaterThanOrEqual(BLOC_GRADINS.x - 1e-9)
      expect(s.x + FAUTEUIL.largeur / 2).toBeLessThanOrEqual(BLOC_GRADINS.x + BLOC_GRADINS.width + 1e-9)
      expect(s.lacet).toBe(Math.PI)
    }
  })

  it('tend l’écran au-dessus de la scène, sous le plafond, encadré des rideaux', () => {
    expect(ECRAN.bas).toBeGreaterThan(SOL + SCENE.hauteur)
    expect(ECRAN.bas + ECRAN.hauteur).toBeLessThan(PLAFOND)
    expect(ECRAN.x - ECRAN.largeur / 2).toBeGreaterThan(SALLE.x)
    expect(ECRAN.x + ECRAN.largeur / 2).toBeLessThan(SALLE.x + SALLE.width)
    const [g, d, haut] = RIDEAUX
    expect(g.x1).toBeCloseTo(ECRAN.x - ECRAN.largeur / 2, 6)
    expect(d.x0).toBeCloseTo(ECRAN.x + ECRAN.largeur / 2, 6)
    expect(haut.y0).toBeCloseTo(ECRAN.bas + ECRAN.hauteur, 6)
    for (const r of RIDEAUX) expect(r.z).toBeLessThan(SCENE.z + SCENE.depth)
  })

  it('éclaire chaque marche des allées, et pose appliques, enceintes, spots et cabine dans la salle', () => {
    expect(LUMIERES_MARCHES).toHaveLength(30)
    for (const p of LUMIERES_MARCHES) expect(VOLEES_CINEMA.some((f) => contains(f, p.x, p.z))).toBe(true)
    for (const p of [...APPLIQUES, ...ENCEINTES, ...SPOTS]) {
      expect(contains(SALLE, p.x, p.z)).toBe(true)
      expect(p.y).toBeLessThanOrEqual(PLAFOND)
    }
    // Rien au mur au-dessus des têtes du promenoir : appliques et enceintes restent devant lui.
    for (const p of [...APPLIQUES, ...ENCEINTES]) expect(p.z).toBeLessThan(PROMENOIR.z)
    // Les enceintes du mur est passent au-dessus du linteau de la porte du foyer (2,40 m).
    for (const p of ENCEINTES) expect(p.y).toBeGreaterThan(SOL + 2.4)
    for (const c of CABINE) {
      expect(c.y0).toBeGreaterThan(COTE_PROMENOIR + 1)
      expect(c.y1).toBeLessThan(PLAFOND)
    }
  })

  it('le faisceau du projecteur passe au-dessus des têtes assises (15 cm au moins)', () => {
    const source = { y: (CABINE[0].y0 + CABINE[0].y1) / 2, z: CABINE[0].z }
    for (const s of SIEGES) {
      const t = (source.z - s.z) / (source.z - ECRAN.z)
      const bas = source.y + t * (ECRAN.bas - source.y)
      expect(bas - (s.y + TETE_ASSISE), `rang ${s.rang}`).toBeGreaterThan(0.15)
    }
  })

  it('appliques et enceintes au-dessus des têtes, partout où l’on marche le long des murs', () => {
    for (const p of [...APPLIQUES, ...ENCEINTES]) {
      expect(p.y - solLeLongDesMurs(p.z), `(${p.x}, ${p.z})`).toBeGreaterThan(2.2)
      expect(p.y).toBeLessThan(PLAFOND)
    }
  })

  it('siegeVise : le fauteuil que le regard désigne, le plus proche, à portée', () => {
    const s = SIEGES.find((x) => x.rang === 1)!
    const oeil = { x: 3.8, y: s.y + 1.2, z: s.z }
    const vers = { x: s.x - oeil.x, y: s.y + 0.55 - oeil.y, z: 0 }
    const n = Math.hypot(vers.x, vers.y)
    expect(siegeVise(oeil, { x: vers.x / n, y: vers.y / n, z: 0 })?.rang).toBe(1)
    // Le dos tourné : rien.
    expect(siegeVise(oeil, { x: -1, y: 0, z: 0 })).toBeNull()
  })
})
