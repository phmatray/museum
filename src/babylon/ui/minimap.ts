/**
 * La minimap (#31, Minimap.tsx) : le plan d'architecte du niveau où se tient
 * le visiteur, sa salle surlignée, son cône de visée et Bavette par-dessus.
 *
 * Le fond est `renderLevel` (ou `renderDehors` dans le parc), le même dessin
 * que `docs/plan`, calculé une fois par (niveau, dehors) ; seule la couche du
 * visiteur se redessine quand il bouge (`partie.visiteur`, publié seulement
 * alors). Un clic ouvre le plan en plein écran dans un `<dialog>`, qu'on
 * agrandit à deux doigts, à la molette ou aux boutons, et qu'on fait glisser.
 */
import './minimap.css'

import type { Accrochage } from '../../plan/hang.ts'
import { projectForMinimap, zoomer, type Cadrage } from '../../plan/minimap.ts'
import { MUSEE } from '../../plan/musee.ts'
import { S, renderDehors, renderLevel } from '../../plan/svg.ts'
import { partie, reglages } from '../etat.ts'
import { el, observer, svg, themeName } from './dom.ts'

/** Longueur et demi-ouverture du cône de visée, en mètres et en radians. */
const PORTEE = 3
const OUVERTURE = 0.5
const REPOS: Cadrage = { k: 1, x: 0, y: 0 }

type Chat = { x: number; z: number; level: number } | null

