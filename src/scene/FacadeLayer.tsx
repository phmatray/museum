/**
 * La façade à l'écran (`plan/facade.ts`) : brique, portique de pierre, le nom
 * du musée, deux bannières qui annoncent les pièces maîtresses de la salle
 * d'honneur, et quatre drapeaux aux couleurs de Microsoft : la collection est
 * d'abord du C#.
 */
import { Suspense, useEffect, useMemo } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

import config from '../../museum.config.json'
import { useVitrines } from '../hooks/useCatalogue'
import { useGameStore } from '../stores/gameStore'
import { facade, lignesDeBanniere } from '../plan/facade'
import { MUSEE } from '../plan/musee'
import { CARTEL_FONT, TITRE_FONT } from './cartelStyle'
import { useMatiere } from './materials'
import { Boites } from './PlanBuilding'
import { creerVitrage } from '../builders/glazing'
import { intemperer } from './intemperies'
import { creerBrique, creerCannelure, creerGranit, creerPierre } from './pierre'

const FACADE = facade(MUSEE)
/** Les quatre carrés du logo Microsoft, dans l'ordre du logo. */
const DRAPEAUX = ['#f25022', '#7fba00', '#00a4ef', '#ffb900']
const MAT = 4
const DRAPEAU: [number, number] = [1.5, 1]

export function FacadeLayer() {
  const mats = useMemo(() => {
    const m = {
      brique: creerBrique(),
      pierre: creerPierre(),
      cannelure: creerCannelure(),
      metal: creerGranit(),
      vitre: new THREE.MeshStandardMaterial({ color: '#1f2b31', metalness: 0.6, roughness: 0.12 }),
      // Le verre des portes : clair, on voit le hall au travers.
      clair: creerVitrage(),
    }
    // La brique fonce sous la pluie ; la neige tient sur les corniches et les appuis (`intemperies.ts`).
    for (const k of ['brique', 'pierre', 'cannelure', 'metal'] as const) intemperer(m[k])
    return m
  }, [])
  useEffect(() => () => Object.values(mats).forEach((m) => { m.map?.dispose(); m.dispose() }), [mats])
  const acier = useMatiere('metal')
  // La nuit, les lettres s'allument, comme une enseigne rétroéclairée.
  const nuit = 1 - useGameStore((s) => s.ciel.jour)

  return (
    <group name="facade">
      <Boites boites={FACADE.brique} material={mats.brique} />
      <Boites boites={FACADE.pierre} material={mats.pierre} />
      <Boites boites={FACADE.piliers} material={mats.cannelure} />
      <Boites boites={FACADE.vitres} material={mats.vitre} />
      <Boites boites={FACADE.portes} material={mats.clair} />
      <Boites boites={FACADE.menuiseries} material={mats.metal} />
      <Suspense fallback={null}>
        <Text
          font={CARTEL_FONT}
          position={[FACADE.enseigne.x, FACADE.enseigne.y, FACADE.enseigne.z]}
          fontSize={0.72}
          letterSpacing={0.14}
          color={nuit > 0.5 ? '#ffd98a' : '#3a2c1c'}
          anchorX="center"
          anchorY="middle"
        >
          {config.name.toUpperCase()}
        </Text>
        <Bannieres />
      </Suspense>
      {FACADE.mats.map((m, i) => (
        <Drapeau key={i} position={[m.x, m.y, m.z]} couleur={DRAPEAUX[i % DRAPEAUX.length]} acier={acier} />
      ))}
    </group>
  )
}

/** Le fond de chaque bannière : deux teintes profondes qui tranchent sur la brique rouge. */
const FONDS_BANNIERE = ['#15304f', '#0c4841']
const CREME = '#f3ead8'
const OR = '#d8b060'

/**
 * Les deux bannières annoncent les deux premières vitrines de la salle
 * d'honneur (`plan/vitrines.ts`) : les dépôts les plus étoilés DES PROPRIÉTAIRES,
 * jamais un fork ni le dépôt d'un tiers. Elles lisaient les deux premières
 * toiles accrochées, et la plus étoilée était celle d'un autre
 * (`ivanpaulovich/clean-architecture-manga`, où Philippe n'est que
 * collaborateur) — en gris pâle de 16 cm sur du blanc, illisible du jardin.
 * Comme une vraie bannière de musée : un aplat franc, le titre en grand.
 */
