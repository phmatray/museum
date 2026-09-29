/**
 * « L'atelier en coupe » (`plan/ateliers.ts`) : sous chaque vitrine de la
 * salle d'honneur, l'architecture du même projet en vue éclatée — un socle de
 * bois cerclé de laiton, des plaques de verre superposées (les couches), des
 * blocs (ses projets, à la taille de leur code) et des fils lumineux (ses
 * références), le long desquels une impulsion monte lentement de la dépendance
 * vers qui s'en sert. Les données viennent du dépôt (`public/data/ateliers.json`,
 * `tools/fetch-ateliers.ts`).
 *
 * Quatre lots d'instances pour les trois ateliers (bois, laiton, verre, blocs),
 * un seul maillage pour tous les fils, et le texte par troika comme les cartels.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Atelier } from '../domain/atelier'
import { useVitrines } from '../hooks/useCatalogue'
import { useGameStore } from '../stores/gameStore'
import { ATELIERS, disposerCoupe, PLAQUE, RECUL_PLAQUES, SOCLE_ATELIER, type Coupe } from '../plan/ateliers'
import { CARTEL_FONT, TITRE_FONT } from './cartelStyle'

/** La teinte de chaque couche, du socle aux tests : cuivre, or, paille, puis un bleu-vert et un vert sauge. */
const TEINTES: Record<string, string> = {
  socle: '#b8703a', extensions: '#d4a040', assemblages: '#e6cf8c', demonstrations: '#4f9a9c', tests: '#8aa46e',
}
const CREME = '#f4ead2'
const ENCRE = '#2a2620'
const FIL = '#ffc46b'
/** Le filet de laiton sous chaque légende, du montant vers la gauche. */
const FILET = 0.27

