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
 *
 * ── Révision du 2026-08-15 : le plan dessine enfin CE QU'ON Y POSE ──
 *
 * Il ne montrait que le bâtiment : emprise, salles, murs, trémie, escalier. Tout
 * le MOBILIER et tout le DÉCOR d'architecture en étaient absents, alors que ce
 * sont eux qu'on ajoute et donc eux dont le placement est douteux. On voyait
 * qu'un escalier arrivait quelque part ; on ne voyait pas qu'une nervure et une
 * jardinière se disputaient le même mètre carré.
 *
 * Deux régimes de trait, et c'est la distinction que fait un architecte :
 *
 *  - **trait plein** — ce qui est au SOL, dans lequel on se cogne. C'est le plan
 *    d'étage ordinaire ;
 *  - **trait pointillé** — ce qui est AU-DESSUS de la tête et qu'on regarde par
 *    en dessous : projecteurs suspendus, et la part des nervures qui déborde en
 *    porte-à-faux au-dessus du vide. C'est un plan de plafond réfléchi, et c'est
 *    la seule façon de voir un débord, qui par définition ne touche pas le sol.
 *
 * Et surtout, il CHERCHE LES COLLISIONS. `domain/props.ts` garantit que les
 * props ne se croisent pas entre eux ; rien ne garantissait qu'ils ne croisent
 * pas le décor, qui est placé par un autre module et contre une autre géométrie.
 * Les recouvrements sont cerclés de rouge et comptés en tête de plan.
 */
/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { activerResolutionTs } from './ts-resolve.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '.captures')

// Le domaine s'importe dynamiquement, APRÈS le crochet : `park.ts` importe
// `./props` sans extension. Voir l'en-tête de `ts-resolve.ts`.
activerResolutionTs()

const { PROP_METRICS, placeProps } = await import('../src/domain/props.ts')
const { DECOR_METRICS, placeDecor } = await import('../src/domain/decor.ts')

/** Le plan est dessiné à cette échelle : 12 pixels par mètre. */
const ECHELLE = 12
const MARGE = 84

// ── Types ────────────────────────────────────────────────────────────────
//
// Ils venaient d'une declaration LOCALE et partielle — « lus au vol depuis
// museum.json ». C'etait tenable tant que cet outil ne faisait que dessiner le
// contenu du fichier. Il appelle desormais `placeProps` et `placeDecor`, donc il
// doit parler le meme langage que le domaine : une copie partielle ne se
// substitue pas au vrai type, et la faire passer par un cast aurait rendu ce
// fichier immunise contre les evolutions du modele — exactement ce qu'un type
// existe pour empecher.

import type { Floor, Museum } from '../src/domain/types.ts'

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

/**
 * Une pièce posée, ramenée à ce qu'un plan a besoin de savoir.
 *
 * `rayon` est celui du cylindre englobant — la même convention que
 * `PROP_METRICS`, et la seule mesure qui reste vraie quel que soit le lacet.
 * `suspendu` bascule le trait du plein au pointillé : ce qui pend au plafond ou
 * déborde au-dessus du vide ne se dessine pas comme ce qui barre le passage.
 */
interface Piece {
  id: string
  x: number
  z: number
  rayon: number
  rotation: number
  suspendu: boolean
  famille: 'mobilier' | 'plante' | 'decor'
}

const TEINTES: Record<Piece['famille'], { trait: string; fond: string }> = {
  mobilier: { trait: '#8a6d3b', fond: '#e8d9b8' },
  plante: { trait: '#4f7a43', fond: '#d5e6cd' },
  decor: { trait: '#3f6d8c', fond: '#cfe2ee' },
}

/** Toutes les pièces d'un niveau, mobilier et décor confondus. */
function piecesDuNiveau(museum: Museum, floor: Floor): Piece[] {
  const pieces: Piece[] = []
  // Le décor est calculé D'ABORD et passé aux props, exactement comme le fait la
  // scène. Sans ce partage, le plan dessinerait un mobilier que le musée ne pose
  // pas — et un contrôle qui mesure autre chose que ce qui est rendu est pire
  // qu'aucun contrôle.
  const decor = placeDecor(museum)

  for (const p of placeProps(museum, decor)) {
    if (p.floorId !== floor.id) continue
    const m = PROP_METRICS[p.id]
    pieces.push({
      id: p.id,
      x: p.position.x,
      z: p.position.z,
      // L'échelle du prop compte : une plante à 2,4 occupe deux fois et demie
      // son rayon nominal, et c'est elle qui déborde.
      rayon: m.radius * p.scale,
      rotation: p.rotation,
      // Un prop dont tout le volume est SOUS son ancrage pend au plafond.
      suspendu: m.maxY <= 0,
      famille: p.id.startsWith('plante') ? 'plante' : 'mobilier',
    })
  }

  for (const d of decor) {
    if (d.floorId !== floor.id) continue
    const m = DECOR_METRICS[d.id]
    pieces.push({
      id: d.id,
      x: d.position.x,
      z: d.position.z,
      rayon: m.radius * Math.max(d.scale.x, d.scale.z),
      rotation: d.rotation.y,
      suspendu: false,
      famille: 'decor',
    })
  }

  return pieces
}

