/**
 * Le numéro de cette visite, demandé une seule fois par chargement : le
 * compteur de l'entrée (`CompteurLayer`) et le billet de l'accueil le
 * partagent, sans compter deux fois ni interroger deux fois le service.
 */
import { URL_COMPTEUR, compterLaVisite } from '../domain/compteur'

let visite: Promise<number | null> | null = null

export function laVisite(): Promise<number | null> {
  if (visite === null) {
    const session = (() => {
      try {
        return sessionStorage
      } catch {
        return null
      }
    })()
    // En développement on lit le compteur sans l'incrémenter : les rechargements ne sont pas des visites.
    visite = compterLaVisite(session, fetch, import.meta.env.DEV ? URL_COMPTEUR.replace('/hit/', '/get/') : URL_COMPTEUR)
  }
  return visite
}
