/**
 * La mosaïque des contributions, incrustée dans l'allée de la nef (`plan/mosaique.ts`).
 *
 * Deux `InstancedMesh` : le marbre des jours calmes, et l'or des jours
 * travaillés — du marbre doré pâle au bronze profond, selon les quartiles de
 * GitHub. Le métal ne se règle pas par instance, d'où les deux. Dessous, un
 * panneau de granit sombre porte le cadre de laiton, les initiales des mois et
 * des jours, et l'année : un canevas pour la couleur, un autre pour le métal,
 * un seul appel de dessin. La plaque du total se pose au pied.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { suivre } from '../stores/chargementStore'
import { canevasEnMetres } from './canevas'
import { COTE, dateDuJour, semainesDuLundi, indexDuJour, moisDeLaMosaique, panneau, tesselles, texteDePlaque, type Contributions } from '../plan/mosaique'
import { useCalme } from '../stores/reglagesStore'

/** Du marbre crème au bronze : niveau 0 à 4. */
// Un jour sans activité est une pierre grise, nettement à part de l'or le plus pâle.
const TEINTES = ['#8a847b', '#e8c56c', '#dba43a', '#c2821d', '#9c5f0e']
const LAITON = '#c9a04e'
const GRANIT = '#2f2c29'
const PPM = 200 // pixels par mètre du panneau
const Y = 0.008 // au-dessus des bandes de granit du dallage (6 mm)
const EPAISSEUR = 0.006

let contributions: Promise<Contributions | null> | null = null
function charger() {
  contributions ??= suivre(fetch(`${import.meta.env.BASE_URL}data/contributions.json`))
    .then((r) => (r.ok ? (r.json() as Promise<Contributions>) : null))
    .catch(() => null)
  return contributions
}

