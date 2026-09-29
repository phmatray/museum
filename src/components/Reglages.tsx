/**
 * Les réglages, à côté du bouton du son : une roue dentée (ou la touche R)
 * ouvre un petit carton du même papier que le billet d'entrée, accroché sous
 * les boutons ; sur un téléphone, il monte du bas de l'écran.
 *
 * Tout ce qu'il règle existait déjà : il ne fait que l'écrire
 * (`stores/reglagesStore.ts`) là où chaque système le lit. L'heure, le temps,
 * la saison, la qualité et les ombres passent par les forçages de l'adresse
 * (`domain/reglages.ts`) — et un paramètre de l'adresse l'emporte : son
 * réglage est alors grisé, avec le paramètre qui l'impose.
 *
 * Ouvert pendant la marche, il rend la souris (le musée se met en pause) ;
 * refermé d'un clic, il la reprend et la marche continue. Refermé à Échap,
 * le navigateur ne permet pas de la reprendre : on retrouve le billet.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import '@fontsource/marcellus/latin-400.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'

import { basculerSon, useSon } from '../audio/etat'
import { BORNES, DEFAUTS, METEOS, SAISONS, heureTexte, type Reglages as R } from '../domain/reglages'
import { saisonA } from '../domain/saisons'
import { cielDuMoment, useGameStore } from '../stores/gameStore'
import { changerReglages, recherche, useReglages } from '../stores/reglagesStore'

const NOMS_METEO: Record<(typeof METEOS)[number], string> = { clair: 'Clair', pluie: 'Pluie', neige: 'Neige', brouillard: 'Brouillard', orage: 'Orage' }
const NOMS_SAISON: Record<(typeof SAISONS)[number], string> = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' }

/** Écrit le réglage, puis republie ce que le musée n'aurait relu qu'au prochain tic. */
function regler(p: Partial<R>) {
  changerReglages(p)
  if ('heure' in p || 'saison' in p) useGameStore.setState({ ciel: cielDuMoment(), saison: saisonA(new Date(), recherche()) })
}

/** Le paramètre de l'adresse qui impose ce réglage, s'il y en a un. */
const impose = (cle: string) => (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(cle))

