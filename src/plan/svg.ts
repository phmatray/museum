/**
 * Le plan d'architecte d'un niveau, en SVG autonome.
 *
 * Conventions : murs pochés en noir, volées hachurées avec la flèche de montée,
 * ce qui passe au-dessus du plan de coupe en tireté, vides barrés d'une croix,
 * garde-corps en trait fin, cotes générales, échelle graphique et nord. Chaque
 * salle d'exposition porte ses dimensions et sa capacité d'accrochage.
 *
 * Pur : (plan, niveau) → chaîne. Le même rendu sert au dossier `docs/plan` et
 * pourra servir à la minimap.
 */
import { guardrails } from './geometry.ts'
import { capacity } from './rules.ts'
import type { Plan, Rect } from './types.ts'

const C = {
  paper: '#FBFBFA', poche: '#1B1E21', gallery: '#FFFFFF', honneur: '#F3E3BF', hall: '#E4E8EB',
  stair: '#EEF0F2', closed: '#C9CDD1', ink: '#1B1E21', ink2: '#4A5057', ink3: '#7C838A', red: '#CF3326',
}
const FILL = { gallery: C.gallery, honneur: C.honneur, hall: C.hall, balcony: C.hall }
const S = 14
const PAD = 70
// Demi-épaisseurs de mur, partagées avec l'extrusion 3D (mesh.ts).
export const INT = 0.15
export const EXT = 0.45

const n = (v: number) => +(v * S).toFixed(1)
const rect = (r: Rect, attrs: string, grow = 0) =>
  `<rect x="${n(r.x - grow)}" y="${n(r.z - grow)}" width="${n(r.width + 2 * grow)}" height="${n(r.depth + 2 * grow)}" ${attrs}/>`
const text = (x: number, y: number, s: string, attrs: string) => `<text x="${x}" y="${y}" ${attrs}>${s.replace(/&/g, '&amp;')}</text>`
const cote = (v: number) => v.toFixed(2).replace('.', ',')

