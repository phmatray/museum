/**
 * Le programme du cinéma du sous-sol : la dernière vidéo de la chaîne YouTube
 * (jamais un Short), relevée au build par `tools/fetch-cinema.ts` dans
 * `public/data/cinema.json`. Pur : le flux RSS en texte → les vidéos.
 */

/** La chaîne projetée (Atypical Craft). */
export const CHAINE = { nom: 'Atypical Craft', id: 'UC-ADNwZ53TxwF5KjJ4Rq-fA' } as const

export interface Seance {
  schemaVersion: 1
  generatedAt: string
  chaine: string
  /** L'identifiant YouTube de la vidéo à l'affiche. */
  video: string
  titre: string
  /** ISO 8601. */
  publie: string
  /** Les séances précédentes (les plus récentes d'abord), affichées au foyer. */
  precedentes?: { video: string; titre: string }[]
}

export interface Entree { video: string; titre: string; publie: string }

const texte = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** Les vidéos du flux Atom de YouTube, dans son ordre (la plus récente d'abord). */
export function lireFlux(xml: string): Entree[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, e]) => {
    const video = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1]
    const titre = /<title>([^<]*)<\/title>/.exec(e)?.[1]
    const publie = /<published>([^<]+)<\/published>/.exec(e)?.[1]
    return video && titre !== undefined && publie ? [{ video, titre: texte(titre), publie }] : []
  })
}

/** Un Short se trahit souvent par son titre ; sinon `estUnShort` (l'adresse /shorts/ qui ne redirige pas) tranche. */
export const titreDeShort = (titre: string): boolean => /#shorts?\b/i.test(titre)

/** L'adresse de l'affiche (vignette) d'une vidéo : servie avec CORS ouvert, lisible comme texture. */
export const affiche = (video: string, qualite: 'maxresdefault' | 'hqdefault' = 'maxresdefault') => `https://i.ytimg.com/vi/${video}/${qualite}.jpg`

/** Le lecteur intégré, en lecture automatique (le clic qui lance la séance est le geste exigé pour le son). */
export const lecteur = (video: string) =>
  `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
