/**
 * L'accueil : un billet d'entrée. Orsay était une gare ; on entre au musée
 * comme on montait dans un train, en compostant son billet.
 *
 * Le billet est imprimé du vrai musée (`domain/billet.ts`) : le nombre
 * d'œuvres et de salles de l'accrochage du jour, la date et l'heure de la
 * visite, le numéro de visiteur du compteur de l'entrée. « Composter et
 * entrer » frappe le talon à l'heure, puis le billet s'efface sur la nef.
 * La visite guidée est l'autre manière d'entrer, avec le même geste.
 */
import { useEffect, useState } from 'react'
import '@fontsource/marcellus/latin-400.css'
import '@fontsource/marcellus/latin-ext-400.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-ext-400.css'

import config from '../../museum.config.json'
import { billet } from '../domain/billet'
import { heureDemandee } from '../domain/soleil'
import { useAccrochage } from '../hooks/useAccrochage'
import { useVitrines } from '../hooks/useCatalogue'
import { laVisite } from '../io/visite'
import { useGameStore } from '../stores/gameStore'
import { mouvementReduit, recherche } from '../stores/reglagesStore'

/** Le temps du coup de composteur, puis celui du billet qui s'efface (ms). */
const COUP = 260
const EFFACEMENT = 520
/** Le temps de lire le coup de tampon avant que le billet ne s'efface (ms). */
const LECTURE = 380

