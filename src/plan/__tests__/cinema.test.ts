/**
 * Le cinéma du sous-sol : ses gradins tombent juste sur les marches des allées,
 * ses fauteuils tiennent dans leur bloc, l'écran, les rideaux, les lumières et
 * la cabine sont dans la salle, sous le plafond.
 */
import { describe, expect, it } from 'vitest'

import {
  APPLIQUES, BLOC_GRADINS, CABINE, COTE_PROMENOIR, ECRAN, ENCEINTES, FAUTEUIL, GRADINS, LUMIERES_MARCHES, PLAFOND, PROMENOIR, RIDEAUX,
  SALLE, SCENE, SIEGES, SOL, SPOTS, VOLEES_CINEMA,
} from '../cinema'
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

  it('pose chaque rang au niveau de la marche des allées qui le borde au fond', () => {
    expect(GRADINS).toHaveLength(5)
    for (const g of GRADINS)
      for (const f of VOLEES_CINEMA) expect(flightElevation(f, f.x + 0.1, g.z1)).toBeCloseTo(g.dessus, 6)
    expect(GRADINS[0].z0).toBe(BLOC_GRADINS.z)
    expect(GRADINS[4].z1).toBeCloseTo(PROMENOIR.z, 6)
    expect(GRADINS[4].dessus).toBeCloseTo(PROMENOIR.elevation, 6)
  })

  it('aligne dix-huit fauteuils par rang dans le bloc, tournés vers l’écran', () => {
    expect(SIEGES).toHaveLength(5 * 18)
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
})
