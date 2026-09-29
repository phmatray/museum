/**
 * Le compteur de visites, au mur sud du hall, à gauche de l'entrée en sortant
 * (`domain/compteur.ts`) : six tambours de laiton gravés, sur une planche de
 * noyer, sous une plaque « Visiteurs ».
 *
 * Les tambours sont un seul `InstancedMesh` : une matrice par tambour, une
 * texture de onze faces partagée. On compte la visite une fois par session ;
 * le compteur montre d'abord le nombre d'avant, puis bascule d'un cran : c'est
 * vous. Si le service ne répond pas, des tirets, et rien d'autre ne bouge.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { FACES, TAILLE, TIRET, URL_COMPTEUR, chiffres, compterLaVisite, dureeDuCompteur, faceDuTambour } from '../domain/compteur'
import { canevasEnMetres } from './canevas'

/** Au mur sud du hall (face à z 39,85), entre l'angle et les vantaux de l'entrée (x 22,4). */
const CENTRE: [number, number, number] = [20, 1.5, 39.84]
const RAYON = 0.09
const LARGEUR_TAMBOUR = 0.068
const PAS = 0.082
/** Dans le repère du compteur, le hall est devant (+z) : le groupe est retourné vers le nord. */
const Z_TAMBOUR = 0.13
const LAITON = '#c9a04e'

