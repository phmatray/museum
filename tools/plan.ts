/**
 * Plan COTÉ du musée, un SVG par niveau.
 *
 *   node tools/plan.ts               # tous les niveaux → .captures/plan-*.svg
 *   node tools/plan.ts --niveau 0    # un seul
 *
 * ── Pourquoi cet outil existe ──
 *
 * Il a été demandé après un défaut qu'aucune capture 3D n'avait montré et
 * qu'aucun test unitaire ne pouvait montrer : **l'escalier était inaccessible.**
 * Il vit dans la trémie de l'atrium, la trémie est ceinturée d'un garde-corps
 * sur tout son périmètre, et personne ne disait où l'escalier arrive. Chaque
 * pièce était juste séparément ; c'est leur RENCONTRE qui ne l'était pas.
 *
 * Une vue subjective ne montre pas ça — on voit un garde-corps, on suppose qu'il
 * s'ouvre plus loin. Un plan coté le montre en une seconde, parce qu'il met côte
 * à côte des choses que la 3D ne fait jamais voir ensemble : l'emprise, la
 * trémie, le tracé de l'escalier, ses paliers, et les cotes qui disent si on
 * passe.
 *
 * Il ne remplace pas les tests — le test d'accès existe désormais aussi — mais
 * c'est lui qui rend une anomalie de plan ÉVIDENTE avant qu'on écrive le test.
 */
/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '.captures')

/** Le plan est dessiné à cette échelle : 12 pixels par mètre. */
const ECHELLE = 12
const MARGE = 84

// ── Types, lus au vol depuis museum.json ─────────────────────────────────

interface Vec2 { x: number; z: number }
interface Rect { x: number; z: number; width: number; depth: number }
interface Opening { kind: string; start: number; end: number; height: number; sill?: number }
interface Wall { id: string; a: Vec2; b: Vec2; kind: string; openings: Opening[]; placements: unknown[] }
interface Room { id: string; name: string; footprint: Rect; theme: string; keys: string[]; walls: Wall[] }
interface Floor {
  id: string
  name: string
  level: number
  elevation: number
  ceilingHeight: number
  rooms: Room[]
  enclosure: Wall[]
  slabHoles: Rect[]
  footprint: Rect
}
interface Ramp {
  id: string
  fromFloor: string
  toFloor: string
  centre: Vec2
  radius: number
  startAngle: number
  sweep: number
  width: number
  rise: number
  baseElevation: number
}
interface Museum {
  floors: Floor[]
  ramps: Ramp[]
  atrium: Rect
  spawn: { floorId: string; position: { x: number; y: number; z: number } }
}

// ── Dessin ───────────────────────────────────────────────────────────────

const echap = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Une cote : trait à embouts, valeur au milieu. */
function cote(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  texte: string,
  decalage = 0,
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const l = Math.hypot(dx, dy) || 1
  // Normale unitaire, pour écarter la ligne de cote de l'objet mesuré.
  const nx = (-dy / l) * decalage
  const ny = (dx / l) * decalage
  const [ax, ay, bx, by] = [x1 + nx, y1 + ny, x2 + nx, y2 + ny]
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
  return `
    <g stroke="#2f6f9f" stroke-width="0.8" fill="none">
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" />
      <line x1="${ax}" y1="${ay - 4}" x2="${ax}" y2="${ay + 4}" transform="rotate(${angle} ${ax} ${ay})" />
      <line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}" transform="rotate(${angle} ${bx} ${by})" />
    </g>
    <text x="${mx}" y="${my - 3}" transform="rotate(${Math.abs(angle) > 90 ? angle + 180 : angle} ${mx} ${my})"
          text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#2f6f9f">${echap(texte)}</text>`
}

