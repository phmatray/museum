/**
 * Le câblage du carnet de tampons (domain/succes.ts) : l'état du jeu (etat.ts)
 * devient des faits, les faits des tampons, et le carnet reste dans le
 * navigateur (localStorage 'museum:carnet' ; rien ne quitte le visiteur).
 *
 * Les gestes que l'état ne publie pas (une étoile, un partage, la fin de la
 * visite guidée) arrivent par `signaler`. Rien n'est noté avant le compostage :
 * le billet ouvert, on regarde le hall, on ne le visite pas encore.
 */
import { createStore } from 'zustand/vanilla'

import { CARNET_VIDE, jourDe, saisonDe, noter, relire, tamponner, type Carnet, type Contexte, type Fait, type Geste, type Lieu, type Succes } from '../domain/succes.ts'
import { EMPRISE_BELVEDERE } from '../plan/belvedere.ts'
import { EMPRISE_CHANTIER } from '../plan/chantier.ts'
import type { Accrochage } from '../plan/hang.ts'
import { presDeLEau } from '../plan/jardin.ts'
import { MUSEE } from '../plan/musee.ts'
import { PARC } from '../plan/rules.ts'
import type { Rect } from '../plan/types.ts'
import type { Walker } from '../plan/walk.ts'
import { etat, partie, vivant } from './etat.ts'

const CLE = 'museum:carnet'
/** Mètres du bord de l'étang où l'on « s'arrête au bord de l'eau ». */
const BORD_DE_L_EAU = 2.5
/** Le jour sous ce seuil : la nuit (crépuscule civil compris à moitié). */
const NUIT = 0.25
/** Pluie ou neige au-dessus de ce seuil : on est venu par mauvais temps. */
const INTEMPERIE = 0.2

/** Les salles d'exposition (galeries et salle d'honneur : les 14 du billet ; ni le hall, ni les balcons), en `<niveau>:<salle>` comme `Walker.surface`. */
const SALLES = new Set(MUSEE.levels.flatMap((l) => l.rooms.filter((r) => r.kind === 'gallery' || r.kind === 'honneur').map((r) => `${l.id}:${r.id}`)))

function lire(): Carnet {
  try {
    const brut = localStorage.getItem(CLE)
    return brut ? relire(JSON.parse(brut)) : CARNET_VIDE
  } catch {
    return CARNET_VIDE
  }
}

/** Le carnet vivant, que l'interface (ui/carnet.ts) suit ; `contexte` arrive avec l'accrochage. */
export const carnet = createStore<{ carnet: Carnet; contexte: Contexte }>(() => ({ carnet: lire(), contexte: { salles: SALLES.size, oeuvres: 0 } }))

const ecouteurs = new Set<(s: Succes) => void>()
/** Appelé à chaque tampon frappé (la bannière) ; rend le désabonnement. */
export function auTampon(f: (s: Succes) => void): () => void {
  ecouteurs.add(f)
  return () => ecouteurs.delete(f)
}

let composte = false

function noterFait(f: Fait): void {
  if (!composte && !(f.type === 'geste' && f.id === 'composte')) return
  const { carnet: avant, contexte } = carnet.getState()
  const apres = noter(avant, f)
  if (apres === avant) return
  const { carnet: frappe, nouveaux } = tamponner(apres, contexte, jourDe(new Date()))
  carnet.setState({ carnet: frappe })
  try {
    localStorage.setItem(CLE, JSON.stringify(frappe))
  } catch {
    // Stockage refusé (navigation privée) : le carnet vit le temps de la visite.
  }
  for (const s of nouveaux) for (const e of ecouteurs) e(s)
}

/** Un geste que l'état ne publie pas (étoile, partage, fin de visite). */
export const signaler = (id: Geste): void => noterFait({ type: 'geste', id })

const dans = (r: Rect, x: number, z: number) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth

/** Les lieux du dehors où se tient le visiteur. */
export function lieuxDe(w: Walker): Lieu[] {
  if (w.surface !== PARC) return []
  const lieux: Lieu[] = ['jardin']
  if (EMPRISE_BELVEDERE.some((r) => dans(r, w.x, w.z))) lieux.push('belvedere')
  if (presDeLEau(w.x, w.z, BORD_DE_L_EAU)) lieux.push('etang')
  if (dans(EMPRISE_CHANTIER, w.x, w.z)) lieux.push('chantier')
  return lieux
}

/** Branche le carnet sur l'état du jeu ; `enVitrine` complète le compte des œuvres. */
export function monterSucces(accrochage: Accrochage | null, enVitrine: number): void {
  const oeuvres = (accrochage?.rooms.reduce((n, r) => n + r.placements.length, 0) ?? 0) + enVitrine
  carnet.setState({ contexte: { salles: SALLES.size, oeuvres: accrochage ? oeuvres : 0 } })

  const ciel = () => {
    if (!composte || partie.getState().paused) return
    const { ciel: c, meteo } = vivant.getState()
    if (c.jour < NUIT) signaler('nuit')
    if (meteo.pluie > INTEMPERIE || meteo.neige > INTEMPERIE) signaler('intemperies')
  }

  let annonce = etat.annonce?.at ?? 0
  partie.subscribe((s, a) => {
    if (!s.paused && a.paused && !composte) {
      composte = true
      signaler('composte')
      noterFait({ type: 'jour', date: jourDe(new Date()), saison: saisonDe(new Date()) })
      ciel()
    }
    if (!composte) return
    if (s.visiteur && s.visiteur !== a.visiteur) {
      if (SALLES.has(s.visiteur.surface)) noterFait({ type: 'salle', id: s.visiteur.surface.split(':')[1] })
      for (const id of lieuxDe(s.visiteur)) noterFait({ type: 'lieu', id })
    }
    if (s.toile && s.toile !== a.toile) noterFait({ type: 'oeuvre', cle: s.toile })
    if (s.borne && s.borne !== a.borne) {
      noterFait({ type: 'oeuvre', cle: s.borne })
      signaler('borne')
    }
    if (s.etape && s.etape !== a.etape) signaler('journal')
    if (s.bavette && !a.bavette) signaler('bavette')
    if (s.enVR && !a.enVR) signaler('vr')
    if (s.paused !== a.paused) ciel()
  })
  vivant.subscribe(ciel)
  // La cloche (etat.annonce, sondée comme le tableau des départs) : entendue dans le hall.
  setInterval(() => {
    const at = etat.annonce?.at ?? 0
    if (at === annonce) return
    annonce = at
    if (composte && partie.getState().visiteur?.surface === '0:hall') signaler('cloche')
  }, 1000)
}
