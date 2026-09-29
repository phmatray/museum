import { expect, it } from 'vitest'

import { ENTREE, facade, lignesDeBanniere, OBSTACLES_PORTES_ENTREE, OBSTACLES_PORTIQUE } from '../facade'
import { MUSEE } from '../musee'

it('centre le portique sur l’entrée et laisse sa baie du milieu libre', () => {
  const entree = MUSEE.levels[0].openings.find((o) => o.kind === 'entrance')!
  const xs = OBSTACLES_PORTIQUE.flatMap((r) => [r.x, r.x + r.width])
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(entree.x)
  // Aucun pilier devant l'ouverture, sur toute sa largeur et 30 cm de jeu :
  // vu du hall, rien ne se dresse dans l'embrasure.
  const demi = entree.width / 2 + 0.3
  const devant = OBSTACLES_PORTIQUE.filter((r) => r.x < entree.x + demi - 1e-6 && r.x + r.width > entree.x - demi + 1e-6)
  expect(devant).toHaveLength(0)
})

it('habille de brique les quatre façades et pose l’enseigne au-dessus du portique', () => {
  const f = facade(MUSEE)
  expect(f.brique.length).toBeGreaterThan(8)
  expect(f.piliers).toHaveLength(4)
  // L'enseigne est sur la face avant du linteau : rien ne peut la masquer vue d'en bas.
  const avant = Math.max(...OBSTACLES_PORTIQUE.map((r) => r.z + r.depth))
  expect(f.enseigne.z).toBeGreaterThan(avant)
  expect(f.enseigne.y).toBeGreaterThan(7.4)
  expect(f.enseigne.y).toBeLessThan(8.6)
  expect(f.bannieres).toHaveLength(2)
})

it('ouvre les portes de l’entrée sur l’entrée du plan, sans rétrécir le passage sous 2,80 m', () => {
  const entree = MUSEE.levels[0].openings.find((o) => o.kind === 'entrance')!
  expect([ENTREE.x, ENTREE.z, ENTREE.width]).toEqual([entree.x, entree.z, entree.width])
  const [g, d] = [...OBSTACLES_PORTES_ENTREE].sort((a, b) => a.x - b.x)
  expect(d.x - (g.x + g.width)).toBeGreaterThan(2.8)
})

it('attache les battants à la face intérieure du mur : aucun battant ne flotte', () => {
  // Le mur de façade déborde de INT (0,15 m) côté hall.
  for (const r of OBSTACLES_PORTES_ENTREE) expect(r.z + r.depth).toBeCloseTo(ENTREE.z - 0.15, 3)
})

it('coupe le nom d’une bannière aux majuscules et aux tirets, en lignes courtes', () => {
  expect(lignesDeBanniere('TaLibStandard')).toEqual(['TaLib', 'Standard'])
  expect(lignesDeBanniere('FormCraft')).toEqual(['FormCraft'])
  expect(lignesDeBanniere('RoselineMCP')).toEqual(['Roseline', 'MCP'])
  expect(lignesDeBanniere('aspire-app-with-n8n').join('')).toBe('aspire-app-with-n8n')
})

it('pose un soubassement et une corniche de pierre sur les quatre façades, sans barrer l’entrée', () => {
  const f = facade(MUSEE)
  const [W, D] = [MUSEE.width, MUSEE.depth]
  const socles = f.pierre.filter((b) => Math.abs(b.y - b.h / 2) < 1e-6 && b.h > 0.5)
  const corniches = f.pierre.filter((b) => Math.abs(b.y + b.h / 2 - (MUSEE.levels.length * MUSEE.storey - MUSEE.slab)) < 1e-6)
  for (const lot of [socles, corniches]) {
    expect(lot.some((b) => b.z < 0 && b.w > W)).toBe(true)
    expect(lot.some((b) => b.z > D && b.w > 10)).toBe(true)
    expect(lot.some((b) => b.x < 0 && b.d >= D)).toBe(true)
    expect(lot.some((b) => b.x > W && b.d >= D)).toBe(true)
  }
  // Le socle s'arrête aux jambages du portique : rien ne se dresse devant l'entrée.
  for (const b of socles) expect(b.x + b.w / 2 <= ENTREE.x - ENTREE.width || b.x - b.w / 2 >= ENTREE.x + ENTREE.width || b.z < D).toBe(true)
})
