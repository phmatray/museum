/**
 * Des points de vue tirés du plan, pour les salles nommées (ids de `MUSEE`) : depuis chaque
 * baie (vers l'intérieur, et l'inverse), le centre dans quatre directions, les quatre coins
 * vers le centre, le bas et le haut de chaque volée, chaque palier contenu dans la salle.
 *
 *   node .claude/skills/world-review/scripts/vues.ts cinema ss-foyer > vues.json
 */
import { MUSEE } from '../../../../src/plan/musee.ts'
import { flightElevation, surfaceAt } from '../../../../src/plan/rules.ts'
import type { Rect } from '../../../../src/plan/types.ts'

type Lieu = { level: number; surface: string; x: number; z: number; y: number; yaw: number; pitch: number }
const vues: { nom: string; lieu: Lieu }[] = []
const dedans = (r: Rect, x: number, z: number) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth
/** Le cap (0 : vers −z) qui regarde de (x, z) vers (tx, tz). */
const cap = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z))

function ajouter(nom: string, x: number, z: number, y: number, tx: number, tz: number, pitch = 0.04) {
  const surface = surfaceAt(MUSEE, x, z, y)
    ?? MUSEE.flights.filter((f) => dedans(f, x, z)).map((f) => `volee:${f.id}`)[0]
  if (!surface) return console.error(`(${x.toFixed(1)}, ${z.toFixed(1)}) à ${y} : aucune surface, vue « ${nom} » sautée`)
  const niveau = MUSEE.levels.reduce((a, l) => (Math.abs(l.elevation - y) < Math.abs(a.elevation - y) ? l : a))
  const level = niveau.id
  // Au plancher, un obstacle (le dessous d'un palier, un comptoir) n'est pas un point de vue : on y serait muré.
  if (Math.abs(niveau.elevation - y) < 1e-6 && niveau.obstacles.some((o) => x > o.x && x < o.x + o.width && z > o.z && z < o.z + o.depth)) return console.error(`(${x.toFixed(1)}, ${z.toFixed(1)}) dans un obstacle, vue « ${nom} » sautée`)
  vues.push({ nom, lieu: { level, surface, x: +x.toFixed(2), z: +z.toFixed(2), y: +y.toFixed(3), yaw: +cap(x, z, tx, tz).toFixed(3), pitch } })
}

for (const id of process.argv.slice(2)) {
  const niveau = MUSEE.levels.find((l) => l.rooms.some((r) => r.id === id))
  if (!niveau) {
    console.error(`salle inconnue : ${id}`)
    continue
  }
  const r = niveau.rooms.find((x) => x.id === id)!
  const y = niveau.elevation
  const [cx, cz] = [r.x + r.width / 2, r.z + r.depth / 2]
  for (const o of niveau.openings.filter((o) => o.a === id || o.b === id)) {
    // La normale de la baie : vers l'intérieur de la salle.
    const surX = Math.abs(o.x - r.x) < 0.01 || Math.abs(o.x - r.x - r.width) < 0.01
    const [nx, nz] = surX ? [Math.sign(cx - o.x), 0] : [0, Math.sign(cz - o.z)]
    ajouter(`${id}-baie-${o.a === id ? o.b : o.a}-vers-dedans`, o.x - nx * 1.2, o.z - nz * 1.2, y, cx, cz)
    ajouter(`${id}-baie-${o.a === id ? o.b : o.a}-vers-dehors`, o.x + nx * 1.5, o.z + nz * 1.5, y, o.x - nx * 5, o.z - nz * 5)
  }
  for (const [nom, dx, dz] of [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['o', -1, 0]] as const) ajouter(`${id}-centre-${nom}`, cx, cz, y, cx + dx, cz + dz)
  const m = 0.8
  for (const [nom, x, z] of [['no', r.x + m, r.z + m], ['ne', r.x + r.width - m, r.z + m], ['se', r.x + r.width - m, r.z + r.depth - m], ['so', r.x + m, r.z + r.depth - m]] as const) ajouter(`${id}-coin-${nom}`, x, z, y, cx, cz)
  for (const f of MUSEE.flights.filter((f) => dedans(r, f.x + f.width / 2, f.z + f.depth / 2))) {
    const [mx, mz] = [f.x + f.width / 2, f.z + f.depth / 2]
    const [ux, uz] = f.direction === 'north' ? [0, -1] : f.direction === 'south' ? [0, 1] : f.direction === 'east' ? [1, 0] : [-1, 0]
    const demi = (f.direction === 'north' || f.direction === 'south' ? f.depth : f.width) / 2 - 0.4
    const [bx, bz, hx, hz] = [mx - ux * demi, mz - uz * demi, mx + ux * demi, mz + uz * demi]
    ajouter(`${id}-volee-${f.id}-bas`, bx, bz, flightElevation(f, bx, bz), hx, hz, 0.15)
    ajouter(`${id}-volee-${f.id}-haut`, hx, hz, flightElevation(f, hx, hz), bx, bz, -0.2)
  }
  for (const l of MUSEE.landings.filter((l) => dedans(r, l.x + l.width / 2, l.z + l.depth / 2))) ajouter(`${id}-palier-${l.id}`, l.x + l.width / 2, l.z + l.depth / 2, l.elevation, cx, cz, -0.08)
}
console.log(JSON.stringify(vues, null, 2))
