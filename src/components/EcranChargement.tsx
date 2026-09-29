/**
 * L'écran de chargement : le musée ne se montre qu'une fois monté en entier,
 * sans pièces qui surgissent l'une après l'autre (`stores/chargementStore.ts`).
 *
 * L'horloge de la gare (le favicon) sert de cadran : l'aiguille des minutes
 * fait le tour pendant que la barre dorée avance. Quand tout est prêt, fondu
 * vers l'accueil. Au-delà de 20 s sans qu'un seul élément n'arrive, on lève
 * le rideau quand même : un fichier qui ne répond pas ne doit pas fermer le
 * musée. Un navigateur piloté qui reprend la visite (`__PLAN__.reprendre`) ou
 * verrouille le pointeur l'escamote aussi.
 */
import { useEffect, useState } from 'react'

import config from '../../museum.config.json'
import { avancer, marquerPret, useChargement } from '../stores/chargementStore'
import { useGameStore } from '../stores/gameStore'
import { mouvementReduit } from '../stores/reglagesStore'

const OR = '#d1a54a'
const CREME = '#f5eedc'
const NUIT = '#1c2530'
/** Sans nouvelle arrivée pendant ce temps, on n'attend plus (ms). */
const PATIENCE = 20000
/** La durée du fondu vers l'accueil (ms). */
const FONDU = 700

/** Le total du dernier chargement complet, mémorisé ; à défaut, l'ordre de grandeur du musée. */
const CLE_TOTAL = 'musee:total-chargement'
function totalAttendu(): number {
  try {
    return Number(localStorage.getItem(CLE_TOTAL)) || 120
  } catch {
    return 120
  }
}


export function EcranChargement() {
  const { faits, total, etape } = useChargement()
  const paused = useGameStore((s) => s.paused)
  const [affiche, setAffiche] = useState(0)
  const [parti, setParti] = useState(false)
  const [verrouille, setVerrouille] = useState(false)
  const pret = etape === 'pret'

  // La barre suit la cible en douceur, sans jamais reculer.
  useEffect(() => {
    if (parti) return
    const doux = !mouvementReduit()
    const attendu = totalAttendu()
    let avant = performance.now()
    let id = requestAnimationFrame(function image(t) {
      const { faits, total, etape } = useChargement.getState()
      setAffiche((a) => avancer(a, faits, total, etape, (t - avant) / 1000, doux, attendu))
      avant = t
      id = requestAnimationFrame(image)
    })
    return () => cancelAnimationFrame(id)
  }, [parti])

  useEffect(() => {
    if (pret) return
    const id = setTimeout(() => {
      console.warn(`museum: chargement bloqué à ${faits}/${total} depuis ${PATIENCE / 1000} s, on ouvre quand même`)
      marquerPret()
    }, PATIENCE)
    return () => clearTimeout(id)
  }, [pret, faits, total])

  useEffect(() => {
    if (!pret) return
    try {
      localStorage.setItem(CLE_TOTAL, String(useChargement.getState().total))
    } catch {
      // Stockage refusé (navigation privée) : la prochaine fois, l'ordre de grandeur.
    }
    const id = setTimeout(() => setParti(true), mouvementReduit() ? 0 : FONDU)
    return () => clearTimeout(id)
  }, [pret])

  useEffect(() => {
    const suivre = () => setVerrouille(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', suivre)
    return () => document.removeEventListener('pointerlockchange', suivre)
  }, [])

  if (parti || !paused || verrouille) return null

  const minutes = affiche * 360
  return (
    <div
      data-museum-overlay="chargement"
      aria-busy={!pret}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.4rem',
        background: `radial-gradient(ellipse at 50% 42%, #26323f 0%, ${NUIT} 45%, #10151b 100%)`,
        color: CREME,
        opacity: pret ? 0 : 1,
        transition: mouvementReduit() ? 'none' : `opacity ${FONDU}ms ease`,
        pointerEvents: pret ? 'none' : 'auto',
        padding: '0 1rem',
        textAlign: 'center',
      }}
    >
      <svg viewBox="0 0 64 64" width="84" height="84" aria-hidden="true">
        <circle cx="32" cy="32" r="25" fill={CREME} stroke={OR} strokeWidth="4" />
        <g fill={NUIT}>
          <rect x="30" y="10.5" width="4" height="6" rx="1" />
          <rect x="30" y="47.5" width="4" height="6" rx="1" />
          <rect x="10.5" y="30" width="6" height="4" rx="1" />
          <rect x="47.5" y="30" width="6" height="4" rx="1" />
        </g>
        <g stroke={NUIT} strokeLinecap="round">
          <line x1="32" y1="32" x2="32" y2="20" strokeWidth="5" transform={`rotate(${minutes / 12} 32 32)`} />
          <line x1="32" y1="32" x2="32" y2="14" strokeWidth="3.5" transform={`rotate(${minutes} 32 32)`} />
        </g>
        <circle cx="32" cy="32" r="2.6" fill={OR} />
      </svg>
      <h1 style={{ margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 400, fontSize: 'clamp(1.8rem, 6vw, 2.8rem)', letterSpacing: '0.06em' }}>
        {config.name}
      </h1>
      <p style={{ margin: 0, color: OR, fontSize: '0.75rem', letterSpacing: '0.28em', textTransform: 'uppercase' }}>
        {etape === 'chargement' ? 'Le musée s’installe' : 'Dernières retouches'}
      </p>
      <div
        role="progressbar"
        aria-label="Chargement du musée"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(affiche * 100)}
        style={{ width: 'min(260px, 70vw)', height: 2, background: 'rgba(209, 165, 74, 0.2)', borderRadius: 1, overflow: 'hidden' }}
      >
        <div style={{ height: '100%', width: `${affiche * 100}%`, background: OR }} />
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
        {total === 0 ? '…' : `${Math.min(faits, total)} / ${total}`}
      </p>
    </div>
  )
}
