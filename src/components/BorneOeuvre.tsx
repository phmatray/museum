/**
 * La borne interactive des vitrines de la salle d'honneur : quand le visiteur
 * regarde une borne de près (`VitrinesLayer` publie `borne`), son README entier
 * s'ouvre à gauche de l'écran, à la façon d'un panneau du musée Cernuschi —
 * bordeaux, crème, un romain pour les titres.
 *
 * On le fait défiler à la molette (elle arrive même souris capturée) ou avec
 * Page préc./Page suiv. — les flèches font marcher. Entrée (ou V, ou H) visite
 * le site du projet, E ouvre son dépôt sur GitHub, où l'étoile est à un clic.
 */
import { useEffect, useMemo, useRef } from 'react'

import { couleurDeLangage, partsDeLangages } from '../domain/langages'
import { useCapture, useCatalogue, useReadme } from '../hooks/useCatalogue'
import { ilYA } from '../plan/eveil'
import { readmeEnBlocs } from '../plan/vitrines'
import { useGameStore } from '../stores/gameStore'

const CREME = '#f1e4c6'
const OR = '#e0b060'
const SERIF = `"PT Serif Musee", "PT Serif", Georgia, serif`
const POLICE = `@font-face { font-family: "PT Serif Musee"; src: url("${import.meta.env.BASE_URL}assets/fonts/PTSerif-Regular.ttf"); }`

const Touche = ({ children }: { children: string }) => (
  <kbd style={{ border: '1px solid rgba(241,228,198,0.45)', borderBottomWidth: 2, borderRadius: 4, padding: '0 6px', font: '600 12px system-ui', color: CREME }}>
    {children}
  </kbd>
)

