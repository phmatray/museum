/**
 * Un lien vers un endroit précis : l'adresse qui ouvre le musée devant une
 * toile, et celle qu'on partage.
 *
 * Trois écritures sont lues : `?projet=<owner>/<repo>`, la courte `?p=<repo>`,
 * et `#<repo>` — un fragment survit à GitHub Pages et à la plupart des
 * messageries, mais certaines le rognent ; la requête est la plus sûre, c'est
 * donc elle qu'on écrit. La casse ne compte pas, le propriétaire est facultatif.
 *
 * Pur, sans import d'exécution : `tools/pages-partage.ts` le charge sous Node.
 */

/** Le projet que demande l'adresse, tel qu'écrit ; `null` si elle n'en demande pas. */
export function projetDemande(search: string, hash = ''): string | null {
  const q = new URLSearchParams(search)
  // Un fragment se lit comme une valeur de requête : `%` mal formé compris, sans lever.
  const brut = q.get('projet') ?? q.get('p') ?? (hash.length > 1 ? new URLSearchParams(`x=${hash.slice(1)}`).get('x') : null)
  const d = brut?.trim().replace(/^\/+|\/+$/g, '')
  return d ? d : null
}

const nom = (cle: string) => cle.slice(cle.indexOf('/') + 1)

/**
 * La clé exposée que désigne une demande, ou `null`. `owner/repo` exact d'abord,
 * sinon par nom de dépôt ; deux dépôts du même nom (`.github`) : celui du
 * premier propriétaire du musée.
 */
export function resoudre(demande: string, cles: readonly string[], owners: readonly string[] = []): string | null {
  const d = demande.toLowerCase()
  const exacte = cles.find((c) => c.toLowerCase() === d)
  if (exacte) return exacte
  const n = d.slice(d.lastIndexOf('/') + 1)
  const rang = (c: string) => {
    const i = owners.findIndex((o) => c.toLowerCase().startsWith(`${o.toLowerCase()}/`))
    return i < 0 ? owners.length : i
  }
  return cles.filter((c) => nom(c).toLowerCase() === n).sort((a, b) => rang(a) - rang(b))[0] ?? null
}

/** Le nom court d'un projet dans une adresse : son nom de dépôt s'il est seul à le porter, sinon `owner/repo`. */
export function identifiant(cle: string, cles: readonly string[]): string {
  const n = nom(cle).toLowerCase()
  return cles.filter((c) => nom(c).toLowerCase() === n).length > 1 ? cle : nom(cle)
}

/**
 * Le projet a sa page de partage (`p/<nom>/`, écrite au build) : un nom simple.
 * Pas de `owner/repo`, et pas de nom en point : `upload-pages-artifact` écarte
 * les dossiers cachés.
 */
export const aSaPage = (id: string) => /^[^./][^/]*$/.test(id)

/**
 * L'adresse à partager, sous `base` (l'origine plus le chemin du site). Avec
 * `pages`, la page de partage du projet, qui porte son propre aperçu
 * OpenGraph et renvoie au musée ; sinon, le musée directement.
 */
export function lienVers(cle: string, cles: readonly string[], base: string, pages: boolean): string {
  const id = identifiant(cle, cles)
  const racine = base.endsWith('/') ? base : `${base}/`
  if (pages && aSaPage(id)) return `${racine}p/${encodeURIComponent(id)}/`
  return `${racine}?p=${id.split('/').map(encodeURIComponent).join('/')}`
}