const auDoigt = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const STYLE = `
.billet-voile { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
  background: radial-gradient(ellipse at center, rgba(12,15,20,.55) 0%, rgba(12,15,20,.28) 55%, rgba(12,15,20,.08) 100%);
  transition: opacity ${EFFACEMENT}ms cubic-bezier(.16,1,.3,1); }
.billet-voile[data-sortie] { opacity: 0; pointer-events: none; transition-delay: ${COUP + LECTURE}ms; }
.billet { --papier: #f4ecda; --encre: #1c2530; --encre-2: #4a4f55; --or: #a97c26; --filet: rgba(28,37,48,.18);
  position: relative; width: min(680px, 100%); display: grid; grid-template-columns: 1fr 172px;
  color: var(--encre); font: 400 16px/1.5 "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  background: linear-gradient(175deg, #f8f2e4 0%, var(--papier) 60%, #ece1c8 100%);
  border-radius: 6px; box-shadow: 0 30px 70px -18px rgba(0,0,0,.6), 0 3px 8px rgba(0,0,0,.28);
  /* Les deux encoches de la perforation, découpées dans le carton. */
  -webkit-mask: radial-gradient(circle 11px at calc(100% - 172px) 0, #0000 98%, #000) top / 100% 51% no-repeat,
                radial-gradient(circle 11px at calc(100% - 172px) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
          mask: radial-gradient(circle 11px at calc(100% - 172px) 0, #0000 98%, #000) top / 100% 51% no-repeat,
                radial-gradient(circle 11px at calc(100% - 172px) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  transition: transform ${EFFACEMENT}ms cubic-bezier(.16,1,.3,1); }
.billet-voile[data-sortie] .billet { transform: translateY(18px) scale(.985); transition-delay: ${COUP + LECTURE}ms; }
.billet ::selection { background: #d1a54a; color: var(--encre); }
.billet-corps { padding: 34px 36px 28px; display: grid; gap: 22px; }
.billet h1 { font: 400 clamp(34px, 6vw, 46px)/1.02 Marcellus, Georgia, serif; letter-spacing: .01em; margin: 0; text-wrap: balance; }
.billet-accroche { margin: 8px 0 0; color: var(--encre-2); font-size: 17px; max-width: 42ch; text-wrap: pretty; }
.billet dl { margin: 0; padding-top: 18px; border-top: 1px solid var(--filet); display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; }
.billet dt { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--encre-2); padding-top: 3px; }
.billet dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.billet dd.destination { font: 400 20px/1.2 Marcellus, Georgia, serif; color: var(--or); }
.billet-absent { margin: 0; color: var(--encre-2); font-size: 15px; }
.billet-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.billet button { font: 600 16px/1 "Source Sans 3", system-ui, sans-serif; min-height: 46px; padding: 0 20px; border-radius: 4px; cursor: pointer;
  transition: background-color .15s, color .15s, box-shadow .15s, transform .1s; }
.billet button:active { transform: translateY(1px); }
.billet button:focus-visible { outline: 2px solid var(--or); outline-offset: 3px; }
.billet-entrer { background: var(--encre); color: var(--papier); border: 1px solid var(--encre); box-shadow: 0 2px 0 rgba(0,0,0,.25); }
.billet-entrer:hover { background: #2b3747; }
.billet-guide { background: transparent; color: var(--encre); border: 1px solid rgba(28,37,48,.45); }
.billet-guide:hover { background: rgba(28,37,48,.07); }
.billet-consignes { margin: 0; font-size: 13px; color: var(--encre-2); }
.billet-consignes kbd { font: 600 11px/1 "Source Sans 3", system-ui, sans-serif; padding: 2px 5px; border: 1px solid var(--filet); border-bottom-width: 2px; border-radius: 3px; background: rgba(255,255,255,.45); }
.billet-talon { position: relative; border-left: 2px dashed rgba(28,37,48,.28); padding: 34px 20px 28px; display: grid; align-content: space-between; gap: 18px; text-align: center; }
.billet-talon .entree { font: 400 22px/1 Marcellus, Georgia, serif; letter-spacing: .22em; margin-right: -.22em; }
.billet-talon .tarif { margin: 6px 0 0; font-size: 13px; color: var(--encre-2); }
.billet-talon .no { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--encre-2); }
.billet-talon .numero { display: block; margin-top: 2px; font: 600 26px/1 "Source Sans 3", system-ui, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: .06em; }
.billet-compostage { border: 1px dashed rgba(28,37,48,.22); border-radius: 3px; min-height: 64px; display: grid; place-items: end center; padding-bottom: 6px;
  font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: rgba(28,37,48,.4); }
.billet[data-composte] .billet-compostage { color: transparent; }
.billet-tampon { position: absolute; left: 50%; top: 50%; translate: -50% -50%; rotate: -9deg; padding: 7px 10px 6px; border: 2px solid currentColor; border-radius: 3px;
  color: #5a3b8f; font: 600 12px/1.25 "Source Sans 3", system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap;
  mix-blend-mode: multiply; opacity: 0; pointer-events: none; }
.billet-tampon span { display: block; font-variant-numeric: tabular-nums; letter-spacing: .06em; }
.billet[data-composte] .billet-tampon { opacity: .88; animation: billet-coup ${COUP}ms cubic-bezier(.16,1,.3,1) both; }
@keyframes billet-coup { from { opacity: 0; scale: 1.35; filter: blur(2px); } to { opacity: .88; scale: 1; filter: blur(0); } }
@media (max-width: 600px) {
  .billet { grid-template-columns: 1fr;
    -webkit-mask: radial-gradient(circle 11px at 0 calc(100% - 118px), #0000 98%, #000) left / 51% 100% no-repeat,
                  radial-gradient(circle 11px at 100% calc(100% - 118px), #0000 98%, #000) right / 51% 100% no-repeat;
            mask: radial-gradient(circle 11px at 0 calc(100% - 118px), #0000 98%, #000) left / 51% 100% no-repeat,
                  radial-gradient(circle 11px at 100% calc(100% - 118px), #0000 98%, #000) right / 51% 100% no-repeat; }
  .billet-corps { padding: 26px 22px 22px; gap: 18px; }
  .billet-actions button { flex: 1 1 100%; }
  .billet-talon { border-left: 0; border-top: 2px dashed rgba(28,37,48,.28); height: 118px; box-sizing: border-box; padding: 18px 22px;
    grid-template-columns: 1fr auto; align-items: center; text-align: left; }
}
@media (max-width: 600px) { .billet-compostage { display: none; } }
@media (prefers-reduced-motion: reduce) { .billet-voile[data-sortie], .billet-voile[data-sortie] .billet { transition-delay: 0ms; } }
@media (prefers-reduced-motion: reduce) { .billet-voile, .billet { transition: none; } .billet[data-composte] .billet-tampon { animation: none; } }
`

