/**
 * Le tableau des départs, suspendu sous l'horloge de la nef (`domain/departs.ts`).
 *
 * Un canevas porte les palettes ; on ne le redessine que pendant qu'elles
 * tournent, puis plus rien jusqu'à la page suivante. Un seul plan, un seul
 * appel de dessin, lisible depuis l'entrée à vingt-cinq mètres.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { COLONNES, dureeVolets, ligneEnPalettes, lignesDeDeparts, palettes, voletsA } from '../domain/departs'
import { useAccrochage } from '../hooks/useAccrochage'
import { useCatalogue } from '../hooks/useCatalogue'

/** Sous l'horloge du pignon nord (`build-nef.py` : cadran à +14,80, z = 12,6). */
const CENTRE: [number, number, number] = [24, 11.2, 12.95]
const LARGEUR = 8.4
const LIGNES = 6
const PAGES = 2
const PAGE_MS = 12000

const [CW, CH] = [2048, 640]
const CELLULE = { w: 30, h: 70, pas: 80 }
const HAUT_LIGNES = 150
const LARGEUR_LIGNE = COLONNES.depuis + COLONNES.destination + COLONNES.langage + COLONNES.salle + 3
const MARGE = (CW - LARGEUR_LIGNE * CELLULE.w) / 2

function dessiner(ctx: CanvasRenderingContext2D, lignes: string[]) {
  ctx.fillStyle = '#101214'
  ctx.fillRect(0, 0, CW, CH)
  ctx.fillStyle = '#f2b705'
  ctx.font = '600 58px Helvetica, Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('MES DERNIERS PROJETS', MARGE, 48)
  ctx.font = '400 28px Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#9aa0a6'
  ctx.textAlign = 'right'
  ctx.fillText('LES DERNIERS DÉPÔTS POUSSÉS', CW - MARGE, 52)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f2b705'
  let x = MARGE
  for (const [titre, n] of [['PUSH', COLONNES.depuis], ['DESTINATION', COLONNES.destination], ['LANGAGE', COLONNES.langage], ['SALLE', COLONNES.salle]] as const) {
    ctx.fillText(titre, x + 4, 118)
    x += (n + 1) * CELLULE.w
  }
  ctx.font = '700 48px Helvetica, Arial, sans-serif'
  ctx.textAlign = 'center'
  lignes.forEach((ligne, j) => {
    const y = HAUT_LIGNES + j * CELLULE.pas
    ;[...ligne].forEach((c, i) => {
      const cx = MARGE + i * CELLULE.w
      ctx.fillStyle = '#1e2124'
      ctx.fillRect(cx + 1, y, CELLULE.w - 2, CELLULE.h)
      ctx.fillStyle = '#0a0b0c'
      ctx.fillRect(cx + 1, y + CELLULE.h / 2 - 1, CELLULE.w - 2, 2)
      if (c === ' ') return
      ctx.fillStyle = i < COLONNES.depuis ? '#f2b705' : '#f4f1e6'
      ctx.fillText(c, cx + CELLULE.w / 2, y + CELLULE.h / 2 + 2)
    })
  })
}

export function TableauDeparts() {
  const catalogue = useCatalogue()
  const accrochage = useAccrochage()
  const salles = useMemo(() => new Map(accrochage?.rooms.flatMap((r) => r.placements.map((p) => [p.key, r.name] as const)) ?? []), [accrochage])

  const toile = useMemo(() => {
    const canevas = document.createElement('canvas')
    canevas.width = CW
    canevas.height = CH
    const ctx = canevas.getContext('2d')
    if (ctx === null) return null // jsdom
    const texture = new THREE.CanvasTexture(canevas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return { ctx, texture }
  }, [])
  useEffect(() => () => toile?.texture.dispose(), [toile])

  const vide = useMemo(() => Array.from({ length: LIGNES }, () => palettes('', LARGEUR_LIGNE)), [])
  const etat = useRef({ avant: vide, apres: vide, debut: 0, page: -1, fini: false })

  /* eslint-disable react-hooks/immutability -- la texture du canevas, rafraîchie en place */
  useFrame(() => {
    if (toile === null || catalogue === null || salles.size === 0) return
    const maintenant = performance.now()
    const e = etat.current
    const page = Math.floor(Date.now() / PAGE_MS) % PAGES
    if (page !== e.page) {
      // Une nouvelle page : on part de ce qui est affiché, on vise les lignes suivantes.
      const lignes = lignesDeDeparts(catalogue.values(), salles, new Date(), LIGNES * PAGES).slice(page * LIGNES, (page + 1) * LIGNES).map(ligneEnPalettes)
      e.avant = e.apres
      e.apres = [...lignes, ...vide].slice(0, LIGNES)
      e.debut = maintenant
      e.page = page
      e.fini = false
    }
    if (e.fini) return
    const ms = maintenant - e.debut
    dessiner(toile.ctx, e.apres.map((l, j) => voletsA(e.avant[j], l, ms)))
    toile.texture.needsUpdate = true
    e.fini = ms > dureeVolets(LARGEUR_LIGNE)
  })
  /* eslint-enable react-hooks/immutability */

  if (toile === null) return null
  const hauteur = (LARGEUR * CH) / CW
  return (
    <group position={CENTRE}>
      {/* Le caisson d'acier vert sombre des tableaux de gare, et ses deux suspentes. */}
      <mesh position={[0, 0, -0.07]}>
        <boxGeometry args={[LARGEUR + 0.3, hauteur + 0.3, 0.12]} />
        <meshStandardMaterial color="#1c2620" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-3.5, 3.5].map((x) => (
        <mesh key={x} position={[x, hauteur / 2 + 3, -0.07]}>
          <cylinderGeometry args={[0.02, 0.02, 6, 6]} />
          <meshStandardMaterial color="#1c2620" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh>
        <planeGeometry args={[LARGEUR, hauteur]} />
        <meshBasicMaterial map={toile.texture} toneMapped={false} />
      </mesh>
    </group>
  )
}
