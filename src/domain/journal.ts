/**
 * Le JOURNAL DE CHANTIER (`docs/journal/index.html`) lu comme des données : une
 * étape par `<section class="etape">`, pour la salle du chantier du jardin
 * (`plan/chantier.ts`) qui l'accroche comme une collection.
 *
 * Le journal est écrit à la main, les plus récentes en haut : on le lit à
 * l'expression régulière, sans DOM — le script tourne sous Node au build
 * (`tools/chantier.ts`), et le HTML du journal est le nôtre, d'une forme stable.
 * Rendu dans l'ordre chronologique : la première étape d'abord.
 *
 * Pur : un texte entre, des données sortent.
 */

export interface EtapeJournal {
  /** Le numéro du titre (« 94. … »), `null` pour une étape hors série (« Correctif : … »). */
  n: number | null
  /** L'ancre du titre, `t-94` : `journal/#t-94` y mène. */
  ancre: string
  titre: string
  /** Le `data-cat` de la section : hall, galeries, jardin, bavette, ambiance, site, idees. */
  categorie: string
  /** Le texte du statut, tel quel : « en ligne · PR #185 », « abandonnée »… */
  statut: string
  /** Le statut porte la classe `fait` : l'étape est en ligne ou tranchée. */
  fait: boolean
  pr: number | null
  /** La première image, relative au journal (`img/94-souche.jpg`), et sa taille déclarée. */
  image: { src: string; largeur: number; hauteur: number } | null
}

export interface Journal {
  /** Le libellé de chaque catégorie, lu dans les onglets du journal. */
  categories: Record<string, string>
  etapes: EtapeJournal[]
}

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Le texte d'un fragment HTML : sans balises, entités décodées, espaces resserrés. */
export function texte(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITES[e] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

const attribut = (balise: string, nom: string) => new RegExp(`\\s${nom}="([^"]*)"`).exec(balise)?.[1] ?? null

export function lireJournal(html: string): Journal {
  const categories: Record<string, string> = {}
  for (const [, cat, libelle] of html.matchAll(/<button[^>]*data-cat="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    // Le compteur de l'onglet (`<span class="nb">`) n'est pas le libellé.
    if (cat !== 'tout') categories[cat] = texte(libelle.replace(/<span class="nb">[\s\S]*?<\/span>/, ''))
  }
  const etapes: EtapeJournal[] = []
  for (const [, ouverture, corps] of html.matchAll(/(<section class="etape\b[^"]*"[^>]*>)([\s\S]*?)<\/section>/g)) {
    const titre = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/.exec(corps)
    if (!titre) continue
    const complet = texte(titre[2])
    const numero = /^(\d+)\.\s*(.*)$/.exec(complet)
    const statut = /<span class="statut([^"]*)">([\s\S]*?)<\/span>/.exec(corps)
    const img = /<img\b[^>]*>/.exec(corps)?.[0]
    const src = img ? attribut(img, 'src') : null
    etapes.push({
      n: numero ? Number(numero[1]) : null,
      ancre: titre[1],
      titre: numero ? numero[2] : complet,
      categorie: attribut(ouverture, 'data-cat') ?? 'site',
      statut: statut ? texte(statut[2]) : '',
      fait: statut ? /\bfait\b/.test(statut[1]) : false,
      pr: Number(/PR #(\d+)/.exec(statut?.[2] ?? '')?.[1]) || null,
      image: img && src ? { src, largeur: Number(attribut(img, 'width')) || 0, hauteur: Number(attribut(img, 'height')) || 0 } : null,
    })
  }
  // Le journal met les plus récentes en haut : la salle les accroche dans l'ordre du chantier.
  return { categories, etapes: etapes.reverse() }
}
