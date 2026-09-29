/**
 * L'ambiance sonore dans la scène : ce composant ne dessine rien, il nourrit
 * le `Moteur` (moteur.ts) de ce que la 3D sait — où est la caméra, à quelle
 * allure marche le visiteur, sur quel sol, où dort Bavette, s'il fait jour —
 * et le fait taire quand la page est cachée ou le musée en pause.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { avancerPas, carillonDu, lieuDe, matiereSous, partitionAnnonce, partitionHeure } from '../domain/son'
import { useGameStore } from '../stores/gameStore'
import { moteurCourant, parcSonore, useSon } from './etat'

const avant = new THREE.Vector3()
const haut = new THREE.Vector3()

export function AmbianceSonore() {
  const actif = useSon((s) => s.actif)
  const paused = useGameStore((s) => s.paused)
  const foulee = useRef({ phase: 0.7, vitesse: 0, x: NaN, z: NaN, carillon: null as number | null, horloge: 0 })

  // Suspendu dès que rien ne doit s'entendre : en pause, page cachée, son coupé.
  useEffect(() => {
    const regler = () => {
      const m = moteurCourant()
      if (!m) return
      const jouer = actif && !paused && document.visibilityState === 'visible'
      void (jouer ? m.ctx.resume() : m.ctx.suspend()).catch(() => {})
    }
    regler()
    document.addEventListener('visibilitychange', regler)
    return () => document.removeEventListener('visibilitychange', regler)
  }, [actif, paused])

  // Le tableau tourne ses palettes ; un nouveau projet est annoncé.
  useEffect(() => useGameStore.subscribe((s, avant) => {
    const m = moteurCourant()
    if (!m || !useSon.getState().actif) return
    if (s.volets && s.volets !== avant.volets) m.volets(s.volets.ms / 1000)
    if (s.annonce && s.annonce.key !== avant.annonce?.key) m.carillon(partitionAnnonce())
  }), [])

  useFrame(({ camera }, delta) => {
    const m = moteurCourant()
    if (!m || !actif || paused || m.ctx.state !== 'running') return
    const { visiteur: w, bavette, ciel, meteo } = useGameStore.getState()
    if (!w) return
    const f = foulee.current

    // L'allure, mesurée sur ce que le visiteur a vraiment parcouru ; un saut (téléport) ne compte pas.
    const d = Math.hypot(w.x - f.x, w.z - f.z)
    const v = Number.isFinite(d) && d < 1 ? d / Math.max(delta, 1e-3) : 0
    f.vitesse += (v - f.vitesse) * Math.min(1, delta * 12)
    f.x = w.x
    f.z = w.z
    const p = avancerPas(f.phase, f.vitesse, delta)
    f.phase = p.phase
    if (p.pas) m.pas(matiereSous(w, parcSonore()), f.vitesse > 4.5 ? 1.15 : 1)

    camera.getWorldDirection(avant)
    haut.set(0, 1, 0).applyQuaternion(camera.quaternion)
    m.maj({
      position: [camera.position.x, camera.position.y, camera.position.z],
      avant: [avant.x, avant.y, avant.z],
      haut: [haut.x, haut.y, haut.z],
      lieu: lieuDe(w.surface),
      jour: ciel.jour,
      bavette: bavette && bavette.level === w.level ? [bavette.x, w.y + 0.2, bavette.z] : null,
      pluie: meteo.pluie,
    })

    // L'heure pleine, vérifiée une fois par seconde.
    f.horloge += delta
    if (f.horloge >= 1) {
      f.horloge = 0
      const c = carillonDu(new Date(), f.carillon)
      if (c) {
        f.carillon = c.cle
        m.carillon(partitionHeure(c.coups))
      }
    }
  })

  return null
}