const STYLE = `
.reglages-bouton { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border-radius: 999px; cursor: pointer;
  background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.25); color: #e6dfd2; backdrop-filter: blur(6px);
  transition: background-color .15s, border-color .15s, color .15s; }
.reglages-bouton:hover, .reglages-bouton[aria-expanded="true"] { background: rgba(18,16,14,.86); border-color: rgba(255,214,150,.55); color: #f3efe6; }
.reglages-bouton svg { transition: rotate .4s cubic-bezier(.16,1,.3,1); }
.reglages-bouton[aria-expanded="true"] svg { rotate: 60deg; }
.reglages-bouton:focus-visible { outline: 2px solid #d1a54a; outline-offset: 3px; }

.reglages { --papier: #f4ecda; --encre: #1c2530; --encre-2: #4a4f55; --or: #a97c26; --or-2: #d1a54a; --filet: rgba(28,37,48,.16);
  position: fixed; z-index: 1002; right: 1rem; width: 340px; box-sizing: border-box; overflow: auto; overscroll-behavior: contain;
  color: var(--encre); font: 400 15px/1.4 "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  background: linear-gradient(175deg, #f8f2e4 0%, var(--papier) 60%, #ece1c8 100%);
  border-radius: 6px; box-shadow: 0 24px 60px -16px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.25);
  animation: reglages-entree .28s cubic-bezier(.16,1,.3,1) both; }
@keyframes reglages-entree { from { opacity: 0; transform: translateY(-6px); } }
.reglages ::selection { background: var(--or-2); color: var(--encre); }
.reglages header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 12px 20px; background: inherit; border-bottom: 2px dashed rgba(28,37,48,.22); }
.reglages h2 { margin: 0; font: 400 24px/1 Marcellus, Georgia, serif; letter-spacing: .02em; }
.reglages-fermer { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--encre); cursor: pointer; }
.reglages-fermer:hover { background: rgba(28,37,48,.08); }
.reglages section { padding: 12px 20px 14px; border-top: 1px solid var(--filet); display: grid; gap: 10px; }
.reglages section:first-of-type { border-top: 0; }
.reglages h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--encre-2); }
.reglages-ligne { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; }
.reglages-ligne > label, .reglages-ligne > span { flex: 1; }
.reglages output, .reglages .valeur { font-weight: 600; font-variant-numeric: tabular-nums; min-width: 3.5em; text-align: right; }
.reglages kbd { font: 600 11px/1 "Source Sans 3", system-ui, sans-serif; padding: 2px 5px; margin-left: 6px; border: 1px solid var(--filet); border-bottom-width: 2px; border-radius: 3px; background: rgba(255,255,255,.45); }
.reglages-note { margin: 0; font-size: 12.5px; color: var(--encre-2); }
.reglages-note code { font: 600 12px ui-monospace, monospace; }

/* L'interrupteur : une case native, redessinée. */
.reglages input[type="checkbox"] { appearance: none; flex: none; width: 40px; height: 24px; margin: 0; border-radius: 999px; cursor: pointer; position: relative;
  background: rgba(28,37,48,.22); transition: background-color .18s; }
.reglages input[type="checkbox"]::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
  background: #fffaf0; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: translate .18s cubic-bezier(.16,1,.3,1); }
.reglages input[type="checkbox"]:checked { background: var(--encre); }
.reglages input[type="checkbox"]:checked::after { translate: 16px 0; background: var(--or-2); }

/* La glissière. */
.reglages input[type="range"] { appearance: none; width: 100%; height: 24px; margin: 0; background: transparent; cursor: pointer; accent-color: var(--or); }
.reglages input[type="range"]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(28,37,48,.2); }
.reglages input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(28,37,48,.2); }
.reglages input[type="range"]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--or); }
.reglages input[type="range"]::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; margin-top: -7px; border-radius: 50%; background: var(--encre); border: 3px solid var(--papier); box-shadow: 0 0 0 1px var(--encre); }
.reglages input[type="range"]::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--encre); border: 3px solid var(--papier); box-shadow: 0 0 0 1px var(--encre); }

/* Les choix exclusifs : des radios natives en boutons accolés. */
.reglages fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.reglages legend { padding: 0; margin-bottom: 6px; }
.reglages-choix { display: flex; flex-wrap: wrap; border: 1px solid rgba(28,37,48,.35); border-radius: 4px; overflow: hidden; }
.reglages-choix label { flex: 1 1 auto; position: relative; text-align: center; padding: 6px 10px; font-size: 14px; cursor: pointer;
  border-left: 1px solid rgba(28,37,48,.2); transition: background-color .15s, color .15s; }
.reglages-choix label:first-child { border-left: 0; }
.reglages-choix label:hover { background: rgba(28,37,48,.07); }
.reglages-choix input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.reglages-choix label:has(input:checked) { background: var(--encre); color: var(--papier); }

.reglages select { font: inherit; color: var(--encre); background: rgba(255,255,255,.5); border: 1px solid rgba(28,37,48,.35); border-radius: 4px; padding: 4px 8px; min-height: 32px; cursor: pointer; }

.reglages input:focus-visible, .reglages select:focus-visible, .reglages button:focus-visible, .reglages-choix label:has(input:focus-visible) { outline: 2px solid var(--or); outline-offset: 2px; }
.reglages :disabled:not([type="radio"]), .reglages-choix:has(:disabled) { opacity: .45; cursor: not-allowed; }
.reglages-choix:has(:disabled) label, .reglages-choix:has(:disabled) input { cursor: not-allowed; }

.reglages footer { padding: 12px 20px 16px; border-top: 1px solid var(--filet); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.reglages-retablir { font: 600 14px/1 "Source Sans 3", system-ui, sans-serif; min-height: 36px; padding: 0 14px; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--encre); border: 1px solid rgba(28,37,48,.45); }
.reglages-retablir:hover { background: rgba(28,37,48,.07); }

@media (max-width: 600px) {
  .reglages { left: 0; right: 0; bottom: 0; top: auto !important; width: auto; max-height: 82vh !important; border-radius: 12px 12px 0 0;
    padding-bottom: env(safe-area-inset-bottom); animation-name: reglages-monte; }
  @keyframes reglages-monte { from { transform: translateY(100%); } }
  .reglages-ligne { min-height: 40px; }
  .reglages input[type="checkbox"] { width: 46px; height: 28px; }
  .reglages input[type="checkbox"]::after { width: 22px; height: 22px; }
  .reglages input[type="checkbox"]:checked::after { translate: 18px 0; }
  .reglages-choix label { padding: 10px 8px; }
}
@media (prefers-reduced-motion: reduce) { .reglages { animation: none; } .reglages-bouton svg { transition: none; } }
`