export function renderLevel(plan: Plan, levelId: number): string {
  const level = plan.levels.find((l) => l.id === levelId)
  if (!level) throw new Error(`niveau ${levelId} inconnu`)
  const W = n(plan.width) + 2 * PAD
  const H = n(plan.depth) + 2 * PAD + 40
  const o: string[] = []
  const below = plan.levels.find((l) => l.elevation < level.elevation - 1e-6 && l.elevation >= level.elevation - plan.storey - 1e-6)

  // Vides : ce qui, sous ce niveau, n'est couvert par aucune de ses salles.
  if (below)
    for (const r of below.rooms.filter((r) => r.kind === 'hall'))
      o.push(rect(r, `fill="${C.paper}"`))

  // Poché : la façade tout autour, puis les salles (hors balcons) élargies et creusées.
  const fw = EXT + INT
  for (const r of [
    { x: -EXT, z: -EXT, width: plan.width + 2 * EXT, depth: fw },
    { x: -EXT, z: plan.depth - INT, width: plan.width + 2 * EXT, depth: fw },
    { x: -EXT, z: -EXT, width: fw, depth: plan.depth + 2 * EXT },
    { x: plan.width - INT, z: -EXT, width: fw, depth: plan.depth + 2 * EXT },
  ]) o.push(rect(r, `fill="${C.poche}"`))
  for (const r of level.rooms) if (r.kind !== 'balcony') o.push(rect(r, `fill="${C.poche}"`, EXT))
  for (const r of level.rooms) o.push(rect(r, `fill="${FILL[r.kind]}"`, r.kind === 'balcony' ? 0 : -INT))

  // Obstacles : hachure grise.
  for (const ob of level.obstacles) o.push(rect(ob, `fill="url(#closed)" stroke="${C.ink3}" stroke-width="0.8"`))

  // Paliers et volées : pleins s'ils partent de ce niveau, tiretés s'ils passent au-dessus.
  const inLevel = (e: number) => e >= level.elevation - 1e-6 && e < level.elevation + plan.storey - 1e-6
  for (const l of plan.landings) {
    if (!inLevel(l.elevation) && !(below && l.elevation > below.elevation)) continue
    const dessus = l.elevation > level.elevation
    o.push(rect(l, `fill="${dessus ? 'none' : C.stair}" stroke="${C.ink2}" stroke-width="1" ${dessus ? 'stroke-dasharray="6 4"' : ''}`))
    o.push(text(n(l.x + l.width / 2), n(l.z + l.depth / 2) + 4, `palier +${cote(l.elevation)}`, `text-anchor="middle" font-size="11" class="cap"`))
  }
  for (const f of plan.flights) {
    const visible = inLevel(f.bottom) || (below && f.bottom >= below.elevation && f.top > level.elevation - 1e-6)
    if (!visible) continue
    const dessus = f.bottom > level.elevation + 1e-6 && !inLevel(f.bottom)
    const partiel = f.bottom > level.elevation + 1e-6
    o.push(rect(f, `fill="${C.stair}" stroke="${C.ink2}" stroke-width="1" ${partiel && !dessus ? 'stroke-dasharray="4 3"' : ''}`))
    const ns = f.direction === 'north' || f.direction === 'south'
    const run = ns ? f.depth : f.width
    for (let i = 1; i < f.risers - 1; i++) {
      const t = (i * run) / (f.risers - 1)
      o.push(ns
        ? `<line x1="${n(f.x)}" x2="${n(f.x + f.width)}" y1="${n(f.z + t)}" y2="${n(f.z + t)}" stroke="${C.ink3}" stroke-width="0.8"/>`
        : `<line y1="${n(f.z)}" y2="${n(f.z + f.depth)}" x1="${n(f.x + t)}" x2="${n(f.x + t)}" stroke="${C.ink3}" stroke-width="0.8"/>`)
    }
    const cx = n(f.x + f.width / 2)
    const [y0, y1] = f.direction === 'north' ? [n(f.z + f.depth - 0.3), n(f.z + 0.4)] : [n(f.z + 0.3), n(f.z + f.depth - 0.4)]
    o.push(`<line x1="${cx}" x2="${cx}" y1="${y0}" y2="${y1}" stroke="${C.ink}" stroke-width="1.4" marker-end="url(#fleche)"/>`)
    o.push(`<circle cx="${cx}" cy="${y0}" r="3" fill="${C.ink}"/>`)
  }

  // Vide sur le hall du dessous : le hall, rogné par les balcons qui le bordent.
  // ponytail: un rectangle par hall, bordé de balcons longs à l'ouest et à l'est et d'un balcon large au sud ; un vide en L demanderait une vraie soustraction.
  if (below)
    for (const h of below.rooms.filter((r) => r.kind === 'hall')) {
      const balcons = level.rooms.filter((r) => r.kind === 'balcony')
      const longs = balcons.filter((b) => b.depth > b.width)
      const xMin = Math.max(h.x, ...longs.filter((b) => b.x < h.x + h.width / 2).map((b) => b.x + b.width))
      const xMax = Math.min(h.x + h.width, ...longs.filter((b) => b.x >= h.x + h.width / 2).map((b) => b.x))
      const zMax = Math.min(h.z + h.depth, ...balcons.filter((b) => b.width >= b.depth).map((b) => b.z))
      for (const v of [{ x: xMin, z: h.z, width: xMax - xMin, depth: zMax - h.z }]) {
        o.push(rect(v, `fill="none" stroke="${C.ink3}" stroke-dasharray="6 5" stroke-width="1"`))
        o.push(`<path d="M${n(v.x)},${n(v.z)}L${n(v.x + v.width)},${n(v.z + v.depth)}M${n(v.x + v.width)},${n(v.z)}L${n(v.x)},${n(v.z + v.depth)}" stroke="${C.ink3}" stroke-dasharray="6 5" stroke-width="1"/>`)
        o.push(text(n(v.x + v.width / 2), n(v.z + v.depth / 2) - 10, `vide sur ${h.name.toLowerCase()}`, `text-anchor="middle" font-size="11" class="cap" ${halo(C.paper)}`))
      }
    }

  // Garde-corps.
  for (const g of guardrails(plan, level.id))
    o.push(`<line x1="${n(g.x1)}" y1="${n(g.z1)}" x2="${n(g.x2)}" y2="${n(g.z2)}" stroke="${C.ink}" stroke-width="2.4"/>`)

  // Ouvertures.
  for (const op of level.openings) {
    if (op.kind === 'open') continue
    const room = level.rooms.find((r) => r.id === op.a)!
    const vertical = Math.abs(op.x - room.x) < 1e-6 || Math.abs(op.x - room.x - room.width) < 1e-6
    // Le mur à percer : ±INT entre deux salles ; côté extérieur il s'épaissit de EXT.
    const dehors = vertical ? (Math.abs(op.x - room.x) < 1e-6 ? -1 : 1) : (Math.abs(op.z - room.z) < 1e-6 ? -1 : 1)
    const [p0, p1] = op.b ? [-INT - 0.02, INT + 0.02] : dehors < 0 ? [-EXT - 0.02, INT + 0.02] : [-INT - 0.02, EXT + 0.02]
    const r = vertical
      ? { x: op.x + p0, z: op.z - op.width / 2, width: p1 - p0, depth: op.width }
      : { x: op.x - op.width / 2, z: op.z + p0, width: op.width, depth: p1 - p0 }
    const fond = op.kind === 'bay' ? C.paper : FILL[room.kind]
    o.push(rect(r, `fill="${fond}"`))
    if (op.kind === 'bay') {
      for (const d of [-0.12, 0.12]) o.push(vertical
        ? `<line x1="${n(op.x + d)}" x2="${n(op.x + d)}" y1="${n(op.z - op.width / 2)}" y2="${n(op.z + op.width / 2)}" stroke="${C.ink2}" stroke-width="1"/>`
        : `<line y1="${n(op.z + d)}" y2="${n(op.z + d)}" x1="${n(op.x - op.width / 2)}" x2="${n(op.x + op.width / 2)}" stroke="${C.ink2}" stroke-width="1"/>`)
    }
    if (op.kind === 'entrance')
      o.push(`<path d="M${n(op.x)},${n(op.z) + 34}L${n(op.x)},${n(op.z) + 12}" stroke="${C.red}" stroke-width="2" marker-end="url(#fleche-r)"/>`,
        text(n(op.x) + 10, n(op.z) + 30, 'ENTRÉE', `font-size="11" class="cap" fill="${C.red}"`))
  }

  // Étiquettes.
  for (const r of level.rooms) {
    if (r.kind === 'balcony') continue
    const cx = n(r.x + r.width / 2)
    const fond = FILL[r.kind]
    if (r.kind === 'hall') {
      o.push(text(cx, n(r.z + r.depth * 0.78), r.name, `text-anchor="middle" font-size="15" class="lbl" ${halo(fond)}`))
      o.push(text(cx, n(r.z + r.depth * 0.78) + 15, `${r.width} × ${r.depth} m · double hauteur`, `text-anchor="middle" font-size="10.5" class="cap" ${halo(fond)}`))
      continue
    }
    const cy = n(r.z + r.depth * 0.62)
    o.push(text(cx, cy - 6, r.name, `text-anchor="middle" font-size="15" class="lbl" ${halo(fond)}`))
    o.push(text(cx, cy + 10, `${r.width} × ${r.depth} m`, `text-anchor="middle" font-size="10.5" class="cap" ${halo(fond)}`))
    o.push(text(cx, cy + 24, `${capacity(r, level)} œuvres`, `text-anchor="middle" font-size="10.5" class="cap" ${halo(fond)}`))
  }

  // Cotes générales, échelle, nord, cartouche.
  const dy = n(plan.depth) + 64
  const dx = -40
  o.push(`<g stroke="${C.ink3}" stroke-width="1">`,
    `<line x1="0" x2="${n(plan.width)}" y1="${dy}" y2="${dy}"/>`, `<line x1="0" x2="0" y1="${dy - 5}" y2="${dy + 5}"/>`, `<line x1="${n(plan.width)}" x2="${n(plan.width)}" y1="${dy - 5}" y2="${dy + 5}"/>`,
    `<line y1="0" y2="${n(plan.depth)}" x1="${dx}" x2="${dx}"/>`, `<line y1="0" y2="0" x1="${dx - 5}" x2="${dx + 5}"/>`, `<line y1="${n(plan.depth)}" y2="${n(plan.depth)}" x1="${dx - 5}" x2="${dx + 5}"/>`, `</g>`)
  o.push(text(n(plan.width / 2), dy - 6, `${cote(plan.width)} m`, `text-anchor="middle" font-size="11" class="dim"`))
  o.push(text(dx - 6, n(plan.depth / 2), `${cote(plan.depth)} m`, `text-anchor="middle" font-size="11" class="dim" transform="rotate(-90 ${dx - 6} ${n(plan.depth / 2)})"`))
  o.push(`<g transform="translate(${n(plan.width) - n(10)},-26)">`,
    `<rect x="0" y="0" width="${n(5)}" height="6" fill="${C.ink}" stroke="${C.ink}"/>`, `<rect x="${n(5)}" y="0" width="${n(5)}" height="6" fill="${C.paper}" stroke="${C.ink}"/>`,
    text(0, -5, '0', `font-size="10" class="dim"`), text(n(10), -5, '10 m', `font-size="10" text-anchor="end" class="dim"`), `</g>`)
  o.push(`<g transform="translate(-40,-30)"><path d="M0,-12 L7,9 L0,5 L-7,9 z" fill="${C.ink}"/>${text(0, -16, 'N', `text-anchor="middle" font-size="11" class="dim"`)}</g>`)
  o.push(text(0, -30, `${level.name.toUpperCase()} · +${cote(level.elevation)}`, `font-size="15" class="lbl"`))

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${plan.name}, ${level.name}">`,
    `<style>.lbl{font-family:Archivo,Helvetica,Arial,sans-serif;font-weight:650;fill:${C.ink}}.cap{font-family:'IBM Plex Mono',Menlo,monospace;fill:${C.ink3}}.dim{font-family:'IBM Plex Mono',Menlo,monospace;fill:${C.ink2}}</style>`,
    `<defs>`,
    `<pattern id="closed" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${C.stair}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${C.closed}" stroke-width="2"/></pattern>`,
    `<marker id="fleche" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${C.ink}"/></marker>`,
    `<marker id="fleche-r" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${C.red}"/></marker>`,
    `</defs>`,
    `<rect x="${-PAD}" y="${-PAD}" width="${W}" height="${H}" fill="${C.paper}"/>`,
    ...o,
    `</svg>`,
  ].join('\n')
}

function halo(fill: string) {
  return `stroke="${fill}" stroke-width="5" paint-order="stroke" stroke-linejoin="round"`
}