export function CompteurLayer() {
  const faces = useMemo(
    () =>
      // Autour du tambour (u) les onze faces ; le long de l'axe (v) la largeur d'un chiffre.
      canevasEnMetres(FACES, 1, 128, (ctx) => {
        ctx.fillStyle = '#e0bd6a'
        ctx.fillRect(0, 0, FACES, 1)
        ctx.fillStyle = '#1d150a'
        ctx.font = '700 0.62px Georgia, "Times New Roman", serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let k = 0; k < FACES; k++) {
          ctx.save()
          ctx.translate(k + 0.5, 0.5)
          // Le haut d'un chiffre regarde le haut du tambour, c'est-à-dire les u décroissants.
          ctx.rotate(-Math.PI / 2)
          ctx.scale(1, 1.25)
          ctx.fillText(k === TIRET ? '—' : String(k), 0, 0.02)
          ctx.restore()
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.fillRect(k, 0, 0.02, 1)
          ctx.fillStyle = '#1d150a'
        }
      }),
    [],
  )
  const plaque = useMemo(
    () =>
      canevasEnMetres(0.62, 0.12, 800, (ctx) => {
        ctx.fillStyle = LAITON
        ctx.fillRect(0, 0, 0.62, 0.12)
        ctx.strokeStyle = '#6b4f1d'
        ctx.lineWidth = 0.004
        ctx.strokeRect(0.01, 0.01, 0.6, 0.1)
        ctx.fillStyle = '#3d2a0c'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '600 0.05px Georgia, "Times New Roman", serif'
        ctx.fillText('VISITEURS', 0.31, 0.047)
        ctx.font = 'italic 0.024px Georgia, "Times New Roman", serif'
        ctx.fillText('depuis l’ouverture du musée', 0.31, 0.087)
      }),
    [],
  )
  useEffect(() => () => {
    faces?.dispose()
    plaque?.dispose()
  }, [faces, plaque])

  const materiaux = useMemo(
    () => ({
      tambour: new THREE.MeshStandardMaterial({ map: faces, metalness: 0.45, roughness: 0.35 }),
      laiton: new THREE.MeshStandardMaterial({ color: '#6e5022', metalness: 0.6, roughness: 0.4 }),
      plaque: new THREE.MeshStandardMaterial({ map: plaque, metalness: 0.45, roughness: 0.35 }),
      noyer: new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.5 }),
      ombre: new THREE.MeshStandardMaterial({ color: '#15110d', roughness: 0.8 }),
    }),
    [faces, plaque],
  )
  useEffect(() => () => Object.values(materiaux).forEach((m) => m.dispose()), [materiaux])

  // Des tirets, puis le nombre d'avant, puis le vôtre.
  const etat = useRef({ de: chiffres(null), a: chiffres(null), debut: 0 })
  const suivants = useRef<{ a: number[]; quand: number }[]>([])
  useEffect(() => {
    let vivant = true
    const session = (() => {
      try {
        return sessionStorage
      } catch {
        return null
      }
    })()
    // En développement on lit le compteur sans l'incrémenter : les rechargements ne sont pas des visites.
    void compterLaVisite(session, fetch, import.meta.env.DEV ? URL_COMPTEUR.replace('/hit/', '/get/') : URL_COMPTEUR).then((n) => {
      if (!vivant || n === null) return
      const t = performance.now() / 1000
      suivants.current.push({ a: chiffres(n - 1), quand: t + 0.5 }, { a: chiffres(n), quand: t + 2.5 })
    })
    return () => {
      vivant = false
    }
  }, [])

  const tambours = useRef<THREE.InstancedMesh>(null)
  const calme = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const m = useMemo(() => ({ mat: new THREE.Matrix4(), rot: new THREE.Matrix4(), axe: new THREE.Matrix4().makeRotationZ(-Math.PI / 2) }), [])
  const fini = useRef(-1)
  useFrame(() => {
    const mesh = tambours.current
    if (mesh === null) return
    const t = performance.now() / 1000
    const e = etat.current
    const prochain = suivants.current[0]
    if (prochain && t >= prochain.quand) {
      suivants.current.shift()
      // On repart de ce qui est affiché, même si la rotation précédente n'est pas finie.
      e.de = e.a
      e.a = prochain.a
      e.debut = t
    }
    // Une rotation finie ne se redessine plus — mais seulement une fois la face
    // d'arrivée posée : s'arrêter sur la dernière image d'animation laissait un
    // tambour entre deux chiffres, voire sur ses tirets.
    if (fini.current === e.debut) return
    const ecoule = calme ? Infinity : t - e.debut
    for (let i = 0; i < TAILLE; i++) {
      const face = faceDuTambour(e.de[i], e.a[i], ecoule)
      // La face k est à u = (k + ½)/FACES, à cet angle sous l'avant du tambour : on l'y ramène.
      m.rot.makeRotationX((-(face + 0.5) / FACES) * 2 * Math.PI)
      m.mat.makeTranslation((i - (TAILLE - 1) / 2) * PAS, 0, Z_TAMBOUR).multiply(m.rot).multiply(m.axe)
      mesh.setMatrixAt(i, m.mat)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (ecoule >= dureeDuCompteur(e.de, e.a)) fini.current = e.debut
  })

  if (faces === null) return null // jsdom
  const largeur = TAILLE * PAS
  return (
    <group position={CENTRE} rotation-y={Math.PI}>
      {/* La planche de noyer, puis le carter sombre d'où sortent les tambours. */}
      <mesh position={[0, 0.06, 0.015]} material={materiaux.noyer}>
        <boxGeometry args={[largeur + 0.26, 0.42, 0.03]} />
      </mesh>
      <mesh position={[0, 0, 0.07]} material={materiaux.ombre}>
        <boxGeometry args={[largeur + 0.02, 0.2, 0.08]} />
      </mesh>
      <instancedMesh ref={tambours} args={[undefined, undefined, TAILLE]} material={materiaux.tambour} frustumCulled={false}>
        <cylinderGeometry args={[RAYON, RAYON, LARGEUR_TAMBOUR, 40, 1, true]} />
      </instancedMesh>
      {/* La lunette de laiton : deux lèvres qui ne laissent voir qu'une face par tambour. */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, s * 0.068, Z_TAMBOUR + RAYON - 0.015]} material={materiaux.laiton}>
          <boxGeometry args={[largeur + 0.05, 0.072, 0.06]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (largeur + 0.05)) / 2, 0, Z_TAMBOUR / 2 + 0.03]} material={materiaux.laiton}>
          <boxGeometry args={[0.025, 0.162, 0.2]} />
        </mesh>
      ))}
      <mesh position={[0, 0.195, 0.035]} material={materiaux.plaque}>
        <planeGeometry args={[0.62, 0.12]} />
      </mesh>
    </group>
  )
}
