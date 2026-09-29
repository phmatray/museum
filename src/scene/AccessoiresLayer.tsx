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
import { useEffect, useMemo, useRef } from 'react'
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
        // Le boîtier blanc du luminaire, puis la plaque verte : pas de texte,
        // le pictogramme ISO 7010 (E001) et sa flèche disent tout, dans toutes les langues.
        ctx.fillStyle = '#f2f4f1'
        ctx.fillRect(0, 0, l, h)
        const m = 0.012
        const [x0, y0, w, hh] = [m, m, l - 2 * m, h - 2 * m]
        ctx.fillStyle = '#0a8f3c'
        ctx.fillRect(x0, y0, w, hh)
        ctx.fillStyle = '#ffffff'
        // La porte : un cadre blanc, l'embrasure verte, le seuil.
        const [px, py, pw, ph] = [x0 + 0.018, y0 + 0.014, 0.055, hh - 0.028]
        ctx.fillRect(px, py, pw, ph)
        ctx.fillStyle = '#0a8f3c'
        ctx.fillRect(px + 0.008, py + 0.008, pw - 0.02, ph - 0.008)
        ctx.fillStyle = '#ffffff'
        // L'homme qui court, en pleins : tête, tronc penché, bras et jambes en mouvement.
        const u = hh / 0.126
        const S = (x: number, y: number): [number, number] => [px + 0.03 + x * u, py + y * u]
        ctx.beginPath()
        ctx.arc(...S(0.052, 0.018), 0.0095 * u, 0, Math.PI * 2)
        ctx.fill()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = '#ffffff'
        const trait = (w: number, ...pts: [number, number][]) => {
          ctx.lineWidth = w * u
          ctx.beginPath()
          ctx.moveTo(...S(...pts[0]))
          for (const q of pts.slice(1)) ctx.lineTo(...S(...q))
          ctx.stroke()
        }
        trait(0.016, [0.046, 0.034], [0.034, 0.066]) // tronc
        trait(0.01, [0.046, 0.038], [0.064, 0.05], [0.074, 0.04]) // bras avant
        trait(0.01, [0.044, 0.038], [0.028, 0.046], [0.018, 0.06]) // bras arrière
        trait(0.012, [0.034, 0.066], [0.056, 0.078], [0.058, 0.1]) // jambe avant
        trait(0.012, [0.034, 0.066], [0.02, 0.086], [0.002, 0.092]) // jambe arrière
        // La flèche, vers le bas : la sortie est sous le panneau.
        const cx = x0 + w * 0.72
        const [haut, bas, demi] = [y0 + 0.022, y0 + hh - 0.018, 0.022]
        ctx.fillRect(cx - 0.007, haut, 0.014, bas - haut - 0.018)
        ctx.beginPath()
        ctx.moveTo(cx - demi, bas - 0.026)
        ctx.lineTo(cx + demi, bas - 0.026)
        ctx.lineTo(cx, bas)
        ctx.closePath()
        ctx.fill()
      }),
    [l, h],
  )
  // Éclairé de l'intérieur : sans ombre ni lumière, qu'il fasse jour ou nuit.
  const materiaux = useMemo(
    () => [new THREE.MeshBasicMaterial({ color: '#dfe3df' }), new THREE.MeshBasicMaterial({ map: face, color: face ? '#ffffff' : '#0a8a3a' })],
    [face],
  )
  // Tous les blocs en un lot : les cinq faces du boîtier d'abord, puis la face
  // peinte (+z, la cinquième de `BoxGeometry`) — deux groupes, deux appels de dessin en tout.
  const geometrie = useMemo(() => {
    const g = new THREE.BoxGeometry(l, h, e)
    const i = Array.from(g.index!.array)
    g.setIndex([...i.slice(0, 24), ...i.slice(30), ...i.slice(24, 30)])
    g.clearGroups()
    g.addGroup(0, 30, 0)
    g.addGroup(30, 6, 1)
    return g
  }, [l, h, e])
  useEffect(() => () => {
    face?.dispose()
    materiaux.forEach((m) => m.dispose())
  }, [face, materiaux])
  useEffect(() => () => geometrie.dispose(), [geometrie])
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const [un, haut] = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0)]
    liste.forEach((s, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(haut, s.lacet), un)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [liste])
  // Le matériau en prop, jamais dans `args` (#35).
  return <instancedMesh ref={ref} args={[geometrie, undefined, liste.length]} material={materiaux} />
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
