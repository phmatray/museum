/**
 * L'œuvre regardée, hors de la 3D (CarteOeuvre, BorneOeuvre et CarteBavette de three) :
 *
 * - la carte d'une toile (`partie.toile`, eclairage.ts), en bas à gauche : capture,
 *   description, langages, forks, dernier push, QR code. Entrée (ou V) visite le
 *   site quand il y en a un, E ouvre le dépôt sur GitHub (l'étoile y est à un clic),
 *   P partage le lien qui ouvre le musée devant le tableau ;
 * - la borne des vitrines (`partie.borne`, vitrines.ts), qui l'emporte : le README
 *   entier dans un panneau bordeaux qui défile à la molette (souris capturée,
 *   l'événement ne vise pas le panneau : on le lui passe) ou à Page préc./suiv. ;
 *   H visite aussi le site ;
 * - le cartel de Bavette (`partie.bavette`), si aucune toile n'est regardée.
 *
 * Tout se masque en pause. Une carte est reconstruite à chaque
 * changement d'œuvre : son animation d'entrée rejoue, comme le `key` de React.
 */
import { couleurDeLangage, partsDeLangages } from '../../domain/langages.ts'
import { adresseQr, matriceQr, QR_MARGE } from '../../domain/qr.ts'
import type { IndexCaptures } from '../../domain/captures.ts'
import type { Artwork } from '../../domain/types.ts'
import { ilYA } from '../../plan/eveil.ts'
import { CARTEL_BAVETTE } from '../../plan/promenade.ts'
import { readmeEnBlocs } from '../../plan/vitrines.ts'
import { catalogue, partie, readme } from '../etat.ts'
import { el, observer, svg } from './dom.ts'
import { partager } from './partage.ts'
import './oeuvre.css'

/** Pixels par module : trois pixels nets, qu'un téléphone lit sur un écran de portable à bout de bras. */
const QR_PX = 3
const SITE = ['Enter', 'NumpadEnter', 'KeyV']

const ouvrir = (url: string) => window.open(url, '_blank', 'noopener')

/** Le QR code, noir pur sur blanc pur, marge de la norme, bords nets : un seul chemin. */
function codeQr(adresse: string): SVGSVGElement {
  const m = matriceQr(adresse)
  const cote = m.length + 2 * QR_MARGE
  const d = m.flatMap((ligne, l) => ligne.map((sombre, c) => (sombre ? `M${c + QR_MARGE} ${l + QR_MARGE}h1v1h-1z` : ''))).join('')
  return svg('svg', { class: 'qr', role: 'img', 'aria-label': `QR code : ${adresse}`, viewBox: `0 0 ${cote} ${cote}`, width: cote * QR_PX, height: cote * QR_PX, 'shape-rendering': 'crispEdges' },
    svg('path', { d, fill: '#000' }))
}

/** La barre des langages et la légende des `n` premiers (rien sans langage connu). */
function langages(o: Artwork, n: number): Node[] {
  const parts = partsDeLangages(o.languages)
  if (parts.length === 0) return []
  return [
    el('div', { class: 'barre' }, ...parts.map(({ langage, part }) => el('span', { title: langage, style: `width:${part * 100}%;background:${couleurDeLangage(langage)}` }))),
    el('div', { class: 'legende' }, ...parts.slice(0, n).map(({ langage, part }) =>
      el('span', {}, el('span', { class: 'pastille', style: `background:${couleurDeLangage(langage)}` }), `${langage} ${Math.round(part * 100)} %`))),
  ]
}

const chiffres = (o: Artwork) => el('div', { class: 'chiffres' }, `⑂ ${o.forks.toLocaleString('fr-FR')} · poussé ${ilYA(o.pushedAt, new Date())}`)

/** Le pied commun : site, étoile, partage. */
function pied(o: Artwork, cles: readonly string[], titrePartage: string): Node[] {
  const partage = el('button', { type: 'button', title: titrePartage }, el('kbd', {}, 'P'), ' Partager ce tableau')
  partage.addEventListener('click', () => partager(o.key, o.name, cles))
  return [
    o.site && el('span', { class: 'site' }, el('kbd', {}, 'Entrée'), ' visiter le site'),
    el('a', { class: 'etoile', href: o.url, target: '_blank', rel: 'noopener', title: 'Ouvre le dépôt sur GitHub : le bouton Star y est à un clic' },
      el('kbd', {}, 'E'), ' ★ Mettre une étoile', el('span', {}, o.stars.toLocaleString('fr-FR'))),
    partage,
  ].filter((n): n is HTMLElement => !!n)
}

/** Le README en titres, puces et paragraphes, sans son titre de niveau 1 (il répète le nom). */
function corps(md: string): HTMLElement[] {
  const blocs = readmeEnBlocs(md, 40000)
  if (blocs[0]?.type === 'titre' && blocs[0].niveau === 1) blocs.shift()
  return blocs.map((b) =>
    b.type === 'titre' ? el('h3', { class: b.niveau <= 2 ? false : 'bas' }, b.texte)
    : b.type === 'puce' ? el('div', { class: 'puce' }, el('span', {}, '•'), el('span', {}, b.texte.replace(/^\[[ xX]\]\s*/, '')))
    : el('p', {}, b.texte))
}

