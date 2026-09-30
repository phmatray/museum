/**
 * La carte d'une étape du journal de chantier, en bas à gauche, comme celle
 * d'une toile (`CarteOeuvre`) : quand le visiteur regarde un cadre de la
 * baraque du chantier (`ChantierLayer` publie `etape`), l'étape s'y raconte —
 * son image, son numéro, sa catégorie, sa PR — et « Lire dans le journal »
 * ouvre la page du journal à son ancre (Entrée, ou J).
 *
 * Une page du journal plutôt qu'un panneau du musée : le papier pierre, le
 * Marcellus des titres, l'or des statuts — ceux de `docs/journal`.
 */
import { useEffect } from 'react'

import { adresseJournal, teinteCategorie, useJournal } from '../hooks/useChantier'
import { useGameStore } from '../stores/gameStore'

/** Le dépôt du musée : ses PR sont celles du journal. */
const DEPOT = 'https://github.com/phmatray/museum'
const PIERRE = '#efe9dc'
const ENCRE = '#2a2620'
const ENCRE_2 = '#6a6152'
const OR = '#946a22'
const FILET = '#cfc4ae'

const Touche = ({ children }: { children: string }) => (
  <kbd style={{ border: `1px solid ${FILET}`, borderBottomWidth: 2, borderRadius: 3, padding: '0 6px', font: '600 11px "Source Sans 3", system-ui', background: 'rgba(255,255,255,.45)' }}>{children}</kbd>
)

export function CarteEtape() {
  const ancre = useGameStore((s) => s.etape)
  const paused = useGameStore((s) => s.paused)
  const journal = useJournal(ancre !== null)
  const e = ancre === null ? undefined : journal?.etapes.find((x) => x.ancre === ancre)
  const lien = e ? adresseJournal(`#${e.ancre}`) : null

  useEffect(() => {
    if (lien === null || paused) return
    const touche = (ev: KeyboardEvent) => {
      if (ev.repeat) return
      if (ev.code === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'KeyJ') window.open(lien, '_blank', 'noopener')
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [lien, paused])

  if (e === undefined || lien === null || paused || journal === null) return null
  const teinte = teinteCategorie(e.categorie)
  return (
    <aside
      key={e.ancre}
      aria-live="polite"
      style={{
        position: 'fixed', left: 16, bottom: 16, width: 'min(380px, calc(100vw - 32px))', zIndex: 10,
        background: PIERRE, color: ENCRE, border: `1px solid ${FILET}`, borderRadius: 4, padding: '14px 16px',
        font: '400 14px/1.45 "Source Sans 3", "Segoe UI", system-ui, sans-serif', boxShadow: '0 10px 30px rgba(0,0,0,.35)',
        animation: 'carte-etape 260ms ease-out',
      }}
    >
      <style>{'@keyframes carte-etape { from { opacity: 0; transform: translateY(8px) } } @media (prefers-reduced-motion: reduce) { aside { animation: none !important } }'}</style>
      {e.image && (
        <img
          src={adresseJournal(e.image.src)}
          alt=""
          style={{ display: 'block', width: '100%', aspectRatio: `${e.image.largeur} / ${e.image.hauteur}`, maxHeight: 220, objectFit: 'cover', objectPosition: 'top', border: `1px solid ${FILET}`, background: '#e4dccb', marginBottom: 10 }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>
        <span style={{ color: OR }}>{e.n === null ? 'Hors série' : `Étape ${e.n}`}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: ENCRE_2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: teinte }} />
          {journal.categories[e.categorie] ?? e.categorie}
        </span>
      </div>
      <div style={{ font: '400 22px/1.15 Marcellus, "Times New Roman", serif', margin: '4px 0 6px', textWrap: 'balance' }}>{e.titre}</div>
      <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: e.fait ? OR : ENCRE_2 }}>
        {e.pr === null ? e.statut : (
          <>
            {e.statut.replace(/\s*·?\s*PR #\d+/, '')}
            {' · '}
            <a href={`${DEPOT}/pull/${e.pr}`} target="_blank" rel="noopener" style={{ color: 'inherit' }}>PR #{e.pr}</a>
          </>
        )}
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${FILET}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href={lien}
          target="_blank"
          rel="noopener"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 4, border: `1px solid ${OR}`, color: ENCRE, fontWeight: 600, textDecoration: 'none', background: 'rgba(148,106,34,.1)' }}
        >
          <Touche>Entrée</Touche> Lire dans le journal
        </a>
      </div>
    </aside>
  )
}