function Bannieres() {
  const vitrines = useVitrines()
  // Une encre ÉCLAIRÉE : le matériau par défaut du texte ignore la lumière, et
  // les lettres luisaient la nuit sur une toile éteinte.
  const encre = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), [])
  useEffect(() => () => encre.dispose(), [encre])
  return (
    <>
      {FACADE.bannieres.map((b, i) => {
        const oeuvre = vitrines?.[i]
        if (!oeuvre) return null
        const lignes = lignesDeBanniere(oeuvre.name)
        // Le corps suit la plus longue ligne (0,52 em par signe), plafonné à 78 cm.
        const corps = Math.min(0.78, (b.w - 0.5) / (Math.max(...lignes.map((l) => l.length)) * 0.52))
        const chiffres = [`${oeuvre.stars} étoiles`, oeuvre.language].filter(Boolean).join('  ·  ')
        const texte = { font: CARTEL_FONT, anchorX: 'center', anchorY: 'middle', material: encre } as const
        return (
          <group key={oeuvre.key} position={[b.x, b.y, b.z]}>
            <mesh>
              <planeGeometry args={[b.w, b.h]} />
              <meshStandardMaterial color={FONDS_BANNIERE[i % FONDS_BANNIERE.length]} roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
            {/* La hampe en haut, la barre de lest en bas. */}
            {[b.h / 2 + 0.03, -b.h / 2 - 0.03].map((y) => (
              <mesh key={y} position={[0, y, 0.02]}>
                <boxGeometry args={[b.w + 0.2, 0.05, 0.05]} />
                <meshStandardMaterial color="#2b2a28" metalness={0.6} roughness={0.4} />
              </mesh>
            ))}
            {[b.h / 2 - 0.72, -b.h / 2 + 0.62].map((y) => (
              <mesh key={y} position={[0, y, 0.005]}>
                <planeGeometry args={[b.w - 0.6, 0.03]} />
                <meshStandardMaterial color={OR} roughness={0.6} metalness={0.3} />
              </mesh>
            ))}
            <Text {...texte} position={[0, b.h / 2 - 0.42, 0.01]} fontSize={0.2} letterSpacing={0.18} color={CREME}>
              {config.name.toUpperCase()}
            </Text>
            <Text {...texte} position={[0, b.h / 2 - 1.0, 0.01]} fontSize={0.19} letterSpacing={0.14} color={OR}>
              SALLE D’HONNEUR
            </Text>
            <Text {...texte} font={TITRE_FONT} position={[0, 0.75, 0.01]} fontSize={corps} lineHeight={1.02} textAlign="center" color={CREME} outlineWidth={corps * 0.02} outlineColor={CREME}>
              {lignes.join('\n')}
            </Text>
            <Text {...texte} position={[0, -1.25, 0.01]} fontSize={0.24} letterSpacing={0.06} color={OR}>
              {chiffres}
            </Text>
            <Text {...texte} position={[0, -2.1, 0.01]} fontSize={0.15} lineHeight={1.3} maxWidth={b.w - 0.6} textAlign="center" color={CREME} fillOpacity={0.85}>
              {resume(oeuvre.description)}
            </Text>
            <Text {...texte} position={[0, -b.h / 2 + 0.36, 0.01]} fontSize={0.18} letterSpacing={0.1} color={CREME}>
              {oeuvre.owner}
            </Text>
          </group>
        )
      })}
    </>
  )
}

/** La première phrase de la description, coupée au mot vers 90 signes : trois lignes au plus. */
function resume(texte: string): string {
  const phrase = texte.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s|\s[—–-]\s/)[0].replace(/[.:;,]$/, '')
  return phrase.length <= 90 ? phrase : `${phrase.slice(0, phrase.lastIndexOf(' ', 88))}…`
}

/** Un mât et son drapeau, ondulé une fois pour toutes : une toile au vent, pas une planche. */
function Drapeau({ position, couleur, acier }: { position: [number, number, number]; couleur: string; acier: THREE.Material }) {
  const toile = useMemo(() => {
    const g = new THREE.PlaneGeometry(DRAPEAU[0], DRAPEAU[1], 16, 4)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + DRAPEAU[0] / 2
      p.setZ(i, Math.sin(x * 3.2) * 0.08 * x)
    }
    g.computeVertexNormals()
    g.translate(DRAPEAU[0] / 2, 0, 0)
    return g
  }, [])
  useEffect(() => () => toile.dispose(), [toile])
  return (
    <group position={position}>
      <mesh position={[0, MAT / 2, 0]} material={acier}>
        <cylinderGeometry args={[0.035, 0.05, MAT, 8]} />
      </mesh>
      <mesh geometry={toile} position={[0.04, MAT - DRAPEAU[1] / 2 - 0.05, 0]} rotation={[0, Math.PI / 5, 0]}>
        <meshStandardMaterial color={couleur} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
