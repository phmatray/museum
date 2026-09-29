/**
 * Ce que les modèles des accessoires (`MobilierLayer`) ne portent pas :
 *
 * - le velours des cordons, en chaînette d'un potelet à l'autre ;
 * - les blocs verts « Sortie », éclairés jour et nuit ;
 * - le texte du panneau des horaires, peint sur son émail : les heures du vrai
 *   lever et du vrai coucher du soleil, du jour de la visite (`domain/horaires.ts`) ;
 * - l'eau de la fontaine : deux bassins et le voile qui déborde de la vasque,
 *   avec les matières de l'étang (`jardinMatieres.ts`).
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import config from '../../museum.config.json'
import { lignesDesHoraires } from '../domain/horaires'
import { heureDemandee } from '../domain/soleil'
import { MOBILIER, garniture } from '../plan/mobilier'
import { MUSEE } from '../plan/musee'
import { BLOC_SORTIE, sorties } from '../plan/signaletique'
import { useGameStore } from '../stores/gameStore'
import { canevasEnMetres } from './canevas'
import { creerMatieresJardin } from './jardinMatieres'

export function AccessoiresLayer() {
  return (
    <group name="accessoires">
      <Cordons />
      <Sorties />
      <Horaires />
      <Fontaines />
    </group>
  )
}

// ── Les cordons ─────────────────────────────────────────────────────────────

/** Le crochet du potelet (`build-accessoires.py` : 0,95 m, boule comprise), et le creux de la chaînette. */
const CROCHET = 0.86
const CREUX = 0.13

function Cordons() {
  const geometrie = useMemo(() => {
    const troncons = MOBILIER.filter((m) => m.piece === 'Cordon').flatMap((m) => {
      const p = garniture(m)
      return p.slice(1).map((b, i) => {
        const a = p[i]
        // Une parabole : assez près de la chaînette pour un cordon de 2 m qui pend de 13 cm.
        const points = Array.from({ length: 13 }, (_, k) => {
          const t = k / 12
          return new THREE.Vector3(a.x + (b.x - a.x) * t, m.y + CROCHET - CREUX * 4 * t * (1 - t), a.z + (b.z - a.z) * t)
        })
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.017, 8, false)
      })
    })
    return troncons.length ? mergeGeometries(troncons) : null
  }, [])
  const velours = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5e0b16', roughness: 0.9 }), [])
  useEffect(() => () => {
    geometrie?.dispose()
    velours.dispose()
  }, [geometrie, velours])
  return geometrie && <mesh geometry={geometrie} material={velours} />
}

// ── Les blocs « Sortie » ────────────────────────────────────────────────────

function Sorties() {
  const liste = useMemo(() => sorties(MUSEE), [])
  const { largeur: l, hauteur: h, epaisseur: e } = BLOC_SORTIE
  const face = useMemo(
    () =>
      canevasEnMetres(l, h, 1200, (ctx) => {
        ctx.fillStyle = '#0a8a3a'
        ctx.fillRect(0, 0, l, h)
        ctx.strokeStyle = ctx.fillStyle = '#ffffff'
        ctx.lineCap = 'round'
        ctx.lineWidth = 0.012
        // Le pictogramme : un homme qui court vers une porte (ISO 7010, E001), à gauche.
        ctx.strokeRect(0.02, 0.025, 0.07, 0.1)
        ctx.beginPath()
        ctx.arc(0.125, 0.04, 0.011, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(0.118, 0.058)
        ctx.lineTo(0.108, 0.09)
        ctx.lineTo(0.092, 0.122)
        ctx.moveTo(0.108, 0.09)
        ctx.lineTo(0.128, 0.105)
        ctx.lineTo(0.13, 0.128)
        ctx.moveTo(0.118, 0.06)
        ctx.lineTo(0.098, 0.075)
        ctx.moveTo(0.118, 0.06)
        ctx.lineTo(0.14, 0.078)
        ctx.stroke()
        ctx.font = '700 0.07px Helvetica, Arial, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('SORTIE', 0.165, h / 2 + 0.003)
      }),
    [l, h],
  )
  // Éclairé de l'intérieur : sans ombre ni lumière, qu'il fasse jour ou nuit.
  const materiaux = useMemo(() => {
    const cote = new THREE.MeshBasicMaterial({ color: '#e8ece8' })
    return [cote, cote, cote, cote, new THREE.MeshBasicMaterial({ map: face, color: face ? '#ffffff' : '#0a8a3a' }), cote]
  }, [face])
  useEffect(() => () => {
    face?.dispose()
    for (const m of new Set(materiaux)) m.dispose()
  }, [face, materiaux])
  return (
    <>
      {liste.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, s.z]} rotation={[0, s.lacet, 0]} material={materiaux}>
          <boxGeometry args={[l, h, e]} />
        </mesh>
      ))}
    </>
  )
}