/**
 * Les paires qui se recouvrent au sol.
 *
 * On ne compare QUE ce qui est au sol : un projecteur suspendu à 3,90 m au-dessus
 * d'un banc n'est pas une collision, c'est un musée. Comparer les deux ferait
 * hurler le plan sur une centaine de faux positifs et le rendrait inutile — le
 * défaut classique d'un contrôle trop large.
 */
function collisions(pieces: readonly Piece[]): [number, number][] {
  const paires: [number, number][] = []
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]
      const b = pieces[j]
      if (a.suspendu || b.suspendu) continue
      const d = Math.hypot(a.x - b.x, a.z - b.z)
      if (enPot(a, b, d)) continue
      // Une tolérance d'un centimètre : deux emprises tangentes ne sont pas un
      // défaut, et un flottant ne tombe jamais pile.
      if (d < a.rayon + b.rayon - 0.01) paires.push([i, j])
    }
  }
  return paires
}

/**
 * Vrai quand les deux pièces sont une plante ET son pot.
 *
 * Ce n'est pas une exception de confort, c'est la correction d'un FAUX POSITIF
 * qui rendait le contrôle inutilisable : `poserUnePlante` pose la plante et sa
 * jardinière au MÊME point — trois espèces sur quatre sont des planches
 * botaniques sans contenant, et la jardinière est la condition pour qu'elles ne
 * flottent pas. Leurs emprises se recouvrent donc TOUJOURS, par conception.
 *
 * Sans cette clause, le plan signalait 72 recouvrements dont 68 étaient des
 * plantes correctement empotées. Un contrôle qui crie sur ce qui va bien noie
 * les quatre cas qui ne vont pas, et on cesse de le lire — ce qui est pire que
 * de ne pas l'avoir.
 *
 * La concentricité est exigée : une plante à côté d'une AUTRE jardinière que la
 * sienne reste un vrai défaut, et celui-là doit continuer de sortir.
 */
function enPot(a: Piece, b: Piece, d: number): boolean {
  const paire =
    (a.id === 'jardiniere' && b.famille === 'plante') ||
    (b.id === 'jardiniere' && a.famille === 'plante')
  return paire && d < 0.05
}