export function BorneOeuvre() {
  const cle = useGameStore((s) => s.borne)
  const paused = useGameStore((s) => s.paused)
  const catalogue = useCatalogue()
  const oeuvre = cle === null ? undefined : catalogue?.get(cle)
  const md = useReadme(cle)
  const capture = useCapture(cle)
  const site = oeuvre?.site ?? null
  const blocs = useMemo(() => (md ? readmeEnBlocs(md, 40000) : []), [md])
  const defile = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (oeuvre === undefined || paused) return
    const touche = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'KeyE') window.open(oeuvre.url, '_blank', 'noopener')
      else if (site && ['Enter', 'NumpadEnter', 'KeyV', 'KeyH'].includes(e.code)) window.open(site, '_blank', 'noopener')
      else if (e.code === 'PageDown' || e.code === 'PageUp') {
        const d = defile.current
        d?.scrollBy({ top: (e.code === 'PageDown' ? 0.85 : -0.85) * d.clientHeight, behavior: 'smooth' })
      }
    }
    // La molette : souris capturée, l'événement ne vise pas le panneau, on le lui passe.
    const molette = (e: WheelEvent) => defile.current?.scrollBy({ top: e.deltaY })
    window.addEventListener('keydown', touche)
    window.addEventListener('wheel', molette, { passive: true })
    return () => {
      window.removeEventListener('keydown', touche)
      window.removeEventListener('wheel', molette)
    }
  }, [oeuvre, paused, site])

  if (oeuvre === undefined || paused) return null
  const parts = partsDeLangages(oeuvre.languages)
  // Le titre du README répète le nom du dépôt : on ne le garde pas.
  const corps = blocs[0]?.type === 'titre' && blocs[0].niveau === 1 ? blocs.slice(1) : blocs
  return (
    <aside
      key={oeuvre.key}
      aria-live="polite"
      data-borne
      style={{
        position: 'fixed', left: 16, top: 16, bottom: 16, width: 'min(600px, calc(100vw - 32px))', zIndex: 11,
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(160deg, rgba(92,18,22,0.96), rgba(52,10,13,0.96))',
        border: '1px solid rgba(224,176,96,0.35)', borderRadius: 6, boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
        color: CREME, font: '15px/1.55 system-ui, sans-serif', animation: 'borne-oeuvre 280ms ease-out',
      }}
    >
      <style>{`${POLICE} @keyframes borne-oeuvre { from { opacity: 0; transform: translateX(-12px) } } @media (prefers-reduced-motion: reduce) { aside[data-borne] { animation: none !important } }`}</style>
      {capture && (
        <img
          src={capture}
          alt={`Aperçu de ${oeuvre.name}`}
          style={{ display: 'block', width: '100%', maxHeight: '28vh', objectFit: 'cover', objectPosition: 'top', borderRadius: '6px 6px 0 0', borderBottom: '1px solid rgba(224,176,96,0.35)', flexShrink: 0 }}
        />
      )}
      <header style={{ padding: '22px 28px 14px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: OR }}>{oeuvre.owner} · salle d’honneur</div>
        <h2 style={{ font: `400 34px/1.15 ${SERIF}`, margin: '6px 0 10px', overflowWrap: 'anywhere' }}>{oeuvre.name}</h2>
        <div style={{ height: 1, background: 'rgba(241,228,198,0.6)', margin: '0 0 12px' }} />
        {oeuvre.description && <p style={{ margin: '0 0 12px', font: `italic 16px/1.5 ${SERIF}`, color: '#e8d7b4' }}>{oeuvre.description}</p>}
        {parts.length > 0 && (
          <>
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
              {parts.map(({ langage, part }) => <span key={langage} title={langage} style={{ width: `${part * 100}%`, background: couleurDeLangage(langage) }} />)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 12, color: '#d4c3a2', marginBottom: 8 }}>
              {parts.slice(0, 4).map(({ langage, part }) => (
                <span key={langage}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: couleurDeLangage(langage), marginRight: 5 }} />
                  {langage} {Math.round(part * 100)} %
                </span>
              ))}
            </div>
          </>
        )}
        <div style={{ fontSize: 13, color: '#d4c3a2', fontVariantNumeric: 'tabular-nums' }}>
          ⑂ {oeuvre.forks.toLocaleString('fr-FR')} · poussé {ilYA(oeuvre.pushedAt, new Date())}
        </div>
      </header>
      <div ref={defile} style={{ flex: 1, overflowY: 'auto', padding: '4px 28px 18px', borderTop: '1px solid rgba(241,228,198,0.15)', scrollbarColor: `${OR} transparent` }}>
        {md === null && <p style={{ color: '#c9b690' }}>Le README arrive…</p>}
        {corps.map((b, i) =>
          b.type === 'titre' ? (
            <h3 key={i} style={{ font: `400 ${b.niveau <= 2 ? 22 : 18}px/1.3 ${SERIF}`, color: b.niveau <= 2 ? CREME : OR, margin: '20px 0 6px' }}>{b.texte}</h3>
          ) : b.type === 'puce' ? (
            <div key={i} style={{ display: 'flex', gap: 10, margin: '3px 0', color: '#eadbbb' }}>
              <span style={{ color: OR }}>•</span>
              <span>{b.texte.replace(/^\[[ xX]\]\s*/, '')}</span>
            </div>
          ) : (
            <p key={i} style={{ margin: '8px 0', color: '#eadbbb' }}>{b.texte}</p>
          ))}
      </div>
      <footer style={{ padding: '10px 28px 14px', display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', fontSize: 13, borderTop: '1px solid rgba(241,228,198,0.15)' }}>
        {site && <span style={{ color: OR, fontWeight: 600 }}><Touche>Entrée</Touche> visiter le site</span>}
        <a
          href={oeuvre.url}
          target="_blank"
          rel="noopener"
          title="Ouvre le dépôt sur GitHub : le bouton Star y est à un clic"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${OR}`, background: 'rgba(224,176,96,0.12)', color: CREME, fontWeight: 600, textDecoration: 'none' }}
        >
          <Touche>E</Touche> ★ Mettre une étoile
          <span style={{ fontWeight: 400, color: '#d4c3a2', fontVariantNumeric: 'tabular-nums' }}>{oeuvre.stars.toLocaleString('fr-FR')}</span>
        </a>
        <span style={{ color: '#c9b690' }}>molette ou <Touche>Pg↓</Touche> pour lire la suite</span>
      </footer>
    </aside>
  )
}