// ── Le panneau des horaires ─────────────────────────────────────────────────

/** L'émail du panneau Meshy, entre ses deux poteaux (mesuré sur `accessoires.glb`). */
const EMAIL = { largeur: 1.22, hauteur: 0.66, centre: 0.96, devant: 0.05 }

function Horaires() {
  const panneaux = useMemo(() => MOBILIER.filter((m) => m.piece === 'PanneauHoraires'), [])
  const texture = useMemo(() => {
    const quand = (typeof location === 'undefined' ? null : heureDemandee(location.search, new Date())) ?? new Date()
    const lignes = lignesDesHoraires(quand, config.location.latitude, config.location.longitude)
    const { largeur: l, hauteur: h } = EMAIL
    return canevasEnMetres(l, h, 900, (ctx) => {
      ctx.fillStyle = '#123d2c'
      ctx.fillRect(0, 0, l, h)
      ctx.strokeStyle = '#d9c9a0'
      ctx.lineWidth = 0.006
      ctx.strokeRect(0.03, 0.03, l - 0.06, h - 0.06)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#d9c9a0'
      ctx.font = '600 0.05px Georgia, "Times New Roman", serif'
      ctx.fillText(config.name.toUpperCase().split('').join(' '), l / 2, 0.11)
      ctx.fillRect(l / 2 - 0.12, 0.14, 0.24, 0.003)
      ctx.fillStyle = '#f4efe2'
      ctx.font = '400 0.058px Georgia, "Times New Roman", serif'
      ctx.fillText(lignes[0], l / 2, 0.235)
      ctx.font = 'italic 400 0.046px Georgia, "Times New Roman", serif'
      ctx.fillText(lignes[1], l / 2, 0.3)
      ctx.font = '600 0.05px Georgia, "Times New Roman", serif'
      ctx.fillText(lignes[2], l / 2, 0.435)
      ctx.fillStyle = '#d9c9a0'
      ctx.font = '400 0.04px Georgia, "Times New Roman", serif'
      ctx.fillText(lignes[3], l / 2, 0.555)
    })
  }, [])
  const matiere = useMemo(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.05 }), [texture])
  useEffect(() => () => {
    texture?.dispose()
    matiere.dispose()
  }, [texture, matiere])
  if (texture === null) return null
  return (
    <>
      {panneaux.map((m, i) => (
        <group key={i} position={[m.x, m.y, m.z]} rotation={[0, m.lacet, 0]}>
          <mesh position={[0, EMAIL.centre, EMAIL.devant]} material={matiere}>
            <planeGeometry args={[EMAIL.largeur, EMAIL.hauteur]} />
          </mesh>
        </group>
      ))}
    </>
  )
}

// ── L'eau de la fontaine ────────────────────────────────────────────────────

/** Les cotes de la fontaine Meshy à 3 m (mesurées sur `accessoires.glb`) : le grand bassin, la vasque, son débord. */
const BASSIN = { rayon: 1.2, niveau: 0.52 }
const VASQUE = { rayon: 0.4, niveau: 1.71 }

function Fontaines() {
  const fontaines = useMemo(() => MOBILIER.filter((m) => m.piece === 'Fontaine'), [])
  const matieres = useMemo(() => creerMatieresJardin(), [])
  // Un voile mince autour d'une vasque, pas la chute de la cascade : plus clair, sans lueur propre.
  const voile = useMemo(() => {
    const m = matieres.cascade.clone()
    m.opacity = 0.32
    m.emissive.set('#000000')
    return m
  }, [matieres])
  const calme = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  useEffect(() => () => {
    matieres.dispose()
    voile.dispose()
  }, [matieres, voile])
  useFrame(({ clock }) => {
    if (!calme) matieres.animer(clock.elapsedTime, useGameStore.getState().ciel.jour)
  })
  return (
    <>
      {fontaines.map((m, i) => (
        <group key={i} position={[m.x, m.y, m.z]} rotation={[0, m.lacet, 0]}>
          <mesh position={[0, BASSIN.niveau, 0]} rotation={[-Math.PI / 2, 0, 0]} material={matieres.eau}>
            <circleGeometry args={[BASSIN.rayon, 48]} />
          </mesh>
          <mesh position={[0, VASQUE.niveau, 0]} rotation={[-Math.PI / 2, 0, 0]} material={matieres.eau}>
            <circleGeometry args={[VASQUE.rayon, 32]} />
          </mesh>
          {/* Le voile qui déborde de la vasque et tombe dans le bassin, un peu évasé. */}
          <mesh position={[0, (VASQUE.niveau + BASSIN.niveau) / 2 + 0.02, 0]} material={voile}>
            <cylinderGeometry args={[VASQUE.rayon + 0.04, VASQUE.rayon + 0.12, VASQUE.niveau - BASSIN.niveau - 0.02, 32, 1, true]} />
          </mesh>
        </group>
      ))}
    </>
  )
}