function planDeNiveau(museum: Museum, floor: Floor): string {
  const f = floor.footprint
  const L = f.width * ECHELLE
  const H = f.depth * ECHELLE
  const px = (x: number) => MARGE + (x - f.x) * ECHELLE
  const pz = (z: number) => MARGE + (z - f.z) * ECHELLE
  const larg = L + 2 * MARGE
  const haut = H + 2 * MARGE + 56

  const morceaux: string[] = []

  // — Emprise —
  morceaux.push(
    `<rect x="${px(f.x)}" y="${pz(f.z)}" width="${L}" height="${H}" fill="#faf8f4" stroke="#c3bcb0"/>`,
  )

  // — Salles —
  for (const salle of floor.rooms) {
    const aveugle = salle.keys.length === 0
    const r = salle.footprint
    morceaux.push(`
      <rect x="${px(r.x)}" y="${pz(r.z)}" width="${r.width * ECHELLE}" height="${r.depth * ECHELLE}"
            fill="${aveugle ? '#eeeae2' : '#e3ddd0'}" stroke="#a99f8e" stroke-width="0.6"/>
      <text x="${px(r.x + r.width / 2)}" y="${pz(r.z + r.depth / 2) - 5}" text-anchor="middle"
            font-family="system-ui, sans-serif" font-size="10" fill="#3b342a">${echap(aveugle ? 'passage' : salle.name)}</text>
      <text x="${px(r.x + r.width / 2)}" y="${pz(r.z + r.depth / 2) + 8}" text-anchor="middle"
            font-family="ui-monospace, monospace" font-size="9" fill="#7a7266">${r.width.toFixed(1)} × ${r.depth.toFixed(1)} m${aveugle ? '' : ` · ${salle.keys.length}`}</text>`)
  }

  // — Murs, épaisseur réelle, et leurs ouvertures —
  const tousLesMurs = [...floor.rooms.flatMap((r) => r.walls), ...floor.enclosure]
  for (const w of tousLesMurs) {
    const couleur = w.kind === 'outer' ? '#4a4239' : '#8a8175'
    morceaux.push(
      `<line x1="${px(w.a.x)}" y1="${pz(w.a.z)}" x2="${px(w.b.x)}" y2="${pz(w.b.z)}" stroke="${couleur}" stroke-width="${0.32 * ECHELLE}" stroke-linecap="butt"/>`,
    )
    // Les ouvertures, en blanc par-dessus : c'est ce qui fait lire un plan.
    const Lm = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1
    const ux = (w.b.x - w.a.x) / Lm
    const uz = (w.b.z - w.a.z) / Lm
    for (const o of w.openings) {
      const a = { x: w.a.x + ux * o.start, z: w.a.z + uz * o.start }
      const b = { x: w.a.x + ux * o.end, z: w.a.z + uz * o.end }
      const fenetre = (o.sill ?? 0) > 0
      morceaux.push(
        `<line x1="${px(a.x)}" y1="${pz(a.z)}" x2="${px(b.x)}" y2="${pz(b.z)}" stroke="${fenetre ? '#9fc4dd' : '#faf8f4'}" stroke-width="${0.32 * ECHELLE}" stroke-linecap="butt"/>`,
      )
    }
  }

  // — Trémie —
  for (const trou of floor.slabHoles) {
    morceaux.push(`
      <rect x="${px(trou.x)}" y="${pz(trou.z)}" width="${trou.width * ECHELLE}" height="${trou.depth * ECHELLE}"
            fill="#dfe7ee" stroke="#6f8fa8" stroke-dasharray="6 4"/>
      <text x="${px(trou.x + trou.width / 2)}" y="${pz(trou.z) + 14}" text-anchor="middle"
            font-family="system-ui, sans-serif" font-size="10" fill="#4d6b83">trémie ${trou.width} × ${trou.depth} m</text>`)
  }

  // — Escaliers : tracé, sens de montée, et PALIERS —
  for (const ramp of museum.ramps) {
    const bas = ramp.baseElevation
    const haut2 = ramp.baseElevation + ramp.rise
    // On dessine l'escalier sur les deux niveaux qu'il relie : c'est le seul
    // moyen de voir qu'on arrive quelque part.
    if (Math.abs(bas - floor.elevation) > 1e-4 && Math.abs(haut2 - floor.elevation) > 1e-4) continue

    const pts: string[] = []
    const n = 48
    for (let i = 0; i <= n; i++) {
      const a = ramp.startAngle + (ramp.sweep * i) / n
      pts.push(`${px(ramp.centre.x + ramp.radius * Math.cos(a))},${pz(ramp.centre.z + ramp.radius * Math.sin(a))}`)
    }
    morceaux.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="#b06a3a" stroke-width="${ramp.width * ECHELLE}" stroke-opacity="0.28"/>`,
      `<polyline points="${pts.join(' ')}" fill="none" stroke="#b06a3a" stroke-width="1.2" stroke-dasharray="5 4"/>`,
    )

    for (const [y, sens] of [
      [bas, 'départ ↑'],
      [haut2, 'arrivée ↓'],
    ] as [number, string][]) {
      if (Math.abs(y - floor.elevation) > 1e-4) continue
      const a = y === bas ? ramp.startAngle : ramp.startAngle + ramp.sweep
      const cx = px(ramp.centre.x + ramp.radius * Math.cos(a))
      const cz = pz(ramp.centre.z + ramp.radius * Math.sin(a))
      const rayon = (ramp.width / 2 + 0.3) * ECHELLE
      morceaux.push(`
        <circle cx="${cx}" cy="${cz}" r="${rayon}" fill="#ffd9a8" fill-opacity="0.55" stroke="#b06a3a" stroke-width="1.4"/>
        <text x="${cx}" y="${cz + 3}" text-anchor="middle" font-family="system-ui, sans-serif"
              font-size="9" fill="#7a4620">${echap(sens)}</text>`)
    }
  }

  // — Le visiteur, là où il apparaît —
  if (museum.spawn.floorId === floor.id) {
    const sx = px(museum.spawn.position.x)
    const sz = pz(museum.spawn.position.z)
    morceaux.push(`
      <circle cx="${sx}" cy="${sz}" r="6" fill="#d94f4f"/>
      <text x="${sx}" y="${sz - 11}" text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="10" fill="#a03030">départ</text>`)
  }

  // — Cotes d'ensemble et cotes de la trémie —
  morceaux.push(cote(px(f.x), pz(f.z), px(f.x + f.width), pz(f.z), `${f.width} m`, -34))
  morceaux.push(
    cote(px(f.x + f.width), pz(f.z), px(f.x + f.width), pz(f.z + f.depth), `${f.depth} m`, -34),
  )
  const trou = floor.slabHoles[0]
  if (trou) {
    morceaux.push(
      cote(px(trou.x), pz(trou.z + trou.depth), px(trou.x + trou.width), pz(trou.z + trou.depth), `${trou.width} m`, 26),
    )
    // La cote qui aurait tout dit : du bord du vide au tracé de l'escalier.
    const r = museum.ramps[0]
    if (r) {
      const jeu = Math.abs(trou.x) - (r.radius + r.width / 2)
      morceaux.push(
        cote(px(trou.x), pz(0), px(-(r.radius + r.width / 2)), pz(0), `jeu ${jeu.toFixed(2)} m`, 0),
      )
    }
  }

  const echelleY = MARGE + H + 44
  morceaux.push(`
    <g font-family="ui-monospace, monospace" font-size="10" fill="#5c5648">
      <line x1="${MARGE}" y1="${echelleY}" x2="${MARGE + 5 * ECHELLE}" y2="${echelleY}" stroke="#5c5648" stroke-width="2"/>
      <line x1="${MARGE}" y1="${echelleY - 4}" x2="${MARGE}" y2="${echelleY + 4}" stroke="#5c5648"/>
      <line x1="${MARGE + 5 * ECHELLE}" y1="${echelleY - 4}" x2="${MARGE + 5 * ECHELLE}" y2="${echelleY + 4}" stroke="#5c5648"/>
      <text x="${MARGE + 5 * ECHELLE + 8}" y="${echelleY + 4}">5 m</text>
      <text x="${MARGE}" y="${echelleY + 22}">nord ↑ · plancher à ${floor.elevation.toFixed(2)} m · sous plafond ${floor.ceilingHeight} m</text>
    </g>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${larg} ${haut}" width="${larg}" height="${haut}">
  <rect width="${larg}" height="${haut}" fill="#ffffff"/>
  <text x="${MARGE}" y="${MARGE - 44}" font-family="system-ui, sans-serif" font-size="19" font-weight="600" fill="#2b2620">${echap(floor.name)}</text>
  <text x="${MARGE}" y="${MARGE - 26}" font-family="ui-monospace, monospace" font-size="11" fill="#7a7266">${floor.rooms.filter((r) => r.keys.length > 0).length} salles · ${floor.rooms.filter((r) => r.keys.length === 0).length} passages · ${floor.rooms.reduce((n, r) => n + r.keys.length, 0)} œuvres</text>
  ${morceaux.join('\n  ')}
</svg>`
}

// ── Point d'entrée ───────────────────────────────────────────────────────

async function main() {
  const museum = JSON.parse(
    await readFile(resolve(ROOT, 'public/data/museum.json'), 'utf8'),
  ) as Museum

  const i = process.argv.indexOf('--niveau')
  const seul = i >= 0 ? Number(process.argv[i + 1]) : null
  const niveaux = seul === null ? museum.floors : museum.floors.filter((f) => f.level === seul)

  await mkdir(OUT, { recursive: true })
  for (const floor of niveaux) {
    const chemin = resolve(OUT, `plan-${floor.id}.svg`)
    await writeFile(chemin, planDeNiveau(museum, floor), 'utf8')
    console.log(`${floor.name.padEnd(18)} → .captures/plan-${floor.id}.svg`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
