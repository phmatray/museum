/**
 * « Partager ce tableau » : l'adresse qui ouvre le musée devant la toile
 * (`domain/lien.ts`). Au doigt, la feuille de partage du téléphone ; au
 * clavier et à la souris, le presse-papiers, et un « Lien copié » discret
 * en haut de l'écran (port de components/partager.ts et Partage.tsx).
 */
import config from '../../../museum.config.json'
import { lienVers } from '../../domain/lien.ts'
import { el } from './dom.ts'
import './partage.css'

let message: { boite: HTMLDivElement; titre: HTMLElement; lien: HTMLDivElement; minuteur?: ReturnType<typeof setTimeout> } | null = null

/** Le message du partage : deux secondes et demie, huit s'il faut copier à la main ; le minuteur repart à chaque partage. */
export function direPartage(copie: boolean, lien: string): void {
  if (!message?.boite.isConnected) {
    const titre = el('strong')
    const texte = el('div')
    message = { boite: el('div', { role: 'status', 'data-partage': true, hidden: true }, titre, texte), titre, lien: texte }
    document.body.append(message.boite)
  }
  const m = message
  m.titre.textContent = copie ? '✓ Lien copié' : 'Copiez ce lien'
  m.lien.textContent = lien
  // Rejoue l'animation d'apparition, comme le remontage React.
  m.boite.hidden = true
  void m.boite.offsetWidth
  m.boite.hidden = false
  clearTimeout(m.minuteur)
  m.minuteur = setTimeout(() => (m.boite.hidden = true), copie ? 2500 : 8000)
}

/** Partage la toile `cle` ; `cles`, les clés du catalogue, décident du nom court. */
export function partager(cle: string, nom: string, cles: readonly string[]): void {
  // En production, la page `p/<nom>/` du build, qui porte l'aperçu du projet.
  const url = lienVers(cle, cles, `${location.origin}${import.meta.env.BASE_URL}`, import.meta.env.PROD)
  if (matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function') {
    // Refermée sans choisir : rien à dire.
    navigator.share({ title: `${nom} · ${config.name}`, text: `Venez voir ${nom} dans mon musée`, url }).catch(() => {})
    return
  }
  // Sans presse-papiers (http nu, refus) : le lien s'affiche, à copier à la main.
  Promise.resolve(navigator.clipboard?.writeText(url) ?? Promise.reject(new Error('pas de presse-papiers')))
    .then(() => direPartage(true, url), () => direPartage(false, url))
}