function Interrupteur({ children, checked, onChange, disabled }: { children: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="reglages-ligne">
      <label htmlFor={id}>{children}</label>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  )
}

function Glissiere({ children, valeur, texte, min, max, pas, onChange, disabled }: {
  children: ReactNode; valeur: number; texte: string; min: number; max: number; pas: number; onChange: (v: number) => void; disabled?: boolean
}) {
  const id = useId()
  return (
    <div>
      <div className="reglages-ligne">
        <label htmlFor={id}>{children}</label>
        <output htmlFor={id}>{texte}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={pas} value={valeur} disabled={disabled} aria-valuetext={texte} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Choix<T extends string>({ legende, valeur, options, onChange, disabled }: {
  legende: string; valeur: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean
}) {
  const nom = useId()
  return (
    <fieldset disabled={disabled}>
      <legend>{legende}</legend>
      <div className="reglages-choix">
        {options.map(([v, texte]) => (
          <label key={v}>
            <input type="radio" name={nom} value={v} checked={valeur === v} onChange={() => onChange(v)} />
            {texte}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Impose({ cle }: { cle: string }) {
  const v = impose(cle)
  return v === null ? null : <p className="reglages-note">Imposé par l’adresse : <code>?{cle}={v}</code></p>
}

/** La roue dentée et le carton qu'elle ouvre. `haut` : où tombent les boutons (ils descendent pendant la visite). */
export function BoutonReglages({ haut }: { haut: string }) {
  const [ouvert, setOuvert] = useState(false)
  const bouton = useRef<HTMLButtonElement>(null)
  const carton = useRef<HTMLDivElement>(null)
  /** La souris était capturée à l'ouverture : on la reprendra en refermant. */
  const reprendre = useRef(false)
  const titre = useId()

  const ouvrir = () => {
    reprendre.current = Boolean(document.pointerLockElement)
    if (reprendre.current) document.exitPointerLock()
    setOuvert(true)
  }
  const fermer = (geste: boolean) => {
    setOuvert(false)
    if (reprendre.current && geste) {
      // Le clic qui referme est un geste : le navigateur rend la souris.
      Promise.resolve(document.querySelector('canvas')?.requestPointerLock?.()).catch(() => {})
      useGameStore.getState().setPaused(false)
    } else bouton.current?.focus()
    reprendre.current = false
  }

  // R ouvre et referme, même en pleine marche ; Échap referme avant que la
  // visite guidée ou le plan plein écran ne l'entendent.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement)) {
        if (ouvert) fermer(false)
        else ouvrir()
      } else if (ouvert && e.key === 'Escape') {
        e.stopPropagation()
        fermer(false)
      }
    }
    window.addEventListener('keydown', touche, true)
    return () => window.removeEventListener('keydown', touche, true)
  })

  useEffect(() => {
    if (ouvert) carton.current?.querySelector<HTMLElement>('input, select, button:not(.reglages-fermer)')?.focus()
  }, [ouvert])

  return (
    <>
      <style>{STYLE}</style>
      <button
        ref={bouton}
        type="button"
        className="reglages-bouton"
        aria-label="Réglages"
        aria-expanded={ouvert}
        aria-controls={ouvert ? titre + 'c' : undefined}
        title="Réglages (R)"
        onClick={(e) => {
          e.stopPropagation()
          if (ouvert) fermer(true)
          else ouvrir()
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {ouvert && (
        <div
          ref={carton}
          id={titre + 'c'}
          className="reglages"
          role="dialog"
          aria-labelledby={titre}
          style={{ top: `calc(${haut} + 48px)`, maxHeight: `calc(100vh - ${haut} - 64px)` }}
          // Les touches restent au carton : ni la marche, ni M, ni Entrée du billet.
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Carton titre={titre} fermer={() => fermer(true)} />
        </div>
      )}
    </>
  )
}

function Carton({ titre, fermer }: { titre: string; fermer: () => void }) {
  const r = useReglages()
  const son = useSon((s) => s.actif)
  const heureImposee = impose('heure') !== null

  return (
    <>
      <header>
        <h2 id={titre}>Réglages</h2>
        <button type="button" className="reglages-fermer" aria-label="Fermer les réglages" onClick={fermer}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
      </header>

      <section aria-label="Son">
        <h3>Son</h3>
        <Interrupteur checked={son} onChange={basculerSon}>Son de l’ambiance<kbd>M</kbd></Interrupteur>
        <Glissiere valeur={r.volume} texte={`${Math.round(r.volume * 100)} %`} min={BORNES.volume[0]} max={BORNES.volume[1]} pas={0.05} onChange={(volume) => regler({ volume })}>Volume</Glissiere>
      </section>

      <section aria-label="Image">
        <h3>Image</h3>
        <Choix legende="Qualité" valeur={(impose('qualite') as R['qualite'] | null) ?? r.qualite} disabled={impose('qualite') !== null} onChange={(qualite) => regler({ qualite })}
          options={[['auto', 'Auto'], ['haute', 'Haute'], ['basse', 'Basse']]} />
        <Impose cle="qualite" />
        <Interrupteur checked={impose('ombres') === null ? r.ombres : impose('ombres') !== '0'} disabled={impose('ombres') !== null} onChange={(ombres) => regler({ ombres })}>Ombres du soleil</Interrupteur>
        <Glissiere valeur={r.champ} texte={`${r.champ}°`} min={BORNES.champ[0]} max={BORNES.champ[1]} pas={1} onChange={(champ) => regler({ champ })}>Champ de vision</Glissiere>
      </section>

      <section aria-label="Regard et affichage">
        <h3>Regard</h3>
        <Glissiere valeur={r.sensibilite} texte={`× ${r.sensibilite.toFixed(2).replace('.', ',')}`} min={BORNES.sensibilite[0]} max={BORNES.sensibilite[1]} pas={0.05} onChange={(sensibilite) => regler({ sensibilite })}>
          Sensibilité de la souris
        </Glissiere>
        <Interrupteur checked={r.inverserY} onChange={(inverserY) => regler({ inverserY })}>Inverser l’axe vertical</Interrupteur>
        <Interrupteur checked={r.plan} onChange={(plan) => regler({ plan })}>Afficher le plan</Interrupteur>
        <Choix legende="Mouvement" valeur={r.mouvement} onChange={(mouvement) => regler({ mouvement })}
          options={[['systeme', 'Comme l’appareil'], ['reduit', 'Réduit'], ['normal', 'Normal']]} />
      </section>

      <section aria-label="Heure et météo">
        <h3>Heure et météo</h3>
        <Choix legende="Heure" valeur={r.heure === null && !heureImposee ? 'reelle' : 'choisie'} disabled={heureImposee}
          onChange={(v) => {
            const d = new Date()
            regler({ heure: v === 'reelle' ? null : Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15 % (24 * 60) })
          }}
          options={[['reelle', 'Réelle'], ['choisie', 'Choisie']]} />
        {r.heure !== null && !heureImposee && (
          <Glissiere valeur={r.heure} texte={heureTexte(r.heure)} min={BORNES.heure[0]} max={BORNES.heure[1]} pas={15} onChange={(heure) => regler({ heure })}>
            À l’heure de
          </Glissiere>
        )}
        <Impose cle="heure" />
        <div className="reglages-ligne">
          <label htmlFor={titre + 'm'}>Temps</label>
          <select id={titre + 'm'} value={impose('meteo') ?? r.meteo ?? ''} disabled={impose('meteo') !== null} onChange={(e) => regler({ meteo: (e.target.value || null) as R['meteo'] })}>
            <option value="">Réel (Bruxelles)</option>
            {METEOS.map((m) => <option key={m} value={m}>{NOMS_METEO[m]}</option>)}
          </select>
        </div>
        <Impose cle="meteo" />
        <div className="reglages-ligne">
          <label htmlFor={titre + 's'}>Saison</label>
          <select id={titre + 's'} value={impose('saison') ?? r.saison ?? ''} disabled={impose('saison') !== null} onChange={(e) => regler({ saison: (e.target.value || null) as R['saison'] })}>
            <option value="">Réelle</option>
            {SAISONS.map((s) => <option key={s} value={s}>{NOMS_SAISON[s]}</option>)}
          </select>
        </div>
        <Impose cle="saison" />
      </section>

      <footer>
        <button type="button" className="reglages-retablir" onClick={() => regler(DEFAUTS)}>Rétablir</button>
        <p className="reglages-note">Retenus sur cet appareil.</p>
      </footer>
    </>
  )
}
