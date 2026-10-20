/**
 * Le carnet de tampons du visiteur : ce qu'il a fait (salles foulées, œuvres
 * regardées, jours de visite…) et les tampons que ces faits lui valent.
 *
 * Pur : `noter(carnet, fait)` rend un nouveau carnet, `tamponner(carnet, ctx, date)`
 * y frappe les tampons nouvellement mérités et les rend. Le câblage (babylon/succes.ts)
 * traduit l'état du jeu en faits ; la persistance (localStorage) vit là-bas aussi.
 */

/** Ce que le jeu signale au carnet. */
export type Fait =
  | { type: 'salle'; id: string }
  | { type: 'lieu'; id: Lieu }
  | { type: 'oeuvre'; cle: string }
  | { type: 'jour'; date: string; saison: string }
  | { type: 'geste'; id: Geste }

export type Lieu = 'jardin' | 'belvedere' | 'etang' | 'chantier'
export type Geste = 'composte' | 'borne' | 'journal' | 'etoile' | 'partage' | 'visite' | 'nuit' | 'intemperies' | 'cloche' | 'bavette' | 'vr' | 'cinema'

export interface Carnet {
  version: 1
  salles: string[]
  lieux: string[]
  oeuvres: string[]
  jours: string[]
  saisons: string[]
  gestes: string[]
  /** Identifiant du tampon → date ISO (AAAA-MM-JJ) de sa frappe. */
  tampons: Record<string, string>
}

export const CARNET_VIDE: Carnet = { version: 1, salles: [], lieux: [], oeuvres: [], jours: [], saisons: [], gestes: [], tampons: {} }

/** Ce que le carnet ne sait pas seul : le nombre de salles et d'œuvres accrochées. */
export interface Contexte { salles: number; oeuvres: number }

export type Famille = 'Découverte' | 'Regard' | 'Temps et monde' | 'Secrets'

export interface Succes {
  id: string
  famille: Famille
  titre: string
  /** Ce qui l'a valu, lu une fois le tampon frappé. */
  texte: string
  /** Ce qu'on en dit tant qu'il manque (les secrets restent des devinettes). */
  indice: string
  /** [fait, à faire] : mérité quand fait ≥ à faire. */
  progres: (c: Carnet, ctx: Contexte) => [number, number]
}

const a = (liste: string[], id: string): [number, number] => [liste.includes(id) ? 1 : 0, 1]
const compte = (liste: string[], but: number): [number, number] => [Math.min(liste.length, but), but]

export const SUCCES: readonly Succes[] = [
  { id: 'composte', famille: 'Découverte', titre: 'Billet composté', texte: 'Vous êtes entré au musée.', indice: 'Tout commence au guichet.', progres: (c) => a(c.gestes, 'composte') },
  { id: 'flaneur', famille: 'Découverte', titre: 'Flâneur', texte: 'Cinq salles parcourues.', indice: 'Passez de salle en salle.', progres: (c) => compte(c.salles, 5) },
  { id: 'arpenteur', famille: 'Découverte', titre: 'Arpenteur', texte: 'Toutes les salles du musée parcourues.', indice: 'Chaque salle, sans exception, aux deux étages.', progres: (c, x) => compte(c.salles, x.salles) },
  { id: 'honneur', famille: 'Découverte', titre: 'Salle d’honneur', texte: 'Vous avez gravi le grand escalier jusqu’à la salle d’honneur.', indice: 'Le grand escalier mène quelque part.', progres: (c) => a(c.salles, 'honneur') },
  { id: 'jardin', famille: 'Découverte', titre: 'Prendre l’air', texte: 'Vous êtes sorti au jardin.', indice: 'Le musée a un dehors.', progres: (c) => a(c.lieux, 'jardin') },
  { id: 'belvedere', famille: 'Découverte', titre: 'Belvédère', texte: 'Vous avez vu le jardin d’en haut.', indice: 'Au fond du jardin, des marches montent.', progres: (c) => a(c.lieux, 'belvedere') },
  { id: 'etang', famille: 'Découverte', titre: 'Au bord de l’eau', texte: 'Vous vous êtes arrêté au bord de l’étang.', indice: 'Suivez le bruit de l’eau.', progres: (c) => a(c.lieux, 'etang') },
  { id: 'chantier', famille: 'Découverte', titre: 'Visite de chantier', texte: 'Vous êtes entré dans la baraque du chantier.', indice: 'On construit encore, quelque part dehors.', progres: (c) => a(c.lieux, 'chantier') },

  { id: 'amateur', famille: 'Regard', titre: 'Amateur', texte: 'Dix œuvres regardées de près.', indice: 'Approchez-vous des tableaux.', progres: (c) => compte(c.oeuvres, 10) },
  { id: 'connaisseur', famille: 'Regard', titre: 'Connaisseur', texte: 'Cinquante œuvres regardées.', indice: 'Encore beaucoup de tableaux à voir.', progres: (c) => compte(c.oeuvres, 50) },
  { id: 'exhaustif', famille: 'Regard', titre: 'Catalogue raisonné', texte: 'Toutes les œuvres du musée regardées.', indice: 'Toutes. Vraiment toutes.', progres: (c, x) => compte(c.oeuvres, x.oeuvres) },
  { id: 'borne', famille: 'Regard', titre: 'Lecteur', texte: 'Vous avez consulté une borne des vitrines.', indice: 'Certaines œuvres ont plus à raconter.', progres: (c) => a(c.gestes, 'borne') },
  { id: 'journal', famille: 'Regard', titre: 'Journal de bord', texte: 'Vous avez lu une étape du journal du chantier.', indice: 'Le chantier tient son journal.', progres: (c) => a(c.gestes, 'journal') },
  { id: 'etoile', famille: 'Regard', titre: 'Mécène', texte: 'Vous avez offert une étoile à un projet.', indice: 'Un projet vous plaît ? Dites-le.', progres: (c) => a(c.gestes, 'etoile') },
  { id: 'partage', famille: 'Regard', titre: 'Ambassadeur', texte: 'Vous avez partagé un tableau.', indice: 'Un tableau se partage.', progres: (c) => a(c.gestes, 'partage') },
  { id: 'visite', famille: 'Regard', titre: 'Suivez le guide', texte: 'Vous avez suivi la visite guidée jusqu’au bout.', indice: 'Le billet propose une visite guidée.', progres: (c) => a(c.gestes, 'visite') },

  { id: 'nuit', famille: 'Temps et monde', titre: 'Noctambule', texte: 'Vous avez visité le musée de nuit.', indice: 'Le musée ne ferme jamais.', progres: (c) => a(c.gestes, 'nuit') },
  { id: 'intemperies', famille: 'Temps et monde', titre: 'Par tous les temps', texte: 'Vous êtes venu sous la pluie ou la neige.', indice: 'Le ciel du musée est celui de Bruxelles.', progres: (c) => a(c.gestes, 'intemperies') },
  { id: 'cloche', famille: 'Temps et monde', titre: 'À l’heure juste', texte: 'Vous étiez dans le hall quand la cloche a sonné.', indice: 'L’horloge du hall a une voix.', progres: (c) => a(c.gestes, 'cloche') },
  { id: 'fidele', famille: 'Temps et monde', titre: 'Habitué', texte: 'Trois jours de visite.', indice: 'Revenez un autre jour.', progres: (c) => compte(c.jours, 3) },
  { id: 'saisons', famille: 'Temps et monde', titre: 'Quatre saisons', texte: 'Vous avez vu le jardin à chaque saison.', indice: 'Le jardin change avec l’année.', progres: (c) => compte(c.saisons, 4) },

  { id: 'bavette', famille: 'Secrets', titre: 'Bavette', texte: 'Vous avez croisé le regard du chat du musée.', indice: 'Quelqu’un d’autre habite ici.', progres: (c) => a(c.gestes, 'bavette') },
  { id: 'cinema', famille: 'Secrets', titre: 'Séance tenante', texte: 'Vous avez vu le film du cinéma du sous-sol.', indice: 'Sous l’escalier, on projette quelque chose.', progres: (c) => a(c.gestes, 'cinema') },
  { id: 'vr', famille: 'Secrets', titre: 'Ailleurs', texte: 'Vous avez visité le musée en réalité virtuelle.', indice: 'Il existe une autre façon d’entrer.', progres: (c) => a(c.gestes, 'vr') },
]