export function PointerLockOverlay() {
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)
  const setTourActive = useGameStore((s) => s.setTourActive)
  // Venu par un lien vers une toile (`?p=`) : sa destination, ou on s'excuse.
  const rdv = useGameStore((s) => s.rendezVous)
  const accrochage = useAccrochage()
  const vitrines = useVitrines()
  const [visite, setVisite] = useState<number | null>(null)
  const [sortie, setSortie] = useState<'entree' | 'visite' | null>(null)
  const [quand] = useState(() => heureDemandee(recherche(), new Date()) ?? new Date())
  const [doigt] = useState(auDoigt)

  useEffect(() => {
    let vivant = true
    void laVisite().then((n) => { if (vivant) setVisite(n) })
    return () => { vivant = false }
  }, [])

  const lignes = billet(accrochage, vitrines?.length ?? 0, quand, visite)

  const entrer = (comment: 'entree' | 'visite') => {
    if (sortie) return
    if (comment === 'entree') {
      // Le verrouillage du pointeur doit partir du geste lui-même. Absent sur
      // iPhone, refusé ailleurs au toucher : la visite démarre quand même (#31).
      const canvas = document.querySelector('canvas')
      Promise.resolve(canvas?.requestPointerLock?.()).catch(() => {})
    }
    setSortie(comment)
    setTimeout(() => {
      if (comment === 'visite') setTourActive(true)
      // Le billet se réimprime pour la prochaine pause (Échap).
      setSortie(null)
      setPaused(false)
    }, mouvementReduit() ? 0 : COUP + LECTURE + EFFACEMENT * 0.7)
  }

  useEffect(() => {
    if (!paused) return
    const touche = (e: KeyboardEvent) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) entrer('entree') }
    addEventListener('keydown', touche)
    return () => removeEventListener('keydown', touche)
  })

  if (!paused) return null

  const nomDuDepot = rdv?.cle ? rdv.cle.slice(rdv.cle.indexOf('/') + 1) : null
  return (
    <div
      // Repère stable pour un navigateur piloté, qui doit escamoter cet écran
      // avant de mesurer la luminance de la scène — il couvre tout le cadre.
      // Le retirer par un clic est impossible en headless : le clic demande le
      // verrouillage du pointeur, que Chrome refuse hors interaction réelle.
      data-museum-overlay="accueil"
      className="billet-voile"
      data-sortie={sortie ? '' : undefined}
    >
      <style>{STYLE}</style>
      <article className="billet" data-composte={sortie ? '' : undefined} aria-labelledby="billet-titre">
        <div className="billet-corps">
          <header>
            <h1 id="billet-titre">{config.name}</h1>
            <p className="billet-accroche">Les projets GitHub de Philippe Matray, accrochés comme des tableaux dans une ancienne gare.</p>
          </header>
          <dl>
            {nomDuDepot && (
              <>
                <dt>Destination</dt>
                <dd className="destination">{nomDuDepot}</dd>
              </>
            )}
            {lignes.collection && (
              <>
                <dt>Collection</dt>
                <dd>{lignes.collection}, un jardin, un chat</dd>
              </>
            )}
            <dt>Date</dt>
            <dd>{lignes.jour}</dd>
            <dt>Heure</dt>
            <dd>{lignes.heure}</dd>
          </dl>
          {rdv && rdv.cle === null && <p className="billet-absent">« {rdv.demande} » n’est pas exposé ici : la visite commence à l’entrée.</p>}
          <div className="billet-actions">
            <button type="button" className="billet-entrer" autoFocus onClick={() => entrer('entree')}>
              Composter et entrer
            </button>
            <button type="button" className="billet-guide" onClick={() => entrer('visite')}>
              Visite guidée
            </button>
          </div>
          {doigt ? (
            <p className="billet-consignes">Pouce gauche pour marcher, glisser à droite pour regarder, toucher le plan pour l’agrandir.</p>
          ) : (
            <p className="billet-consignes">
              <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> ou flèches pour marcher, <kbd>Maj</kbd> pour presser le pas, <kbd>Espace</kbd> pour sauter, la souris pour regarder, <kbd>Échap</kbd> pour la pause.
            </p>
          )}
        </div>
        <aside className="billet-talon" aria-label="Talon du billet">
          <div>
            <div className="entree">ENTRÉE</div>
            <p className="tarif">1 personne · gratuit</p>
          </div>
          <div className="billet-compostage">Compostage</div>
          <div>
            <span className="no">Visiteur n°</span>
            <span className="numero">{lignes.numero}</span>
          </div>
          <div className="billet-tampon" aria-hidden="true">
            {sortie === 'visite' ? 'Visite guidée' : 'Composté'}
            <span>{lignes.heure}</span>
          </div>
        </aside>
      </article>
    </div>
  )
}

export function TourExitButton() {
  const tourActive = useGameStore((s) => s.tourActive)
  const setTourActive = useGameStore((s) => s.setTourActive)
  const setPaused = useGameStore((s) => s.setPaused)

  // ESC key exits the tour. We need a separate keydown listener because
  // pointer lock isn't engaged during the tour, so the pointerlockchange
  // handler never fires.
  useEffect(() => {
    if (!tourActive) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTourActive(false)
        setPaused(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tourActive, setTourActive, setPaused])

  if (!tourActive) return null

  return (
    <button
      onClick={() => {
        setTourActive(false)
        setPaused(true)
      }}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        background: 'rgba(12,15,20,0.6)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 1000,
      }}
    >
      Quitter la visite (Échap)
    </button>
  )
}
