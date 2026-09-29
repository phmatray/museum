/**
 * « Partager ce tableau » : l'adresse qui ouvre le musée devant la toile
 * (`domain/lien.ts`). Au doigt, la feuille de partage du téléphone ; au
 * clavier et à la souris, le presse-papiers, et un « Lien copié » discret
 * (`Partage.tsx`). À part du composant : `react-refresh` le veut seul dans son fichier.
 */
import { create } from 'zustand'

import config from '../../museum.config.json'
import { lienVers } from '../domain/lien'

/** Le dernier partage, pour `MessagePartage` : `copie` nulle, rien à dire. */
export const useMessage = create<{ copie: boolean | null; lien: string; at: number }>(() => ({ copie: null, lien: '', at: 0 }))
const dire = (copie: boolean, lien: string) => useMessage.setState({ copie, lien, at: Date.now() })

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
    .then(() => dire(true, url), () => dire(false, url))
}

