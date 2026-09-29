/**
 * La couleur d'encre des cartels, par thème de salle.
 *
 * Dans un `.ts` et non dans le `.tsx` du composant : eslint interdit d'exporter
 * autre chose qu'un composant depuis un fichier `.tsx` (`react-refresh`), et
 * cette table est désormais lue par DEUX composants — le cartel d'œuvre, ancré
 * sur un mur, et le cartel de socle, qui ne l'est pas.
 *
 * Les murs sont clairs partout sauf en réserve (`vault`), assez sombre pour
 * qu'une encre foncée y disparaisse. Ce tableau est local et non importé de
 * `lighting.ts` : un cartel doit rester lisible même si la palette des murs
 * change, ce sont deux décisions distinctes.
 */
import type { ThemeId } from '../domain/types'
import { CARTEL_HAUTEUR } from '../plan/cartels'

export const THEME_INK: Record<ThemeId, string> = {
  classic: '#2a2620',
  modern: '#22242a',
  immersive: '#23262e',
  vault: '#f3ecdd',
}

/**
 * Police vendorisée sous `public/assets/fonts/` (#52) : sans elle, `<Text>`
 * (troika, via drei) retombe sur son défaut téléchargé depuis un CDN, ce qui
 * laisse le musée hors ligne sans aucun cartel ni nom de salle. Un seul point
 * d'export pour les trois `<Text>` du bâtiment (`Cartel`, `PlanToiles`,
 * `SculptureLayer`) : un chemin écrit une fois plutôt que trois.
 */
export const CARTEL_FONT = `${import.meta.env.BASE_URL}assets/fonts/PTSans-Regular.ttf`

/** Le romain des titres des vitrines de la salle d'honneur (PT Serif, même fonderie, sous-ensemble latin). */
export const TITRE_FONT = `${import.meta.env.BASE_URL}assets/fonts/PTSerif-Regular.ttf`

/** La plaque d'un cartel, dessinée pour tous les cartels à la fois par `CartelLayer`. */
export const PLAQUE = { hauteur: CARTEL_HAUTEUR, epaisseur: 0.01, couleur: '#f4f1ea' }

/** Le cartel d'une toile de cimaise : sombre sur le stratifié blanc, en lettres crème (`CartelPlacement.surPanneau`). */
export const PLAQUE_PANNEAU = { couleur: '#34302b', encre: '#efe4cc' }