export function monterOeuvre(racine: HTMLElement, base: string): void {
  let parCle: Map<string, Artwork> | null = null
  let cles: string[] = []
  let captures: IndexCaptures = {}
  let montree: string | null = null
  let carte: HTMLElement | null = null
  /** Ce que le clavier et la molette commandent (rien devant Bavette). */
  let actif: { o: Artwork; defile: HTMLElement | null } | null = null

  const image = (o: Artwork) => {
    const f = captures[o.key]?.file
    return f ? el('img', { src: `${base}media/${f}`, alt: `Aperçu de ${o.name}` }) : null
  }

  const carteToile = (o: Artwork) => el('aside', { class: 'carte-oeuvre', 'aria-live': 'polite' },
    image(o),
    el('div', { class: 'proprio' }, o.owner),
    el('div', { class: 'nom' }, o.name),
    o.description && el('p', { class: 'desc' }, o.description),
    el('div', { class: 'rangee' },
      el('div', {}, ...langages(o, 3), chiffres(o), el('div', { class: 'scan' }, 'Scannez le code pour ouvrir le projet sur votre téléphone.')),
      codeQr(adresseQr(o, cles))),
    el('footer', {}, ...pied(o, cles, 'Un lien qui ouvre le musée devant ce tableau')))

  const carteBorne = (o: Artwork, defile: HTMLElement) => el('aside', { class: 'borne-oeuvre', 'aria-live': 'polite', 'data-borne': true },
    image(o),
    el('header', {},
      el('div', { class: 'proprio' }, `${o.owner} · salle d’honneur`),
      el('h2', {}, o.name),
      el('div', { class: 'filet' }),
      o.description && el('p', { class: 'desc' }, o.description),
      ...langages(o, 4),
      chiffres(o)),
    defile,
    el('footer', {}, ...pied(o, cles, 'Un lien qui ouvre le musée devant cette vitrine'),
      el('span', { class: 'suite' }, 'molette ou ', el('kbd', {}, 'Pg↓'), ' pour lire la suite')))

  const rendre = (force = false) => {
    const { paused, toile, borne, bavette } = partie.getState()
    const o = paused || !parCle ? undefined : borne !== null ? parCle.get(borne) : toile !== null ? parCle.get(toile) : undefined
    const cle = o ? `${borne !== null ? 'b' : 't'}:${o.key}` : !paused && bavette && toile === null && borne === null ? 'bavette' : null
    if (cle === montree && !force) return
    montree = cle
    carte?.remove()
    carte = null
    actif = null
    if (cle === 'bavette') {
      const c = CARTEL_BAVETTE
      carte = el('aside', { class: 'carte-oeuvre bavette', 'aria-live': 'polite' },
        el('div', { class: 'nom' }, c.title), el('p', { class: 'ligne' }, c.ligne), el('div', { class: 'auteur' }, `${c.author}, ${c.year}`))
    } else if (o && borne !== null) {
      const defile = el('div', { class: 'defile' }, el('p', { class: 'attente' }, 'Le README arrive…'))
      carte = carteBorne(o, defile)
      actif = { o, defile }
      // Une réponse arrivée après qu'on a quitté la borne est ignorée.
      void readme(base, o.key).then((md) => md !== null && actif?.defile === defile && defile.replaceChildren(...corps(md)))
    } else if (o) {
      carte = carteToile(o)
      actif = { o, defile: null }
    }
    if (carte) racine.append(carte)
  }

  addEventListener('keydown', (e) => {
    if (!actif || e.repeat) return
    const { o, defile } = actif
    if (e.code === 'KeyE') ouvrir(o.url)
    else if (e.code === 'KeyP') partager(o.key, o.name, cles)
    else if (o.site && (SITE.includes(e.code) || (defile && e.code === 'KeyH'))) ouvrir(o.site)
    else if (defile && (e.code === 'PageDown' || e.code === 'PageUp')) defile.scrollBy({ top: (e.code === 'PageDown' ? 0.85 : -0.85) * defile.clientHeight, behavior: 'smooth' })
  })
  addEventListener('wheel', (e) => actif?.defile?.scrollBy({ top: e.deltaY }), { passive: true })

  observer(partie, (s) => [s.paused, s.toile, s.borne, s.bavette], () => rendre())
  void catalogue(base).then((c) => {
    if (!c) return
    parCle = c.parCle
    cles = [...c.parCle.keys()]
    rendre(true)
  })
  // Sans index (build sans captures), jamais d'erreur : les cartes restent sans image.
  void fetch(`${base}media/captures.json`)
    .then((r) => (r.ok ? (r.json() as Promise<IndexCaptures>) : {}))
    .catch(() => ({}))
    .then((i) => {
      captures = i
      if (montree) rendre(true)
    })
}
