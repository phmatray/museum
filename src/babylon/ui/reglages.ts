/**
 * Les réglages (Reglages.tsx), en DOM natif : une roue dentée (ou la touche R)
 * ouvre un petit carton du même papier que le billet d'entrée, accroché sous
 * les boutons ; sur un téléphone, il monte du bas de l'écran.
 *
 * Il ne fait qu'écrire les réglages (`changerReglages`, etat.ts) là où chaque
 * système les lit : le cycle de l'état vivant republie le ciel, la saison et la
 * météo ; le visiteur relit le champ, la sensibilité et l'axe ; soleil.ts les
 * ombres, qualite.ts la densité. Un paramètre de l'adresse l'emporte : son
 * réglage est alors grisé, avec le paramètre qui l'impose.
 *
 * Ouvert pendant la marche, il rend la souris (le musée se met en pause) ;
 * refermé d'un clic, il la reprend et la marche continue. Refermé à Échap,
 * le navigateur ne permet pas de la reprendre : on retrouve le billet.
 */
import '@fontsource/marcellus/latin-400.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import './reglages.css'

import { BORNES, DEFAUTS, METEOS, SAISONS, heureTexte, type Reglages as R } from '../../domain/reglages.ts'
import { changerReglages as regler, partie, reglages } from '../etat.ts'
import { el, observer, svg } from './dom.ts'

const NOMS_METEO: Record<(typeof METEOS)[number], string> = { clair: 'Clair', pluie: 'Pluie', neige: 'Neige', brouillard: 'Brouillard', orage: 'Orage' }
const NOMS_SAISON: Record<(typeof SAISONS)[number], string> = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' }

/** Le paramètre de l'adresse qui impose ce réglage, s'il y en a un (l'adresse brute, pas `recherche()`). */
const impose = (cle: string) => new URLSearchParams(location.search).get(cle)

let n = 0
const unId = () => `reglages-${++n}`

function interrupteur(texte: (Node | string)[], change: (v: boolean) => void, disabled = false) {
  const id = unId()
  const input = el('input', { id, type: 'checkbox', role: 'switch', disabled })
  input.addEventListener('change', () => change(input.checked))
  return { bloc: el('div', { class: 'reglages-ligne' }, el('label', { for: id }, ...texte), input), input }
}

function glissiere(texte: string, [min, max]: readonly [number, number], pas: number, change: (v: number) => void) {
  const id = unId()
  const sortie = el('output', { for: id })
  const input = el('input', { id, type: 'range', min, max, step: pas })
  input.addEventListener('input', () => change(Number(input.value)))
  return {
    bloc: el('div', {}, el('div', { class: 'reglages-ligne' }, el('label', { for: id }, texte), sortie), input),
    maj(v: number, t: string) {
      input.value = String(v)
      sortie.textContent = t
      input.setAttribute('aria-valuetext', t)
    },
  }
}

function choix<T extends string>(legende: string, options: readonly (readonly [T, string])[], change: (v: T) => void, disabled = false) {
  const nom = unId()
  const radios = options.map(([v, texte]) => {
    const r = el('input', { type: 'radio', name: nom, value: v })
    r.addEventListener('change', () => change(v))
    return [el('label', {}, r, texte), r] as const
  })
  return {
    bloc: el('fieldset', { disabled }, el('legend', {}, legende), el('div', { class: 'reglages-choix' }, ...radios.map(([l]) => l))),
    maj: (v: T) => radios.forEach(([, r]) => (r.checked = r.value === v)),
  }
}

function liste(texte: string, options: [string, string][], valeur: string | null, change: (v: string) => void) {
  const id = unId()
  const s = el('select', { id, disabled: valeur !== null }, ...options.map(([v, t]) => el('option', { value: v }, t)))
  s.addEventListener('change', () => change(s.value))
  return { bloc: el('div', { class: 'reglages-ligne' }, el('label', { for: id }, texte), s), s }
}

