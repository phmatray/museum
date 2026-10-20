/**
 * La carte d'une étape du journal de chantier (CarteEtape.tsx), en bas à
 * gauche : quand le visiteur regarde un cadre de la baraque (chantier.ts publie
 * `partie.etape`), l'étape s'y raconte — image, numéro, catégorie, PR — et
 * « Lire dans le journal » ouvre la page du journal à son ancre (Entrée, ou J).
 */
import '@fontsource/marcellus/latin-400.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'

import type { Journal } from '../../domain/journal.ts'
import { teinteCategorie } from '../chantier.ts'
import { partie } from '../etat.ts'
import { el, observer } from './dom.ts'
import './carteEtape.css'

/** Le dépôt du musée : ses PR sont celles du journal. */
const DEPOT = 'https://github.com/phmatray/museum'

/** L'adresse d'un fichier du journal publié (`dist/journal/`, servi en dév par vite.config.ts). */
const adresseJournal = (chemin = '') => `${import.meta.env.BASE_URL}journal/${chemin}`

/** Rend le démontage (les tests s'en servent). */
export function monterCarteEtape(racine: HTMLElement, journal: Promise<Journal | null>): () => void {
  let j: Journal | null = null
  let carte: HTMLElement | null = null
  /** Le lien de la carte affichée, null sans carte (ou en pause). */
  let lien: string | null = null

  const dessiner = ([ancre, paused]: readonly [string | null, boolean]) => {
    const e = ancre === null ? undefined : j?.etapes.find((x) => x.ancre === ancre)
    carte?.remove()
    carte = lien = null
    if (!j || !e || paused) return
    lien = adresseJournal(`#${e.ancre}`)
    const statut = e.pr === null
      ? el('div', { class: e.fait ? 'statut fait' : 'statut' }, e.statut)
      : el('div', { class: e.fait ? 'statut fait' : 'statut' }, e.statut.replace(/\s*·?\s*PR #\d+/, ''), ' · ', el('a', { href: `${DEPOT}/pull/${e.pr}`, target: '_blank', rel: 'noopener' }, `PR #${e.pr}`))
    const img = e.image && el('img', { src: adresseJournal(e.image.src), alt: '', style: `aspect-ratio: ${e.image.largeur} / ${e.image.hauteur}` })
    carte = el('aside', { class: 'carte-etape', 'aria-live': 'polite' },
      img,
      el('div', { class: 'surtitre' },
        el('span', { class: 'numero' }, e.n === null ? 'Hors série' : `Étape ${e.n}`),
        el('span', { class: 'categorie' }, el('span', { class: 'pastille', style: `background: ${teinteCategorie(e.categorie)}` }), j.categories[e.categorie] ?? e.categorie)),
      el('div', { class: 'titre' }, e.titre),
      statut,
      el('div', { class: 'pied' }, el('a', { class: 'lire', href: lien, target: '_blank', rel: 'noopener' }, el('kbd', {}, 'Entrée'), ' Lire dans le journal')))
    racine.append(carte)
  }

  const choisir = (s: { etape: string | null; paused: boolean }) => [s.etape, s.paused] as const
  const desabonner = observer(partie, choisir, dessiner)
  void journal.then((r) => {
    j = r
    dessiner(choisir(partie.getState()))
  })

  const touche = (ev: KeyboardEvent) => {
    if (lien === null || ev.repeat) return
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'KeyJ') window.open(lien, '_blank', 'noopener')
  }
  window.addEventListener('keydown', touche)
  return () => {
    desabonner()
    window.removeEventListener('keydown', touche)
    carte?.remove()
  }
}