const hasard = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export function MosaiqueLayer() {
  const [donnees, setDonnees] = useState<Contributions | null>(null)
  useEffect(() => {
    let vivant = true
    void charger().then((c) => vivant && setDonnees(c))
    return () => {
      vivant = false
    }
  }, [])

  const mosaique = useMemo(() => {
    if (donnees === null || donnees.weeks.length === 0) return null
    const t = tesselles(donnees.weeks)
    const p = panneau(semainesDuLundi(donnees.weeks).length)
    const [l, h] = [p.x1 - p.x0, p.z1 - p.z0]
    const tx0 = Math.min(...t.map((j) => j.x)) - COTE / 2
    const tx1 = Math.max(...t.map((j) => j.x)) + COTE / 2
    const tz0 = Math.min(...t.map((j) => j.z)) - COTE / 2
    const tz1 = Math.max(...t.map((j) => j.z)) + COTE / 2
    const mois = moisDeLaMosaique(donnees.weeks)
    const annees = [...new Set([t[0].date.slice(0, 4), t[t.length - 1].date.slice(0, 4)])].join(' — ')
    // Le panneau est vu depuis le sud : le haut du canevas est au nord (z0), la gauche à l'ouest (x0).
    const trace = (ctx: CanvasRenderingContext2D, fond: string, metal: string) => {
      ctx.fillStyle = fond
      ctx.fillRect(0, 0, l, h)
      ctx.strokeStyle = metal
      ctx.fillStyle = metal
      ctx.lineWidth = 0.035
      ctx.strokeRect(0.05, 0.05, l - 0.1, h - 0.1)
      ctx.lineWidth = 0.012
      ctx.strokeRect(tx0 - p.x0 - 0.05, tz0 - p.z0 - 0.05, tx1 - tx0 + 0.1, tz1 - tz0 + 0.1)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 0.17px Georgia, "Times New Roman", serif'
      for (const m of mois) ctx.fillText(m.lettre, (tx0 - p.x0 - 0.05) / 2 + 0.02, m.z - p.z0)
      ctx.font = '600 0.12px Georgia, "Times New Roman", serif'
      ;[...'LMMJVSD'].forEach((j, d) => ctx.fillText(j, tx0 - p.x0 + (d + 0.5) * 0.25, tz1 - p.z0 + 0.2))
      ctx.font = '600 0.16px Georgia, "Times New Roman", serif'
      ctx.fillText(annees, l / 2, (tz0 - p.z0) / 2 + 0.03)
    }
    const couleur = canevasEnMetres(l, h, PPM, (ctx) => {
      trace(ctx, GRANIT, LAITON)
      // Le grain du granit, sous le laiton : on redessine le laiton par-dessus.
      for (let i = 0; i < 6000; i++) {
        ctx.fillStyle = hasard(i) < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,245,230,0.07)'
        ctx.fillRect(hasard(i + 7) * l, hasard(i + 13) * h, 0.012, 0.012)
      }
      trace(ctx, 'rgba(0,0,0,0)', LAITON)
    })
    const metal = canevasEnMetres(l, h, PPM, (ctx) => trace(ctx, '#000', '#fff'), false)
    return { t, p, l, h, couleur, metal, total: donnees.total }
  }, [donnees])
  useEffect(() => () => {
    mosaique?.couleur?.dispose()
    mosaique?.metal?.dispose()
  }, [mosaique])

  const marbre = useRef<THREE.InstancedMesh>(null)
  const or = useRef<THREE.InstancedMesh>(null)
  const jour = useRef<{ mesh: THREE.InstancedMesh; i: number; base: THREE.Color } | null>(null)
  const calmes = useMemo(() => mosaique?.t.filter((j) => j.level === 0) ?? [], [mosaique])
  const dores = useMemo(() => mosaique?.t.filter((j) => j.level > 0) ?? [], [mosaique])

  useEffect(() => {
    if (mosaique === null) return
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    const aujourdhui = mosaique.t[indexDuJour(mosaique.t, dateDuJour(new Date()))]
    for (const [mesh, liste] of [[marbre.current, calmes], [or.current, dores]] as const) {
      if (mesh === null) continue
      liste.forEach((j, i) => {
        m.makeTranslation(j.x, Y + EPAISSEUR / 2, j.z)
        mesh.setMatrixAt(i, m)
        // Chaque tesselle a sa nuance : une mosaïque n'est jamais d'une seule teinte.
        c.set(TEINTES[j.level]).offsetHSL(0, 0, (hasard(i + j.level * 97) - 0.5) * 0.05)
        mesh.setColorAt(i, c)
        if (j === aujourdhui) jour.current = { mesh, i, base: c.clone() }
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Sans quoi la sphère englobante reste celle d'avant les matrices, à l'origine du plan.
      mesh.computeBoundingSphere()
    }
  }, [mosaique, calmes, dores])

  // La tesselle du jour respire doucement, sauf si le visiteur a demandé moins de mouvement.
  const calme = useCalme()
  const eclat = useMemo(() => new THREE.Color('#fff4d0'), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }) => {
    const j = jour.current
    if (j === null || !j.mesh.instanceColor) return
    const f = calme ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2)
    j.mesh.setColorAt(j.i, tmp.copy(j.base).lerp(eclat, 0.75 * f))
    j.mesh.instanceColor.needsUpdate = true
  })

  const plaque = useMemo(
    () =>
      mosaique &&
      canevasEnMetres(1.9, 0.34, 600, (ctx) => {
        ctx.fillStyle = LAITON
        ctx.fillRect(0, 0, 1.9, 0.34)
        ctx.strokeStyle = '#6b4f1d'
        ctx.lineWidth = 0.008
        ctx.strokeRect(0.02, 0.02, 1.86, 0.3)
        ctx.fillStyle = '#3d2a0c'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '600 0.1px Georgia, "Times New Roman", serif'
        ctx.fillText(texteDePlaque(mosaique.total), 0.95, 0.175)
      }),
    [mosaique],
  )
  useEffect(() => () => plaque?.dispose(), [plaque])

  if (mosaique === null || mosaique.couleur === null) return null
  const { p, l, h } = mosaique
  return (
    <group>
      <mesh position={[(p.x0 + p.x1) / 2, Y - 0.001, (p.z0 + p.z1) / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[l, h]} />
        <meshStandardMaterial map={mosaique.couleur} metalnessMap={mosaique.metal} metalness={0.5} roughness={0.35} />
      </mesh>
      <instancedMesh key={`m${calmes.length}`} ref={marbre} args={[undefined, undefined, calmes.length]} material={MARBRE}>
        <boxGeometry args={[COTE, EPAISSEUR, COTE]} />
      </instancedMesh>
      <instancedMesh key={`o${dores.length}`} ref={or} args={[undefined, undefined, dores.length]} material={OR}>
        <boxGeometry args={[COTE, EPAISSEUR, COTE]} />
      </instancedMesh>
      {plaque && (
        <mesh position={[(p.x0 + p.x1) / 2, 0.012, p.z1 + 0.3]}>
          <boxGeometry args={[1.9, 0.024, 0.34]} />
          <meshStandardMaterial map={plaque} metalness={0.5} roughness={0.35} />
        </mesh>
      )}
    </group>
  )
}

const MARBRE = new THREE.MeshStandardMaterial({ roughness: 0.3 })
const OR = new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.3 })