let donnees: Promise<Atelier[]> | null = null
function useAteliers(): Atelier[] | null {
  const [ateliers, setAteliers] = useState<Atelier[] | null>(null)
  useEffect(() => {
    let vivant = true
    donnees ??= fetch(`${import.meta.env.BASE_URL}data/ateliers.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ateliers: Atelier[] }>) : { ateliers: [] }))
      .then((j) => j.ateliers)
      .catch(() => [])
    void donnees.then((a) => vivant && setAteliers(a))
    return () => {
      vivant = false
    }
  }, [])
  return ateliers
}

interface Boite {
  p: [number, number, number]
  s: [number, number, number]
  c?: string
}

interface Expose {
  x: number
  z: number
  atelier: Atelier
  coupe: Coupe
}

/** Le cadre de laiton d'un atelier, en coordonnées locales : quatre montants, la ceinture du haut, et un rebord sous chaque plaque. */
function laiton(coupe: Coupe): Boite[] {
  const [lx, lz] = [PLAQUE.largeur / 2 + 0.018, PLAQUE.profondeur / 2 + 0.018]
  const bas = SOCLE_ATELIER.hauteur
  const h = coupe.hauteur - bas
  const out: Boite[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: [sx * lx, bas + h / 2, RECUL_PLAQUES + sz * lz], s: [0.022, h, 0.022] })
  for (const sz of [-1, 1]) out.push({ p: [0, coupe.hauteur, RECUL_PLAQUES + sz * lz], s: [2 * lx + 0.022, 0.018, 0.018] })
  for (const sx of [-1, 1]) out.push({ p: [sx * lx, coupe.hauteur, RECUL_PLAQUES], s: [0.018, 0.018, 2 * lz] })
  // Les deux lisses qui portent chaque plaque, d'un montant à l'autre.
  for (const pl of coupe.plaques) for (const sx of [-1, 1]) out.push({ p: [sx * (lx - 0.004), pl.y - PLAQUE.epaisseur / 2 - 0.006, RECUL_PLAQUES], s: [0.02, 0.012, 2 * lz] })
  // Le jonc de laiton qui cercle le haut du socle (le bois reste visible dedans), et la plinthe.
  const [sx, sz] = [SOCLE_ATELIER.largeur / 2, SOCLE_ATELIER.profondeur / 2]
  for (const s of [-1, 1]) {
    out.push({ p: [0, bas + 0.004, s * (sz - 0.015)], s: [2 * sx + 0.012, 0.012, 0.042] })
    out.push({ p: [s * (sx - 0.015), bas + 0.004, 0], s: [0.042, 0.012, 2 * sz + 0.012] })
  }
  out.push({ p: [0, 0.03, 0], s: [2 * sx + 0.008, 0.06, 2 * sz + 0.008] })
  // Sous chaque légende, un filet de laiton qui la rattache au coin de sa plaque.
  for (const pl of coupe.plaques) out.push({ p: [-lx - FILET / 2, pl.y, RECUL_PLAQUES + lz], s: [FILET, 0.004, 0.004] })
  return out
}

export function AteliersLayer() {
  const ateliers = useAteliers()
  const vitrines = useVitrines()
  const exposes = useMemo<Expose[]>(() => {
    if (!ateliers || !vitrines) return []
    return ATELIERS.flatMap((place) => {
      const atelier = ateliers.find((a) => a.key === vitrines[place.rang]?.key)
      return atelier ? [{ x: place.x, z: place.z, atelier, coupe: disposerCoupe(atelier) }] : []
    })
  }, [ateliers, vitrines])

  const lots = useMemo(() => {
    const monde = (e: { x: number; z: number }, b: Boite): Boite => ({ ...b, p: [e.x + b.p[0], b.p[1], e.z + b.p[2]] })
    const bois = ATELIERS.map((a) => ({ p: [a.x, SOCLE_ATELIER.hauteur / 2, a.z], s: [SOCLE_ATELIER.largeur, SOCLE_ATELIER.hauteur, SOCLE_ATELIER.profondeur] }) as Boite)
    const cuivre = exposes.flatMap((e) => laiton(e.coupe).map((b) => monde(e, b)))
    const verre = exposes.flatMap((e) =>
      e.coupe.plaques.map((pl) => monde(e, { p: [0, pl.y, RECUL_PLAQUES], s: [PLAQUE.largeur, PLAQUE.epaisseur, PLAQUE.profondeur] })),
    )
    const blocs = exposes.flatMap((e) =>
      e.coupe.blocs.map((b) => monde(e, { p: [b.x, b.y, b.z], s: [b.cote, b.hauteur, b.cote], c: TEINTES[e.atelier.couches[b.couche].id] ?? CREME })),
    )
    return { bois, cuivre, verre, blocs }
  }, [exposes])

  const materiaux = useMemo(
    () => ({
      bois: new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.5 }),
      laiton: new THREE.MeshStandardMaterial({ color: '#8c6a2c', metalness: 0.65, roughness: 0.32 }),
      // « verre » dans le nom : `OmbresLayer` ne lui fait pas porter d'ombre.
      verre: new THREE.MeshStandardMaterial({ name: 'verre-atelier', color: '#dff0ea', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false }),
      blocs: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.1, emissive: '#3a2a14', emissiveIntensity: 0.6 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(materiaux).forEach((m) => m.dispose()), [materiaux])
  // La nuit, les blocs luisent un peu plus : la coupe reste lisible quand la galerie s'éteint.
  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    materiaux.blocs.emissiveIntensity = 0.6 + 1.4 * nuit
    /* eslint-enable */
  }, [materiaux, nuit])

  return (
    <group name="ateliers">
      <Lot boites={lots.bois} materiau={materiaux.bois} />
      <Lot boites={lots.cuivre} materiau={materiaux.laiton} />
      <Lot boites={lots.blocs} materiau={materiaux.blocs} />
      <Lot boites={lots.verre} materiau={materiaux.verre} />
      <Fils exposes={exposes} />
      {exposes.map((e) => (
        <Suspense key={e.atelier.key} fallback={null}>
          <Legendes expose={e} />
        </Suspense>
      ))}
    </group>
  )
}

/** Des boîtes en un lot d'instances : un cube unité, mis à l'échelle par instance. */
function Lot({ boites, materiau }: { boites: Boite[]; materiau: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometrie = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  useEffect(() => () => geometrie.dispose(), [geometrie])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null || boites.length === 0) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const couleur = new THREE.Color()
    boites.forEach((b, i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(...b.s)))
      if (b.c) mesh.setColorAt(i, couleur.set(b.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [boites])
  if (boites.length === 0) return null
  // Le matériau en prop, jamais dans `args` (#35).
  return <instancedMesh key={boites.length} ref={ref} args={[geometrie, undefined, boites.length]} material={materiau} />
}

/** Tous les fils de tous les ateliers : des tubes fins fusionnés, une impulsion qui court de `t` = 0 (la dépendance) à 1. */
function Fils({ exposes }: { exposes: Expose[] }) {
  const geometrie = useMemo(() => {
    const tubes = exposes.flatMap((e) =>
      e.coupe.fils.map((f, i) => {
        const [a, b, c, d] = f.points.map(([x, y, z]) => new THREE.Vector3(e.x + x, y, e.z + z))
        const tube = new THREE.TubeGeometry(new THREE.CubicBezierCurve3(a, b, c, d), 40, 0.0035, 5, false)
        // Chaque fil a sa phase : les impulsions ne partent pas en rang.
        const phase = ((i * 0.618) % 1) as number
        tube.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(tube.attributes.position.count).fill(phase), 1))
        tube.deleteAttribute('normal')
        return tube
      }),
    )
    if (tubes.length === 0) return null
    const g = mergeGeometries(tubes)
    tubes.forEach((t) => t.dispose())
    return g
  }, [exposes])
  useEffect(() => () => geometrie?.dispose(), [geometrie])

  const calme = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const materiau = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTemps: { value: 0 }, uCouleur: { value: new THREE.Color(FIL) }, uCalme: { value: calme ? 1 : 0 } },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          varying float vT;
          varying float vPhase;
          void main() {
            vT = uv.x;
            vPhase = aPhase;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTemps;
          uniform vec3 uCouleur;
          uniform float uCalme;
          varying float vT;
          varying float vPhase;
          void main() {
            // Une comète : la tête à t, la traîne derrière elle, un passage toutes les quatre secondes environ.
            float d = fract(uTemps * 0.25 + vPhase - vT);
            float impulsion = pow(1.0 - d, 10.0) * (1.0 - uCalme);
            gl_FragColor = vec4(uCouleur * (0.35 + 0.3 * uCalme + 2.4 * impulsion), 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [calme],
  )
  useEffect(() => () => materiau.dispose(), [materiau])
  useFrame(({ clock }) => {
    /* eslint-disable react-hooks/immutability */
    if (!calme) materiau.uniforms.uTemps.value = clock.elapsedTime
    /* eslint-enable */
  })
  if (geometrie === null) return null
  return <mesh geometry={geometrie} material={materiau} />
}

/** Un nom de projet se coupe à ses points : troika ne coupe qu'aux blancs. */
const coupable = (s: string) => s.replace(/\./g, '.​')

/** Les noms des couches en marge de leur plaque, ceux des blocs debout devant eux (les fils partent de l'arrière), et le cartel au rebord du socle. */
function Legendes({ expose: { x, z, atelier, coupe } }: { expose: Expose }) {
  const projet = atelier.key.split('/')[1]
  const contour = { outlineWidth: 0.0018, outlineColor: '#1c140c', outlineOpacity: 0.85 }
  const avant = RECUL_PLAQUES + PLAQUE.profondeur / 2 + 0.022
  const gauche = -PLAQUE.largeur / 2 - 0.06
  // Le cartel : une plaque crème couchée sur le rebord du socle, devant le verre, relevée de 25° vers le visiteur.
  const inclinaison = -(Math.PI / 2 - 0.44)
  const cartel: [number, number, number] = [0, SOCLE_ATELIER.hauteur + 0.03, (avant + SOCLE_ATELIER.profondeur / 2) / 2]
  return (
    <group position={[x, 0, z]}>
      {/* La colonne des légendes, à gauche des plaques : le nom de la couche à hauteur de sa plaque, son rôle dessous. */}
      {coupe.plaques.map((pl) => (
        <group key={pl.couche} position={[gauche, pl.y, avant]}>
          <Text font={CARTEL_FONT} fontSize={0.028} letterSpacing={0.08} color={CREME} anchorX="right" anchorY="bottom" {...contour}>
            {pl.nom.toUpperCase()}
          </Text>
          <Text font={CARTEL_FONT} position={[0, -0.006, 0]} fontSize={0.017} color={CREME} anchorX="right" anchorY="top" {...contour}>
            {pl.role}
          </Text>
        </group>
      ))}
      {coupe.blocs.map((b) => (
        <Text
          key={b.id}
          font={CARTEL_FONT}
          position={b.etiquette}
          fontSize={0.024}
          lineHeight={1.15}
          color={CREME}
          anchorX="center"
          anchorY="bottom"
          textAlign="center"
          maxWidth={b.largeurEtiquette}
          {...contour}
        >
          {`${coupable(b.nom)}\n${b.legende}`}
        </Text>
      ))}
      <group position={cartel} rotation={[inclinaison, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.92, 0.13, 0.006]} />
          <meshStandardMaterial color="#efe6d2" roughness={0.85} />
        </mesh>
        <Text font={TITRE_FONT} position={[-0.43, 0.052, 0.004]} fontSize={0.03} color={ENCRE} anchorX="left" anchorY="top">
          {`L’atelier en coupe — l’architecture de ${projet}`}
        </Text>
        <Text font={CARTEL_FONT} position={[-0.43, 0.012, 0.004]} fontSize={0.0165} lineHeight={1.3} maxWidth={0.86} color={ENCRE} anchorX="left" anchorY="top">
          {`Chaque plaque est une couche, chaque bloc un projet .csproj à la taille de son code, chaque fil une référence de projet : la lumière monte de la dépendance vers qui s’en sert. Relevé dans le dépôt ${atelier.key}, commit ${atelier.commit.slice(0, 7)}.`}
        </Text>
      </group>
    </group>
  )
}