function planDeNiveau(museum: Museum, floor: Floor): string {
  const f = floor.footprint
  const L = f.width * ECHELLE
  const H = f.depth * ECHELLE
  const px = (x: number) => MARGE + (x - f.x) * ECHELLE
  const pz = (z: number) => MARGE + (z - f.z) * ECHELLE
  // La légende vit à droite du plan, hors de l'emprise : posée dessus, elle
  // masquerait précisément les salles du bord qu'on vient vérifier.
  const LEGENDE = 210
  const larg = L + 2 * MARGE + LEGENDE
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

  // — Le mobilier et le décor : ce qu'on POSE, donc ce qu'on vient vérifier —
  const pieces = piecesDuNiveau(museum, floor)
  const heurts = collisions(pieces)
  const enHeurt = new Set(heurts.flat())

  for (const [i, p] of pieces.entries()) {
    const t = TEINTES[p.famille]
    const r = Math.max(2.2, p.rayon * ECHELLE)
    // Le pointillé dit « au-dessus de la tête » : c'est la convention du plan de
    // plafond réfléchi, et c'est ce qui distingue un obstacle d'un débord.
    morceaux.push(
      `<circle cx="${px(p.x)}" cy="${pz(p.z)}" r="${r.toFixed(1)}" fill="${t.fond}" fill-opacity="${p.suspendu ? 0.25 : 0.55}" stroke="${t.trait}" stroke-width="0.9"${p.suspendu ? ' stroke-dasharray="3 2.5"' : ''}/>`,
    )
    // Le sens : pour une nervure, c'est la direction du porte-à-faux ; pour un
    // banc, celle du regard. Sans lui, un anneau de pièces orientées n'importe
    // comment a exactement l'air d'un anneau correct.
    if (p.famille === 'decor' || p.id === 'banc') {
      const l = r + 5
      morceaux.push(
        `<line x1="${px(p.x)}" y1="${pz(p.z)}" x2="${(px(p.x) + Math.cos(p.rotation) * l).toFixed(1)}" y2="${(pz(p.z) - Math.sin(p.rotation) * l).toFixed(1)}" stroke="${t.trait}" stroke-width="1.1"/>`,
      )
    }
    if (enHeurt.has(i)) {
      morceaux.push(
        `<circle cx="${px(p.x)}" cy="${pz(p.z)}" r="${(r + 3).toFixed(1)}" fill="none" stroke="#d94f4f" stroke-width="1.8"/>`,
      )
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

  // — Légende : un plan qui ne se légende pas se relit de travers —
  const legX = MARGE + L + 18
  const entrees: [string, string][] = [
    ['mobilier', `mobilier · ${pieces.filter((p) => p.famille === 'mobilier' && !p.suspendu).length}`],
    ['plante', `végétation · ${pieces.filter((p) => p.famille === 'plante').length}`],
    ['decor', `décor · ${pieces.filter((p) => p.famille === 'decor').length}`],
  ]
  const legende: string[] = entrees.map(([f, texte], i) => {
    const t = TEINTES[f as Piece['famille']]
    const y = MARGE + 14 + i * 20
    return `<circle cx="${legX + 7}" cy="${y - 4}" r="6" fill="${t.fond}" stroke="${t.trait}" stroke-width="0.9"/>
      <text x="${legX + 20}" y="${y}" font-family="system-ui, sans-serif" font-size="10" fill="#3b342a">${echap(texte)}</text>`
  })
  const ySusp = MARGE + 14 + entrees.length * 20
  legende.push(
    `<circle cx="${legX + 7}" cy="${ySusp - 4}" r="6" fill="#cfe2ee" fill-opacity="0.25" stroke="#3f6d8c" stroke-width="0.9" stroke-dasharray="3 2.5"/>
     <text x="${legX + 20}" y="${ySusp}" font-family="system-ui, sans-serif" font-size="10" fill="#3b342a">au-dessus de la tête · ${pieces.filter((p) => p.suspendu).length}</text>`,
    `<circle cx="${legX + 7}" cy="${ySusp + 16}" r="6" fill="none" stroke="#d94f4f" stroke-width="1.8"/>
     <text x="${legX + 20}" y="${ySusp + 20}" font-family="system-ui, sans-serif" font-size="10" fill="${heurts.length > 0 ? '#a03030' : '#3b342a'}">recouvrement · ${heurts.length}</text>`,
  )
  morceaux.push(`<g>${legende.join('\n')}</g>`)

  // Les collisions se nomment sous la légende : savoir qu'il y en a trois ne dit
  // pas lesquelles, et c'est « lesquelles » qui se corrige.
  if (heurts.length > 0) {
    const lignes = heurts
      .slice(0, 10)
      .map(
        ([i, j], k) =>
          `<text x="${legX}" y="${ySusp + 44 + k * 13}" font-family="ui-monospace, monospace" font-size="9" fill="#a03030">${echap(
            `${pieces[i].id} × ${pieces[j].id} — ${(pieces[i].rayon + pieces[j].rayon - Math.hypot(pieces[i].x - pieces[j].x, pieces[i].z - pieces[j].z)).toFixed(2)} m`,
          )}</text>`,
      )
      .join('\n')
    morceaux.push(
      `<g>${lignes}${heurts.length > 10 ? `<text x="${legX}" y="${ySusp + 44 + 10 * 13}" font-family="ui-monospace, monospace" font-size="9" fill="#a03030">… et ${heurts.length - 10} autres</text>` : ''}</g>`,
    )
  }

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
  let totalHeurts = 0
  for (const floor of niveaux) {
    const chemin = resolve(OUT, `plan-${floor.id}.svg`)
    await writeFile(chemin, planDeNiveau(museum, floor), 'utf8')

    const pieces = piecesDuNiveau(museum, floor)
    const heurts = collisions(pieces)
    totalHeurts += heurts.length
    const poses = pieces.filter((p) => !p.suspendu).length
    console.log(
      `${floor.name.padEnd(18)} ${String(poses).padStart(4)} au sol · ` +
        `${String(pieces.length - poses).padStart(3)} en l'air · ` +
        `${heurts.length > 0 ? `${heurts.length} recouvrement(s)` : 'aucun recouvrement'}` +
        `  → .captures/plan-${floor.id}.svg`,
    )
    for (const [i, j] of heurts.slice(0, 6)) {
      const d = pieces[i].rayon + pieces[j].rayon - Math.hypot(pieces[i].x - pieces[j].x, pieces[i].z - pieces[j].z)
      console.log(
        `${' '.repeat(20)}✗ ${pieces[i].id} × ${pieces[j].id} — ${d.toFixed(2)} m de trop`,
      )
    }
  }

  // Le compte remonte en code de sortie : un plan qu'on regarde est utile, un
  // plan qui peut FAIRE ÉCHOUER quelque chose l'est davantage. `--strict` sert
  // à le brancher un jour dans la CI, sans l'imposer aujourd'hui.
  if (totalHeurts > 0 && process.argv.includes('--strict')) {
    console.error(`\n${totalHeurts} recouvrement(s) — voir les cercles rouges.`)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