const fonds = new Map<string, string>()
/** Le fond en data-URI, généré une fois par (niveau, dehors) : c'est coûteux. */
function fond(level: number, dehors: boolean): string {
  const cle = `${level}:${dehors}`
  let f = fonds.get(cle)
  if (!f) fonds.set(cle, (f = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dehors ? renderDehors(MUSEE, level) : renderLevel(MUSEE, level))}`))
  return f
}

/**
 * Un dessin (fond + calque du visiteur) : l'encart et le plan ouvert en ont chacun un.
 * Les formes du calque sont créées une fois ; chaque pas ne touche que leurs attributs.
 */
function dessin() {
  const img = el('img', { alt: '', draggable: 'false' })
  const salle = svg('rect', { fill: 'rgba(207,51,38,0.18)', stroke: '#CF3326', 'stroke-width': 4 })
  // Bavette, un petit point clair, s'il se promène à cet étage.
  const chat = svg('circle', { r: 6, fill: '#f3efe6', stroke: '#3a2f25', 'stroke-width': 2 }, svg('title', {}, 'Bavette'))
  const cone = svg('polygon', { fill: 'rgba(207,51,38,0.45)' })
  const point = svg('circle', { r: 10, fill: '#CF3326', stroke: '#fff', 'stroke-width': 3 })
  const calque = svg('svg', { role: 'img' }, salle, chat, cone, point)
  return { img, calque, salle, chat, cone, point, racine: el('div', { class: 'minimap-dessin' }, img, calque) }
}

/** Pose des attributs ; `display` à `none` cache la forme sans la retirer. */
const poser = (e: Element, a: Record<string, string | number>) => {
  for (const k in a) e.setAttribute(k, String(a[k]))
}

export function monterMinimap(racine: HTMLElement, accrochage: Accrochage | null, chat: () => Chat): void {
  const mini = dessin()
  const grand = dessin()
  const legende = el('figcaption')
  const encart = el('figure', { class: 'minimap', title: 'Agrandir le plan', hidden: true }, mini.racine, legende)

  const titre = el('span')
  const bouton = (label: string, texte: string) => el('button', { type: 'button', 'aria-label': label }, texte)
  const reduire = bouton('Réduire', '−')
  const agrandir = bouton('Agrandir', '+')
  const fermer = bouton('Fermer le plan', '×')
  const contenu = el('div', { class: 'minimap-contenu' }, el('div', {}, grand.racine))
  const cadre = el('div', { class: 'minimap-cadre' }, contenu)
  const plan = el('dialog', { class: 'minimap-plan' }, el('div', { class: 'minimap-barre' }, titre, reduire, agrandir, fermer), cadre)
  racine.append(encart, plan)

  // Le cadrage du plan ouvert, remis au repos à chaque fermeture.
  let c = REPOS
  const cadrer = (n: Cadrage) => {
    c = n
    contenu.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`
  }
  cadrer(REPOS)
  const ouvrir = () => {
    if (plan.open) return
    if (plan.showModal) plan.showModal()
    else plan.setAttribute('open', '')
  }
  const refermer = () => {
    if (!plan.open) return
    if (plan.close) plan.close()
    else {
      plan.removeAttribute('open')
      plan.dispatchEvent(new Event('close'))
    }
  }
  plan.addEventListener('close', () => cadrer(REPOS))
  // Le plan ouvert n'est dessiné qu'ouvert (comme `{ouvert && <PlanOuvert>}` de three).
  encart.addEventListener('click', () => (ouvrir(), rendre()))
  fermer.addEventListener('click', refermer)
  // Échap : le `<dialog>` modal le gère seul ; le repli (sans showModal) aussi.
  plan.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    refermer()
  })

  const local = (x: number, y: number) => {
    const r = cadre.getBoundingClientRect()
    return [x - r.left, y - r.top] as const
  }
  const centre = () => {
    const r = cadre.getBoundingClientRect()
    return [r.width / 2, r.height / 2] as const
  }
  reduire.addEventListener('click', () => cadrer(zoomer(c, 1 / 1.5, ...centre())))
  agrandir.addEventListener('click', () => cadrer(zoomer(c, 1.5, ...centre())))

  // Deux doigts pour grossir autour de leur milieu, un pour glisser.
  const doigts = new Map<number, { x: number; y: number }>()
  cadre.addEventListener('pointerdown', (e) => {
    cadre.setPointerCapture?.(e.pointerId)
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  })
  cadre.addEventListener('pointermove', (e) => {
    const avant = doigts.get(e.pointerId)
    if (!avant) return
    const [a, b] = [...doigts.values()]
    const ecartAvant = doigts.size === 2 ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    const milieuAvant = doigts.size === 2 ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [avant.x, avant.y]
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (doigts.size === 2) {
      const [a2, b2] = [...doigts.values()]
      const [mx, my] = local((a2.x + b2.x) / 2, (a2.y + b2.y) / 2)
      const [mx0, my0] = local(milieuAvant[0], milieuAvant[1])
      const z = zoomer(c, Math.hypot(a2.x - b2.x, a2.y - b2.y) / (ecartAvant || 1), mx0, my0)
      cadrer({ ...z, x: z.x + mx - mx0, y: z.y + my - my0 })
    } else cadrer({ ...c, x: c.x + e.clientX - avant.x, y: c.y + e.clientY - avant.y })
  })
  const lever = (e: PointerEvent) => void doigts.delete(e.pointerId)
  cadre.addEventListener('pointerup', lever)
  cadre.addEventListener('pointercancel', lever)
  cadre.addEventListener('wheel', (e) => cadrer(zoomer(c, Math.exp(-e.deltaY / 400), ...local(e.clientX, e.clientY))), { passive: true })
  cadre.addEventListener('dblclick', () => cadrer(REPOS))

  // Le dessin : redessiné quand le visiteur bouge, quand Bavette bouge, ou quand l'encart réapparaît.
  let bavette: Chat = null
  const rendre = () => {
    const w = partie.getState().visiteur
    const visible = !!w && reglages.getState().plan
    encart.hidden = !visible
    if (!visible) return refermer()
    const { level, room, player: p, viewBox, dehors } = projectForMinimap(MUSEE, w)
    const cone = [0, OUVERTURE, -OUVERTURE].map((d, i) => {
      if (i === 0) return `${p.x},${p.y}`
      const a = p.yaw + d
      return `${p.x - Math.sin(a) * PORTEE * S},${p.y - Math.cos(a) * PORTEE * S}`
    }).join(' ')
    const nom = room ? themeName(accrochage, room.id, level, room.name) : MUSEE.levels.find((l) => l.id === level)?.name ?? ''
    const src = fond(level, dehors)
    for (const d of plan.open ? [mini, grand] : [mini]) {
      if (d.img.getAttribute('src') !== src) d.img.setAttribute('src', src)
      poser(d.calque, { viewBox: viewBox.join(' '), 'aria-label': `Vous êtes ici : ${nom}` })
      poser(d.salle, room ? { x: room.x * S, y: room.z * S, width: room.width * S, height: room.depth * S, display: 'inline' } : { display: 'none' })
      poser(d.chat, bavette?.level === level ? { cx: bavette.x * S, cy: bavette.z * S, display: 'inline' } : { display: 'none' })
      poser(d.cone, { points: cone })
      poser(d.point, { cx: p.x, cy: p.y })
    }
    legende.textContent = nom
    titre.textContent = nom
    plan.setAttribute('aria-label', `Plan du musée : ${nom}`)
  }
  observer(partie, (s) => s.visiteur, rendre)
  observer(reglages, (s) => s.plan, rendre)
  // Bavette sondée à 10 Hz : redessin seulement si elle a bougé.
  setInterval(() => {
    const b = chat()
    if (b?.x === bavette?.x && b?.z === bavette?.z && b?.level === bavette?.level) return
    bavette = b && { x: b.x, z: b.z, level: b.level }
    if (!encart.hidden) rendre()
  }, 100)
}