const ajouter = (liste: string[], v: string) => (liste.includes(v) ? liste : [...liste, v])

/** Le carnet après un fait (le même objet si le fait n'apprend rien). */
export function noter(c: Carnet, f: Fait): Carnet {
  switch (f.type) {
    case 'salle': return c.salles.includes(f.id) ? c : { ...c, salles: ajouter(c.salles, f.id) }
    case 'lieu': return c.lieux.includes(f.id) ? c : { ...c, lieux: ajouter(c.lieux, f.id) }
    case 'oeuvre': return c.oeuvres.includes(f.cle) ? c : { ...c, oeuvres: ajouter(c.oeuvres, f.cle) }
    case 'geste': return c.gestes.includes(f.id) ? c : { ...c, gestes: ajouter(c.gestes, f.id) }
    case 'jour': {
      if (c.jours.includes(f.date) && c.saisons.includes(f.saison)) return c
      return { ...c, jours: ajouter(c.jours, f.date), saisons: ajouter(c.saisons, f.saison) }
    }
  }
}

export const merite = (s: Succes, c: Carnet, ctx: Contexte): boolean => {
  const [fait, but] = s.progres(c, ctx)
  return but > 0 && fait >= but
}

/** Frappe les tampons nouvellement mérités ; rend le carnet et ces tampons (dans l'ordre du carnet). */
export function tamponner(c: Carnet, ctx: Contexte, date: string): { carnet: Carnet; nouveaux: Succes[] } {
  const nouveaux = SUCCES.filter((s) => !c.tampons[s.id] && merite(s, c, ctx))
  if (nouveaux.length === 0) return { carnet: c, nouveaux }
  const tampons = { ...c.tampons }
  for (const s of nouveaux) tampons[s.id] = date
  return { carnet: { ...c, tampons }, nouveaux }
}

/** Relit un carnet stocké : tout champ absent ou mal formé repart vide (un carnet abîmé ne casse pas la visite). */
export function relire(brut: unknown): Carnet {
  if (!brut || typeof brut !== 'object') return CARNET_VIDE
  const o = brut as Record<string, unknown>
  const liste = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const tampons: Record<string, string> = {}
  if (o.tampons && typeof o.tampons === 'object') {
    for (const [k, v] of Object.entries(o.tampons)) if (typeof v === 'string') tampons[k] = v
  }
  return { version: 1, salles: liste(o.salles), lieux: liste(o.lieux), oeuvres: liste(o.oeuvres), jours: liste(o.jours), saisons: liste(o.saisons), gestes: liste(o.gestes), tampons }
}

/** AAAA-MM-JJ, à l'heure locale du visiteur. */
export const jourDe = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** La saison du calendrier (météorologique : par trimestres de mois), pour « Quatre saisons ». */
export const saisonDe = (d: Date): string => ['hiver', 'printemps', 'ete', 'automne'][Math.floor(((d.getMonth() + 1) % 12) / 3)]