/** « Imposé par l'adresse : ?cle=v », ou rien. */
function note(cle: string) {
  const v = impose(cle)
  return v === null ? null : el('p', { class: 'reglages-note' }, 'Imposé par l’adresse : ', el('code', {}, `?${cle}=${v}`))
}

/**
 * La roue et le carton, dans le groupe fixe en haut à droite (la roue, puis
 * `o.son.bouton`) qui descend d'un cran pendant la visite guidée. `toile` :
 * la souris y est reprise quand on referme d'un clic.
 */
export function monterReglages(racine: HTMLElement, o: {
  toile: HTMLCanvasElement
  son: { bouton: HTMLElement; actif(): boolean; basculer(): void; abonner(f: () => void): () => void }
}): void {
  const titre = unId()
  const idCarton = unId()

  // Son.
  const son = interrupteur(['Son de l’ambiance', el('kbd', {}, 'M')], () => o.son.basculer())
  const volume = glissiere('Volume', BORNES.volume, 0.05, (volume) => regler({ volume }))

  // Image. Les ombres n'ont pas de note dans three : on garde l'écart.
  const qualiteImposee = impose('qualite') as R['qualite'] | null
  const qualite = choix('Qualité', [['auto', 'Auto'], ['haute', 'Haute'], ['basse', 'Basse']], (qualite) => regler({ qualite }), qualiteImposee !== null)
  const ombresImposees = impose('ombres')
  const ombres = interrupteur(['Ombres du soleil'], (ombres) => regler({ ombres }), ombresImposees !== null)
  const champ = glissiere('Champ de vision', BORNES.champ, 1, (champ) => regler({ champ }))

  // Regard.
  const sensibilite = glissiere('Sensibilité de la souris', BORNES.sensibilite, 0.05, (sensibilite) => regler({ sensibilite }))
  const inverserY = interrupteur(['Inverser l’axe vertical'], (inverserY) => regler({ inverserY }))
  const plan = interrupteur(['Afficher le plan'], (plan) => regler({ plan }))
  const mouvement = choix('Mouvement', [['systeme', 'Comme l’appareil'], ['reduit', 'Réduit'], ['normal', 'Normal']], (mouvement) => regler({ mouvement }))

  // Heure et météo.
  const heureImposee = impose('heure') !== null
  const heure = choix('Heure', [['reelle', 'Réelle'], ['choisie', 'Choisie']], (v) => {
    const d = new Date()
    regler({ heure: v === 'reelle' ? null : Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15 % (24 * 60) })
  }, heureImposee)
  const aLHeure = glissiere('À l’heure de', BORNES.heure, 15, (heure) => regler({ heure }))
  const meteo = liste('Temps', [['', 'Réel (Bruxelles)'], ...METEOS.map((m): [string, string] => [m, NOMS_METEO[m]])], impose('meteo'), (v) => regler({ meteo: (v || null) as R['meteo'] }))
  const saison = liste('Saison', [['', 'Réelle'], ...SAISONS.map((s): [string, string] => [s, NOMS_SAISON[s]])], impose('saison'), (v) => regler({ saison: (v || null) as R['saison'] }))

  const retablir = el('button', { type: 'button', class: 'reglages-retablir' }, 'Rétablir')
  retablir.addEventListener('click', () => regler(DEFAUTS))
  const fermerX = el('button', { type: 'button', class: 'reglages-fermer', 'aria-label': 'Fermer les réglages' },
    svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, svg('path', { d: 'M3 3l10 10M13 3L3 13' })))
  fermerX.addEventListener('click', () => fermer(true))

  const carton = el('div', { id: idCarton, class: 'reglages', role: 'dialog', 'aria-labelledby': titre, hidden: true },
    el('header', {}, el('h2', { id: titre }, 'Réglages'), fermerX),
    el('section', { 'aria-label': 'Son' }, el('h3', {}, 'Son'), son.bloc, volume.bloc),
    el('section', { 'aria-label': 'Image' }, el('h3', {}, 'Image'), qualite.bloc, note('qualite'), ombres.bloc, champ.bloc),
    el('section', { 'aria-label': 'Regard et affichage' }, el('h3', {}, 'Regard'), sensibilite.bloc, inverserY.bloc, plan.bloc, mouvement.bloc),
    el('section', { 'aria-label': 'Heure et météo' }, el('h3', {}, 'Heure et météo'),
      heure.bloc, aLHeure.bloc, note('heure'), meteo.bloc, note('meteo'), saison.bloc, note('saison')),
    el('footer', {}, retablir, el('p', { class: 'reglages-note' }, 'Retenus sur cet appareil.')),
  )
  // Les touches et les clics restent au carton : ni la marche, ni M, ni Entrée du billet.
  carton.addEventListener('keydown', (e) => e.stopPropagation())
  carton.addEventListener('click', (e) => e.stopPropagation())

  const roue = el('button', { type: 'button', class: 'reglages-bouton', 'aria-label': 'Réglages', 'aria-expanded': 'false', title: 'Réglages (R)' },
    svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      svg('circle', { cx: 12, cy: 12, r: 3 }),
      svg('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })))
  const groupe = el('div', { class: 'reglages-groupe' }, roue, o.son.bouton, carton)
  racine.append(groupe)

  let ouvert = false
  /** La souris était capturée à l'ouverture : on la reprendra en refermant. */
  let reprendre = false
  const montrer = (v: boolean) => {
    ouvert = v
    carton.hidden = !v
    roue.setAttribute('aria-expanded', String(v))
    if (v) roue.setAttribute('aria-controls', idCarton)
    else roue.removeAttribute('aria-controls')
  }
  const ouvrir = () => {
    reprendre = !!document.pointerLockElement
    if (reprendre) document.exitPointerLock()
    montrer(true)
    carton.querySelector<HTMLElement>('input, select, button:not(.reglages-fermer)')?.focus()
  }
  function fermer(geste: boolean) {
    montrer(false)
    if (reprendre && geste) {
      // Le clic qui referme est un geste : le navigateur rend la souris.
      Promise.resolve(o.toile.requestPointerLock?.()).catch(() => {})
      partie.setState({ paused: false })
    } else roue.focus()
    reprendre = false
  }
  roue.addEventListener('click', (e) => {
    e.stopPropagation()
    if (ouvert) fermer(true)
    else ouvrir()
  })

  // R ouvre et referme, même en pleine marche ; Échap referme (en capture) avant
  // que la visite guidée ou le plan plein écran ne l'entendent.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement)) {
      if (ouvert) fermer(false)
      else ouvrir()
    } else if (ouvert && e.key === 'Escape') {
      e.stopPropagation()
      fermer(false)
    }
  }, true)

  observer(partie, (p) => p.tourActive, (tour) => {
    const haut = tour ? '4rem' : '1rem'
    groupe.style.top = haut
    carton.style.top = `calc(${haut} + 48px)`
    carton.style.maxHeight = `calc(100vh - ${haut} - 64px)`
  })

  const majSon = () => (son.input.checked = o.son.actif())
  majSon()
  o.son.abonner(majSon)

  observer(reglages, (r) => r, (r) => {
    volume.maj(r.volume, `${Math.round(r.volume * 100)} %`)
    qualite.maj(qualiteImposee ?? r.qualite)
    ombres.input.checked = ombresImposees === null ? r.ombres : ombresImposees !== '0'
    champ.maj(r.champ, `${r.champ}°`)
    sensibilite.maj(r.sensibilite, `× ${r.sensibilite.toFixed(2).replace('.', ',')}`)
    inverserY.input.checked = r.inverserY
    plan.input.checked = r.plan
    mouvement.maj(r.mouvement)
    heure.maj(r.heure === null && !heureImposee ? 'reelle' : 'choisie')
    aLHeure.bloc.hidden = r.heure === null || heureImposee
    if (r.heure !== null) aLHeure.maj(r.heure, heureTexte(r.heure))
    meteo.s.value = impose('meteo') ?? r.meteo ?? ''
    saison.s.value = impose('saison') ?? r.saison ?? ''
  })
}
